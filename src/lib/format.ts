// Shared by the dashboard's recent-activity list and the Employees page's
// "last synced" label — one implementation, not two copies drifting apart.
export function relativeTime(ms: number) {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Mirrors convex/time.ts's ORG_TIMEZONE — this is the frontend's copy since
// convex/ and src/ build separately (server isolate vs. browser bundle).
// Keep both in sync if the org ever operates out of a different timezone.
const ORG_TIMEZONE = 'Asia/Karachi'

const localDateString = (ms: number) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: ORG_TIMEZONE })

// "Today"/"Yesterday"/"Aug 24" for an event's date, independent of
// relativeTime's "3h ago" — a plain hour count alone can't tell you whether
// an event landed in today's attendanceRecords bucket or yesterday's,
// which is exactly the distinction the dashboard's daily snapshot cares
// about (see decisions-log.md's Asia/Karachi day-bucketing entry).
export function dayLabel(ms: number) {
  const day = localDateString(ms)
  const today = localDateString(Date.now())
  if (day === today) return 'Today'
  if (day === localDateString(Date.now() - 24 * 60 * 60 * 1000)) return 'Yesterday'
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: ORG_TIMEZONE,
    month: 'short',
    day: 'numeric',
  })
}

// Explicit ORG_TIMEZONE rather than the viewer's device timezone — an admin
// checking the dashboard while traveling shouldn't see times shift out of
// sync with the org's actual operating timezone (same reasoning as the
// backend fix, applied here so the two never disagree).
export function formatClockTime(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('en-US', {
    timeZone: ORG_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
}
