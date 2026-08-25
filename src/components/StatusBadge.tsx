// Single badge component for every status pill in the admin dashboard —
// computed attendance status (PRESENT/MISSING_CHECKOUT/COMPLETE/INCOMPLETE,
// see convex/attendanceStatus.ts) and employee employmentStatus
// (active/inactive) both render through this, so there is one place that
// owns "what a status pill looks like."
export type BadgeStatus =
  | 'PRESENT'
  | 'MISSING_CHECKOUT'
  | 'COMPLETE'
  | 'INCOMPLETE'
  | 'active'
  | 'inactive'
  | 'CHECK_IN'
  | 'CHECK_OUT'

const STATUS_META: Record<BadgeStatus, { label: string; tone: string }> = {
  PRESENT: { label: 'Present', tone: 'good' },
  MISSING_CHECKOUT: { label: 'Missing checkout', tone: 'warn' },
  COMPLETE: { label: 'Complete', tone: 'good' },
  INCOMPLETE: { label: 'Incomplete', tone: 'warn' },
  active: { label: 'Active', tone: 'good' },
  inactive: { label: 'Inactive', tone: 'muted' },
  CHECK_IN: { label: 'Check in', tone: 'good' },
  CHECK_OUT: { label: 'Check out', tone: 'muted' },
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const meta = STATUS_META[status]
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
}
