// Single source of truth for "what day/time is it" in the org's operating
// timezone. Convex functions run in UTC by default — computing calendar
// days (`new Date().toISOString().slice(0, 10)`) or formatting clock times
// without an explicit timeZone silently uses UTC, which is wrong by a
// fixed 5-hour offset for this Pakistan-based team, and shifts the
// calendar-day boundary attendanceRecords buckets by: a check-in between
// ~12am-5am PKT would land in the *previous* day under plain UTC.
export const ORG_TIMEZONE = 'Asia/Karachi'

// "YYYY-MM-DD" for the given instant, in ORG_TIMEZONE. en-CA formats
// numeric dates in that order, so this doubles as the ISO date string
// attendanceRecords.date and the by_date index expect.
export const localDateString = (ms: number = Date.now()): string =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: ORG_TIMEZONE })

export const localTimeString = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: ORG_TIMEZONE,
  })
