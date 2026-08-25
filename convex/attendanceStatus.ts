import { v } from 'convex/values'

// Single source of truth for "what does this employee's day status mean" —
// used by dashboard.todaySnapshot, attendance.listRecords (which the
// Attendance list and the employee detail page both consume), and nowhere
// else. Status is computed on read from attendanceSessions; it is never
// stored, so there is nothing here to keep in sync with a column.

// An open session left open this long is almost certainly a forgotten
// checkout, not a very long shift — flagged as MISSING_CHECKOUT instead of
// PRESENT. This is a stated assumption, not a hard requirement: change this
// one constant if the real threshold turns out to be different.
export const MISSING_CHECKOUT_THRESHOLD_HOURS = 16

export const computedStatus = v.union(
  v.literal('NOT_CHECKED_IN'),
  v.literal('PRESENT'),
  v.literal('MISSING_CHECKOUT'),
  v.literal('COMPLETE'),
  v.literal('INCOMPLETE'),
)

export type ComputedStatus =
  | 'NOT_CHECKED_IN'
  | 'PRESENT'
  | 'MISSING_CHECKOUT'
  | 'COMPLETE'
  | 'INCOMPLETE'

// A day-grouped row (attendance.listRecords) always has at least one
// session — NOT_CHECKED_IN is the absence of a row, not a value a row can
// carry (same reasoning the old attendanceRecords model already used, see
// the Attendance list's status filter). This narrower union is what
// listRecords and StatusBadge actually deal in.
export type DayRowStatus = Exclude<ComputedStatus, 'NOT_CHECKED_IN'>

export const dayRowStatus = v.union(
  v.literal('PRESENT'),
  v.literal('MISSING_CHECKOUT'),
  v.literal('COMPLETE'),
  v.literal('INCOMPLETE'),
)

export interface SessionLike {
  checkInAt: number
  checkOutAt?: number
  workingHours?: number
}

// `sessions` must already be filtered to the ones whose checkInAt falls on
// the calendar day being evaluated (see time.ts's localDateString) — this
// function doesn't do day-bucketing itself, callers own that.
export function computeDayStatus({
  sessions,
  requiredHoursPerDay,
  now = Date.now(),
}: {
  sessions: SessionLike[]
  requiredHoursPerDay: number | undefined
  now?: number
}): ComputedStatus {
  if (sessions.length === 0) return 'NOT_CHECKED_IN'

  const open = sessions.find((s) => s.checkOutAt === undefined)
  if (open) {
    const openHours = (now - open.checkInAt) / 3_600_000
    return openHours > MISSING_CHECKOUT_THRESHOLD_HOURS
      ? 'MISSING_CHECKOUT'
      : 'PRESENT'
  }

  const totalHours = sessions.reduce((sum, s) => sum + (s.workingHours ?? 0), 0)

  // No target configured for this employee yet (admin hasn't set
  // requiredHoursPerDay) — nothing to fall short of, so there's no honest
  // basis for INCOMPLETE. Treat as COMPLETE; the employee record's "Required
  // hours/day" field being blank is the actual signal to act on.
  if (requiredHoursPerDay === undefined) return 'COMPLETE'

  return totalHours >= requiredHoursPerDay ? 'COMPLETE' : 'INCOMPLETE'
}
