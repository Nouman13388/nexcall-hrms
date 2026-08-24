import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireAdmin } from './auth'
import schema from './schema'
import { localDateString } from './time'

// Bound consistent with employees.list's existing .take(500) — this is a
// single-workspace admin tool, not a scan-everything analytics query.
const MAX_ROWS = 500

const todayDate = localDateString

export const todaySnapshot = query({
  args: {},
  returns: v.object({
    present: v.number(),
    missingCheckout: v.number(),
    complete: v.number(),
    notCheckedIn: v.number(),
    date: v.string(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const date = todayDate()

    const employees = await ctx.db.query('employees').take(MAX_ROWS)
    const activeEmployeeIds = new Set(
      employees.filter((e) => e.employmentStatus === 'active').map((e) => e._id),
    )

    // by_date lets this go straight to today's rows instead of scanning
    // every attendanceRecords document ever written.
    const todayRecords = await ctx.db
      .query('attendanceRecords')
      .withIndex('by_date', (q) => q.eq('date', date))
      .take(MAX_ROWS)

    let present = 0
    let missingCheckout = 0
    let complete = 0
    const recordedEmployeeIds = new Set<string>()

    for (const record of todayRecords) {
      recordedEmployeeIds.add(record.employeeId)
      if (record.status === 'PRESENT') present++
      else if (record.status === 'MISSING_CHECKOUT') missingCheckout++
      else if (record.status === 'COMPLETE') complete++
    }

    let notCheckedIn = 0
    for (const id of activeEmployeeIds) {
      if (!recordedEmployeeIds.has(id)) notCheckedIn++
    }

    return { present, missingCheckout, complete, notCheckedIn, date }
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
