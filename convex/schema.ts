import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  employees: defineTable({
    fullName: v.string(),
    email: v.string(),
    slackUserId: v.optional(v.string()),
    department: v.optional(v.string()),
    designation: v.optional(v.string()),
    employmentStatus: v.union(v.literal('active'), v.literal('inactive')),
  })
    .index('by_email', ['email'])
    .index('by_slackUserId', ['slackUserId']),

  attendanceEvents: defineTable({
    employeeId: v.optional(v.id('employees')),
    eventType: v.union(v.literal('CHECK_IN'), v.literal('CHECK_OUT')),
    source: v.union(v.literal('SLACK'), v.literal('ADMIN')),
    occurredAt: v.number(),
    resolutionStatus: v.union(v.literal('RESOLVED'), v.literal('UNMATCHED')),
    rawSlackUserId: v.optional(v.string()),
    rawSlackEmail: v.optional(v.string()),
  })
    .index('by_employee_time', ['employeeId', 'occurredAt'])
    .index('by_resolution', ['resolutionStatus']),

  attendanceRecords: defineTable({
    employeeId: v.id('employees'),
    date: v.string(),
    checkInAt: v.optional(v.number()),
    checkOutAt: v.optional(v.number()),
    workingHours: v.optional(v.number()),
    status: v.union(
      v.literal('PRESENT'),
      v.literal('MISSING_CHECKOUT'),
      v.literal('COMPLETE'),
    ),
    correctedByAdmin: v.boolean(),
  })
    .index('by_employee_date', ['employeeId', 'date'])
    // "All records for today" (dashboard snapshot) has no employeeId to
    // start from, so by_employee_date can't serve it — without this,
    // that's an unindexed scan-then-filter over every attendanceRecords
    // row ever written instead of a bounded index lookup.
    .index('by_date', ['date']),
})
