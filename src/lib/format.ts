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
