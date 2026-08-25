# Phase 2+ Roadmap

## Priority 0 — Admin/owner exclusion (bug fix, do first)

Admin accounts currently exist as employee rows, incorrectly counted in
headcount/dashboard stats. Add `isStaff: boolean` (default `true`) to
`employees`. Auto-set it to `false` at creation/sync time when the email
matches an existing Better Auth admin account. Add a manual admin toggle for
edge cases. A one-time cleanup is needed for the existing self-record. Slack
sync (`syncFromSlack`) needs the same check going forward. All employee-facing
queries and dashboard counts filter `isStaff: true` by default.

## Priority 1 — Session model (shipped) + Holidays (still open)

The shifts/gracePeriod/lateBy design that used to live here is superseded.
`attendanceRecords` (one row per employee per calendar day) was the root
cause of the midnight-reset bug: a check-in before midnight and a check-out
after it landed in two different date-bucketed rows, corrupting both. It's
been replaced with `attendanceSessions` — one row per continuous
check-in/check-out span, keyed by `checkInAt`/`checkOutAt` instead of a
`date` string. Checking in before midnight and out after it is now a single
correct row; there is no date comparison anywhere in `recordEvent`. See
[architecture.md](./architecture.md) for the schema and
[decisions-log.md](./decisions-log.md) for the bug this fixed.

Two consequences of the session model that matter for anything built on top
of it going forward:

- **Status is computed on read, never stored.** `date` and `status` don't
  exist on `attendanceSessions` — `convex/attendanceStatus.ts`'s
  `computeDayStatus` derives `NOT_CHECKED_IN` / `PRESENT` /
  `MISSING_CHECKOUT` / `COMPLETE` / `INCOMPLETE` per employee per calendar
  day from the raw sessions plus `employees.requiredHoursPerDay`, every time
  it's asked. One shared function, three callers (`dashboard.todaySnapshot`,
  `attendance.listRecords`, and the employee detail page via the same
  `listRecords` query) — never reimplemented.
- **`requiredHoursPerDay` is per-employee and admin-set, no default.** "Duration
  determined per client" — there's no org-wide shift length to derive
  lateness or completeness from. This already replaces what shifts'
  `startTime`/`endTime` would have graded attendance against.

**What's still genuinely open from the old shifts/holidays idea, now
scoped down:**

- `holidays`: date, name, optional locationScope — so the dashboard's
  "not checked in" count can exclude holidays. This is the one piece of
  the original Priority 1 that the session model doesn't already cover.
- `lateBy` / `earlyDepartureBy` / `breakMinutes` as graded, shift-relative
  fields are **not** planned — there's no shift start/end time in this
  model to grade lateness against, only a daily hours target. If per-time
  lateness tracking becomes a real requirement, it needs its own design
  (e.g. an optional `scheduledStartTime` on `employees` alongside
  `requiredHoursPerDay`), not a resurrection of the `shifts` table above.

## Priority 2 — Monthly report view (print-first, not download-first)

Primary interaction: an in-app per-employee monthly report route
(`/dashboard/employees/:id/report` or similar), viewable directly in the
dashboard — date, check-in, check-out, hours worked, status, late/early flags,
with a summary row (total present/absent/late days, total hours).

Print-optimized via `@media print` CSS specifically for this view — hide
nav/sidebar/action buttons, ensure the table doesn't clip at page edges, and
handle page breaks for longer date ranges. This is real, deliberate CSS work,
not just calling `window.print()` on the existing dashboard layout (which
would print buttons and nav chrome, not a clean report).

Browser print-to-PDF (native in every modern browser) covers "save as PDF" —
no server-side PDF generation library is needed for v1.

Secondary action on the same view: CSV export button, for cases where an admin
needs the actual file (attach to email, import elsewhere) rather than
viewing/printing. Same data as the view, not a separate feature to design.

This is the data admins need to calculate salary and share monthly reports
themselves — still **not a payroll engine**: no pay-rate field, no salary
computation, and the same boundary as before.

Depends on Priority 1 (Shifts) — same reasoning as before: "absent" cannot be
distinguished from "wasn't scheduled" without shift data.

No in-app link-sharing or no-auth-required report access — sharing means an
admin downloads or prints and sends it through their own channels; it does not
mean a public or token-based link into the app.

## Priority 3 — Leave/PTO

`leaveTypes`, `leaveBalances`, `leaveRequests`
(`pending`/`approved`/`rejected`), with Slack-based request/approval matching
the existing Slack-native pattern. This is sequenced after shifts specifically
because leave needs to know whether someone was scheduled that day.

## Explicitly out of scope — record so it isn't silently reconsidered later

- Biometric/GPS attendance hardware
- Multi-jurisdiction compliance engines (FMLA-style)
- A separate employee self-service web portal (Slack is that layer; do not
  duplicate it)
- Full payroll/salary computation
