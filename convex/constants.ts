// Single-workspace admin tool, not a scan-everything analytics product —
// every unbounded list query in convex/ caps at this many rows rather than
// growing an index-scan into a full-table scan. Was duplicated as a local
// `MAX_ROWS` in dashboard.ts; pulled out here once attendance.ts needed the
// same bound for session listing/grouping.
export const MAX_ROWS = 500
