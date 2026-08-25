import { v } from 'convex/values'
import { query } from './_generated/server'
import { computeDayStatus } from './attendanceStatus'
import { requireAdmin } from './auth'
import { MAX_ROWS } from './constants'
import schema from './schema'
import { endOfLocalDayMs, localDateString, startOfLocalDayMs } from './time'

const todayDate = localDateString

export const todaySnapshot = query({
  args: {},
  returns: v.object({
    present: v.number(),
    missingCheckout: v.number(),
    complete: v.number(),
    incomplete: v.number(),
    notCheckedIn: v.number(),
    date: v.string(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const date = todayDate()

    const employees = await ctx.db.query('employees').take(MAX_ROWS)
    const activeEmployees = employees.filter((e) => e.employmentStatus === 'active')

    // by_checkInAt bounds this to today's sessions across all employees
    // instead of scanning every attendanceSessions row ever written — same
    // role the old by_date index on attendanceRecords played.
    const startMs = startOfLocalDayMs(date)
    const endMs = endOfLocalDayMs(date)
    const todaySessions = await ctx.db
      .query('attendanceSessions')
      .withIndex('by_checkInAt', (q) => q.gte('checkInAt', startMs).lte('checkInAt', endMs))
      .take(MAX_ROWS)

    const sessionsByEmployee = new Map<string, typeof todaySessions>()
    for (const session of todaySessions) {
      const existing = sessionsByEmployee.get(session.employeeId)
      if (existing) existing.push(session)
      else sessionsByEmployee.set(session.employeeId, [session])
    }

    let present = 0
    let missingCheckout = 0
    let complete = 0
    let incomplete = 0
    let notCheckedIn = 0

    for (const employee of activeEmployees) {
      const status = computeDayStatus({
        sessions: sessionsByEmployee.get(employee._id) ?? [],
        requiredHoursPerDay: employee.requiredHoursPerDay,
      })
      if (status === 'PRESENT') present++
      else if (status === 'MISSING_CHECKOUT') missingCheckout++
      else if (status === 'COMPLETE') complete++
      else if (status === 'INCOMPLETE') incomplete++
      else notCheckedIn++
    }

    return { present, missingCheckout, complete, incomplete, notCheckedIn, date }
  },
})

export const recentActivity = query({
  args: {},
  returns: v.array(schema.doc('attendanceEvents')),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    // No index needed: Convex's default table order is by _creationTime,
    // so .order('desc').take(10) is already a bounded, efficient read.
    return ctx.db.query('attendanceEvents').order('desc').take(10)
  },
})
