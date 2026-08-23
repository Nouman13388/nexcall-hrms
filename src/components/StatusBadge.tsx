// Single badge component for every status pill in the admin dashboard —
// attendance record status (PRESENT/MISSING_CHECKOUT/COMPLETE) and employee
// employmentStatus (active/inactive) both render through this, so there is
// one place that owns "what a status pill looks like."
export type BadgeStatus =
  | 'PRESENT'
  | 'MISSING_CHECKOUT'
  | 'COMPLETE'
  | 'active'
  | 'inactive'

const STATUS_META: Record<BadgeStatus, { label: string; tone: string }> = {
  PRESENT: { label: 'Present', tone: 'good' },
  MISSING_CHECKOUT: { label: 'Missing checkout', tone: 'warn' },
  COMPLETE: { label: 'Complete', tone: 'good' },
  active: { label: 'Active', tone: 'good' },
  inactive: { label: 'Inactive', tone: 'muted' },
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  const meta = STATUS_META[status]
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>
}
