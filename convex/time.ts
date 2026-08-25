// Single source of truth for "what day/time is it" in the org's operating
// timezone. Convex functions run in UTC by default — computing calendar
// days (`new Date().toISOString().slice(0, 10)`) or formatting clock times
// without an explicit timeZone silently uses UTC, which is wrong by a
// fixed 5-hour offset for this Pakistan-based team, and shifts the
// calendar-day boundary attendanceStatus.ts computes status by: a check-in
// between ~12am-5am PKT would land in the *previous* day under plain UTC.
export const ORG_TIMEZONE = 'Asia/Karachi'

// "YYYY-MM-DD" for the given instant, in ORG_TIMEZONE. en-CA formats
// numeric dates in that order — this is the day-grouping key
// attendance.listRecords and dashboard.todaySnapshot bucket
// attendanceSessions by (see attendanceStatus.ts).
export const localDateString = (ms: number = Date.now()): string =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: ORG_TIMEZONE })

export const localTimeString = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ORG_TIMEZONE,
  })

// Pakistan doesn't observe DST, so Asia/Karachi is a fixed UTC+5 — safe to
// hardcode the offset in an ISO string rather than asking the Date
// constructor to interpret a bare "YYYY-MM-DDT00:00:00", which it reads in
// the *runtime's* timezone (UTC in Convex), not ORG_TIMEZONE. Same class of
// bug the rest of this file exists to avoid: get this wrong and a
// "day range" query is silently off by 5 hours.
const ORG_UTC_OFFSET = '+05:00'

// Start/end of the given ORG_TIMEZONE calendar day, as epoch ms — the pair
// attendance.listRecords and dashboard.todaySnapshot use to bound a
// by_checkInAt/by_employee_checkInAt range query to one local day.
export const startOfLocalDayMs = (date: string): number =>
  new Date(`${date}T00:00:00${ORG_UTC_OFFSET}`).getTime()

export const endOfLocalDayMs = (date: string): number =>
  new Date(`${date}T23:59:59.999${ORG_UTC_OFFSET}`).getTime()
