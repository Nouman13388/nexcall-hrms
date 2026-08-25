import { v } from 'convex/values'
import { internalMutation, internalQuery, mutation, query } from './_generated/server'
import { computeDayStatus, dayRowStatus } from './attendanceStatus'
import { requireAdmin } from './auth'
import { MAX_ROWS } from './constants'
import schema from './schema'
import { endOfLocalDayMs, localDateString, startOfLocalDayMs } from './time'
import type { DayRowStatus } from './attendanceStatus'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'

const eventType = v.union(v.literal('CHECK_IN'), v.literal('CHECK_OUT'))
const eventSource = v.union(v.literal('SLACK'), v.literal('ADMIN'))
const recordResult = v.object({ success: v.boolean(), status: v.string() })

type RecordEventArgs = {
  employeeId?: Id<'employees'>
  eventType: 'CHECK_IN' | 'CHECK_OUT'
  source: 'SLACK' | 'ADMIN'
  occurredAt: number
  rawSlackUserId?: string
  rawSlackEmail?: string
}

async function findOpenSession(ctx: MutationCtx | QueryCtx, employeeId: Id<'employees'>) {
  return ctx.db
    .query('attendanceSessions')
    .withIndex('by_employee_open', (q) =>
      q.eq('employeeId', employeeId).eq('checkOutAt', undefined),
    )
    .unique()
}

async function recordEventLogic(ctx: MutationCtx, args: RecordEventArgs) {
  await ctx.db.insert('attendanceEvents', {
    employeeId: args.employeeId,
    eventType: args.eventType,
    source: args.source,
    occurredAt: args.occurredAt,
    resolutionStatus: args.employeeId ? 'RESOLVED' : 'UNMATCHED',
    rawSlackUserId: args.rawSlackUserId,
    rawSlackEmail: args.rawSlackEmail,
  })

  if (!args.employeeId) return { success: false, status: 'UNMATCHED' }

  const employeeId = args.employeeId
  const open = await findOpenSession(ctx, employeeId)

  if (args.eventType === 'CHECK_IN') {
    if (open) {
      // SLACK: repeat check-in while already checked in is a no-op, same
      // idempotency behavior as before. ADMIN: treated as a correction to
      // the open session's check-in time, not a reject — this is what lets
      // an admin fix a wrong check-in time via the same mutation.
      if (args.source !== 'ADMIN') {
        return { success: true, status: 'ALREADY_CHECKED_IN' }
      }
      await ctx.db.patch('attendanceSessions', open._id, {
        checkInAt: args.occurredAt,
        correctedByAdmin: true,
      })
      return { success: true, status: 'RESOLVED' }
    }

    await ctx.db.insert('attendanceSessions', {
      employeeId,
      checkInAt: args.occurredAt,
      correctedByAdmin: args.source === 'ADMIN',
    })
    return { success: true, status: 'RESOLVED' }
  }

  // CHECK_OUT
  if (!open) {
    // No open session to attach a checkout to — a session can't exist
    // without a checkInAt, so there's nothing to correct here either.
    // Reject for both sources; the admin path to fix this is a check-in
    // correction first, then a checkout.
    return { success: true, status: 'NOT_CHECKED_IN' }
  }

  const workingHours = (args.occurredAt - open.checkInAt) / 3_600_000
  await ctx.db.patch('attendanceSessions', open._id, {
    checkOutAt: args.occurredAt,
    workingHours,
    correctedByAdmin: open.correctedByAdmin || args.source === 'ADMIN',
  })
  return { success: true, status: 'RESOLVED' }
}

export const recordEvent = internalMutation({
  args: {
    employeeId: v.optional(v.id('employees')),
    eventType,
    source: eventSource,
    occurredAt: v.number(),
    rawSlackUserId: v.optional(v.string()),
    rawSlackEmail: v.optional(v.string()),
  },
  returns: recordResult,
  handler: recordEventLogic,
})

const listedRecord = v.object({
  _id: v.string(), // synthetic (`${employeeId}_${date}`) — these rows are
  // computed day-groupings of attendanceSessions, not documents, so there's
  // no real _id to return.
  employeeId: v.id('employees'),
  date: v.string(),
  checkInAt: v.number(),
  checkOutAt: v.optional(v.number()),
  workingHours: v.optional(v.number()),
  status: dayRowStatus,
  correctedByAdmin: v.boolean(),
})

// Groups a bounded set of sessions into one row per employee per calendar
// day (Asia/Karachi, via time.ts's localDateString) and computes each row's
// status through the one shared function in attendanceStatus.ts. Shared by
// listRecords below — the Attendance list and the employee detail page both
// render whatever this returns, so neither reimplements status logic.
function buildDayRow(
  id: string,
  date: string,
  daySessions: Doc<'attendanceSessions'>[],
  requiredHoursPerDay: number | undefined,
) {
  const sorted = [...daySessions].sort((a, b) => a.checkInAt - b.checkInAt)
  const allClosed = sorted.every((s) => s.checkOutAt !== undefined)
  const workingHours = sorted.reduce((sum, s) => sum + (s.workingHours ?? 0), 0)
  const computed = computeDayStatus({ sessions: sorted, requiredHoursPerDay })
  // Unreachable in practice — daySessions is always non-empty (it's built
  // from an actual session's checkInAt), and NOT_CHECKED_IN only comes back
  // for an empty list — but this narrows the return type to DayRowStatus
  // instead of asserting past the compiler.
  if (computed === 'NOT_CHECKED_IN') {
    throw new Error('Unreachable: a day-grouped row always has at least one session')
  }
  const status: DayRowStatus = computed

  return {
    _id: id,
    employeeId: sorted[0].employeeId,
    date,
    checkInAt: sorted[0].checkInAt,
    checkOutAt: allClosed ? sorted[sorted.length - 1].checkOutAt : undefined,
    workingHours: workingHours > 0 ? workingHours : undefined,
    status,
    correctedByAdmin: sorted.some((s) => s.correctedByAdmin),
  }
}

function groupSessionsByDay(
  sessions: Doc<'attendanceSessions'>[],
  requiredHoursByEmployee: Map<string, number | undefined>,
) {
  const groups = new Map<string, Doc<'attendanceSessions'>[]>()
  for (const session of sessions) {
    const date = localDateString(session.checkInAt)
    const key = `${session.employeeId}_${date}`
    const existing = groups.get(key)
    if (existing) existing.push(session)
    else groups.set(key, [session])
  }

  const rows: ReturnType<typeof buildDayRow>[] = []
  for (const [key, daySessions] of groups) {
    const date = key.slice(key.indexOf('_') + 1)
    rows.push(
      buildDayRow(key, date, daySessions, requiredHoursByEmployee.get(daySessions[0].employeeId)),
    )
  }
  return rows
}

export const listRecords = query({
  args: {
    employeeId: v.optional(v.id('employees')),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(dayRowStatus),
  },
  returns: v.array(listedRecord),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    // Bound the raw session fetch by an index *before* grouping/filtering in
    // JS — never an unbounded scan of every session ever written. Three
    // shapes, matching the three ways this is called:
    let sessions: Doc<'attendanceSessions'>[]
    if (args.employeeId) {
      const employeeId = args.employeeId
      sessions = await ctx.db
        .query('attendanceSessions')
        .withIndex('by_employee_checkInAt', (q) => q.eq('employeeId', employeeId))
        .order('desc')
        .take(MAX_ROWS)
    } else if (args.startDate || args.endDate) {
      // No employee, but a date range: by_checkInAt (not employee-scoped)
      // bounds this to just that range across all employees.
      // Always chain both bounds (defaulting the missing side to
      // effectively unbounded) rather than conditionally chaining .gte/.lte
      // — keeps the index builder's chained type fixed instead of a union
      // across branches.
      const startMs = args.startDate ? startOfLocalDayMs(args.startDate) : 0
      const endMs = args.endDate ? endOfLocalDayMs(args.endDate) : Date.now()
      sessions = await ctx.db
        .query('attendanceSessions')
        .withIndex('by_checkInAt', (q) => q.gte('checkInAt', startMs).lte('checkInAt', endMs))
        .order('desc')
        .take(MAX_ROWS)
    } else {
      // No employee, no date range: same "most recent N" cap the old
      // attendanceRecords-backed version used — not a new regression.
      sessions = await ctx.db.query('attendanceSessions').order('desc').take(MAX_ROWS)
    }

    const employees = await ctx.db.query('employees').take(MAX_ROWS)
    const requiredHoursByEmployee = new Map(
      employees.map((e) => [e._id as string, e.requiredHoursPerDay]),
    )

    const rows = groupSessionsByDay(sessions, requiredHoursByEmployee)

    return rows
      .filter(
        (row) =>
          (!args.startDate || row.date >= args.startDate) &&
          (!args.endDate || row.date <= args.endDate) &&
          (!args.status || row.status === args.status),
      )
      .sort((a, b) => b.checkInAt - a.checkInAt)
  },
})

export const correctRecord = mutation({
  args: {
    employeeId: v.id('employees'),
    eventType,
    occurredAt: v.number(),
  },
  returns: recordResult,
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    return recordEventLogic(ctx, { ...args, source: 'ADMIN' })
  },
})

const todayView = v.union(
  v.object({
    state: v.literal('OPEN'),
    checkInAt: v.number(),
  }),
  v.object({
    state: v.literal('CLOSED'),
    checkInAt: v.number(),
    checkOutAt: v.number(),
  }),
  v.object({ state: v.literal('NONE') }),
)

// Used by the Slack App Home view to decide which button (Check In vs Check
// Out) is valid right now, and what times to show. Open session takes
// priority (by_employee_open, no date lookup); otherwise looks at today's
// most recent closed session, if any — bounded per-employee index reads,
// same cost profile as the old by_employee_date lookup.
export const getToday = internalQuery({
  args: { employeeId: v.id('employees') },
  returns: todayView,
  handler: async (ctx, { employeeId }) => {
    const open = await findOpenSession(ctx, employeeId)
    if (open) return { state: 'OPEN' as const, checkInAt: open.checkInAt }

    const today = localDateString()
    const recent = await ctx.db
      .query('attendanceSessions')
      .withIndex('by_employee_checkInAt', (q) => q.eq('employeeId', employeeId))
      .order('desc')
      .take(5)

    const todaysClosed = recent.find(
      (s) => localDateString(s.checkInAt) === today && s.checkOutAt !== undefined,
    )
    if (todaysClosed) {
      return {
        state: 'CLOSED' as const,
        checkInAt: todaysClosed.checkInAt,
        checkOutAt: todaysClosed.checkOutAt!,
      }
    }

    return { state: 'NONE' as const }
  },
})

export const listUnmatched = query({
  args: {},
  returns: v.array(schema.doc('attendanceEvents')),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return ctx.db
      .query('attendanceEvents')
      .withIndex('by_resolution', (q) => q.eq('resolutionStatus', 'UNMATCHED'))
      .order('desc')
      .take(200)
  },
})

export const linkUnmatched = mutation({
  args: {
    eventId: v.id('attendanceEvents'),
    employeeId: v.id('employees'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const event = await ctx.db.get('attendanceEvents', args.eventId)
    if (!event || event.resolutionStatus !== 'UNMATCHED') {
      throw new Error('Invalid or already resolved event')
    }

    await ctx.db.patch('attendanceEvents', args.eventId, {
      resolutionStatus: 'RESOLVED',
      employeeId: args.employeeId,
    })
    await recordEventLogic(ctx, {
      employeeId: args.employeeId,
      eventType: event.eventType,
      source: 'ADMIN',
      occurredAt: event.occurredAt,
    })
    return null
  },
})
