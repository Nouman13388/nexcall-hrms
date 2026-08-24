# Phase 2+ Roadmap

## Priority 0 — Admin/owner exclusion (bug fix, do first)

Admin accounts currently exist as employee rows, incorrectly counted in
headcount/dashboard stats. Add `isStaff: boolean` (default `true`) to
`employees`. Auto-set it to `false` at creation/sync time when the email
matches an existing Better Auth admin account. Add a manual admin toggle for
edge cases. A one-time cleanup is needed for the existing self-record. Slack
sync (`syncFromSlack`) needs the same check going forward. All employee-facing
queries and dashboard counts filter `isStaff: true` by default.

## Priority 1 — Shifts + Holidays (the real next phase)

- `shifts`: name, startTime, endTime, gracePeriodMinutes
- Employee-shift assignment (single shift per employee to start — decide
  inline field vs. join table at build time)
- `holidays`: date, name, optional locationScope
- `recordEvent` gains derived logic against the assigned shift: lateBy,
  earlyDepartureBy, breakMinutes — `attendanceRecords` gains these fields
- Dashboard "not checked in" excludes holidays
- Admin UI: manage shifts, assign employees, manage holiday calendar

This is what "breaks, early check-in/out constraints, automated tracking"
actually is — it is additive to the existing
`attendanceEvents`/`attendanceRecords` split, not a new data model.

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
