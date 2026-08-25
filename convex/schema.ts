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
    // Optional at rest, not "v.number() with a default" — the brief is
    // explicit that no default is forced, the admin sets this per person
    // ("duration determined per client"). Optional also means existing
    // employee docs stay valid the moment this schema deploys instead of
    // needing a backfill migration just to add a field. Unconfigured
    // (undefined) is a real state attendanceStatus.ts's computeDayStatus
    // handles explicitly, not an oversight.
    requiredHoursPerDay: v.optional(v.number()),
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

  // Session model: one row per continuous check-in/check-out span, not one
  // row per employee per calendar day. This is what makes checking in
  // before midnight and out after it a single correct row instead of a
  // broken day-boundary edit — see decisions-log.md for the bug this
  // replaced. "date" and "status" are deliberately absent: both are
  // computed on read (attendanceStatus.ts), never stored.
  attendanceSessions: defineTable({
    employeeId: v.id('employees'),
    checkInAt: v.number(), // required — a session doesn't exist before check-in
    checkOutAt: v.optional(v.number()), // absent = currently open
    workingHours: v.optional(v.number()), // computed at checkout
    correctedByAdmin: v.boolean(),
  })
    // Per-employee listing/history, and range-bounded queries scoped to one
    // employee (attendance.listRecords, attendance.getToday).
    .index('by_employee_checkInAt', ['employeeId', 'checkInAt'])
    // Find an employee's currently-open session directly — no date lookup,
    // no scan: `.eq('employeeId', id).eq('checkOutAt', undefined)`.
    .index('by_employee_open', ['employeeId', 'checkOutAt'])
    // Not in the original two-index brief — added because todaySnapshot and
    // an unfiltered/date-ranged Attendance list both need "sessions in this
    // time range across *all* employees," which by_employee_checkInAt can't
    // serve (it needs an employeeId to start from, same limitation
    // attendanceRecords.by_date existed to solve). Without this, either
    // query becomes a full-table scan over every session ever written.
    .index('by_checkInAt', ['checkInAt']),

  // LEGACY — superseded by attendanceSessions. Kept only as the migration
  // source (see convex/migrateSessions.ts); nothing writes to this table
  // anymore. Remove this block once the migration is run and verified
  // (docs/decisions-log.md tracks that decision).
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
    .index('by_date', ['date']),
})
