import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { requireAdmin } from './auth'
import schema from './schema'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const eventType = v.union(v.literal('CHECK_IN'), v.literal('CHECK_OUT'))
const eventSource = v.union(v.literal('SLACK'), v.literal('ADMIN'))
const attendanceStatus = v.union(
  v.literal('PRESENT'),
  v.literal('MISSING_CHECKOUT'),
  v.literal('COMPLETE'),
)
const recordResult = v.object({ success: v.boolean(), status: v.string() })

type RecordEventArgs = {
  employeeId?: Id<'employees'>
  eventType: 'CHECK_IN' | 'CHECK_OUT'
  source: 'SLACK' | 'ADMIN'
  occurredAt: number
  rawSlackUserId?: string
  rawSlackEmail?: string
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
  const date = new Date(args.occurredAt).toISOString().slice(0, 10)
  const existing = await ctx.db
    .query('attendanceRecords')
    .withIndex('by_employee_date', (q) =>
      q.eq('employeeId', employeeId).eq('date', date),
    )
    .unique()

  if (args.eventType === 'CHECK_IN') {
    if (existing?.checkInAt && args.source !== 'ADMIN') {
      return { success: true, status: 'ALREADY_CHECKED_IN' }
    }

    if (existing) {
      await ctx.db.patch('attendanceRecords', existing._id, {
        checkInAt: args.occurredAt,
        status: existing.checkOutAt ? 'COMPLETE' : 'MISSING_CHECKOUT',
        correctedByAdmin:
          existing.correctedByAdmin || args.source === 'ADMIN',
      })
    } else {
      await ctx.db.insert('attendanceRecords', {
        employeeId,
        date,
        checkInAt: args.occurredAt,
        status: 'MISSING_CHECKOUT',
        correctedByAdmin: args.source === 'ADMIN',
      })
    }
  } else {
    if (existing?.checkOutAt && args.source !== 'ADMIN') {
      return { success: true, status: 'ALREADY_CHECKED_OUT' }
    }

    if (existing) {
      const workingHours = existing.checkInAt
        ? (args.occurredAt - existing.checkInAt) / 3_600_000
        : undefined
      await ctx.db.patch('attendanceRecords', existing._id, {
        checkOutAt: args.occurredAt,
        workingHours,
        status: 'COMPLETE',
        correctedByAdmin:
          existing.correctedByAdmin || args.source === 'ADMIN',
      })
    } else {
      await ctx.db.insert('attendanceRecords', {
        employeeId,
        date,
        checkOutAt: args.occurredAt,
        status: 'COMPLETE',
        correctedByAdmin: args.source === 'ADMIN',
      })
    }
  }

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

export const listRecords = query({
  args: {
    employeeId: v.optional(v.id('employees')),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(attendanceStatus),
  },
  returns: v.array(schema.doc('attendanceRecords')),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const records = args.employeeId
      ? await ctx.db
          .query('attendanceRecords')
          .withIndex('by_employee_date', (q) =>
            q.eq('employeeId', args.employeeId!),
          )
          .order('desc')
          .take(500)
      : await ctx.db.query('attendanceRecords').order('desc').take(500)

    return records.filter(
      (record) =>
        (!args.startDate || record.date >= args.startDate) &&
        (!args.endDate || record.date <= args.endDate) &&
        (!args.status || record.status === args.status),
    )
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
