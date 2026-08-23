# Status

Living document. Update at the end of every session — what shipped, what's
still open. **Read this first** when starting a new session; then
[architecture.md](./architecture.md), [security.md](./security.md),
[setup.md](./setup.md), and [decisions-log.md](./decisions-log.md) as needed.

Phase numbers match the build order in [../agents.md](../agents.md).

## Phase table

| Phase | Scope | Status |
|---|---|---|
| 0 — Scaffold | TanStack Start + Convex provider wiring, Better Auth seeded admin login | ✅ Done |
| 1 — Schema + core mutation | `convex/schema.ts`, shared `attendance.recordEvent`, `employees.create/list/update/deactivate` | ✅ Done |
| 2 — Slack path (checkpoint) | `/slack/events` + `/slack/interactions`, signature verification, employee resolution, App Home Check In/Out buttons | ✅ Done, verified with a real Slack round trip |
| 3 — Admin UI | Login screen ✅. Employee list + create/edit/deactivate UI, attendance list with filters | ⚠️ Login only — employee/attendance UI **not built yet** |
| 4 — Corrections + unmatched review | Manual correction UI, unmatched-events queue with link-to-employee action | ⬜ Not started (backend mutations exist: `attendance.correctRecord`, `attendance.listUnmatched`, `attendance.linkUnmatched` — no UI) |
| 5 — Smoke pass | Live dashboard check, one correction round-trip, one unmatched-event link | ⬜ Blocked on Phase 3/4 UI |

## What's actually working right now

- Admin can log in via seeded email/password (Better Auth), no signup flow.
- Slack App Home shows Check In / Check Out buttons; a real Slack interaction
  resolves the employee (by `slackUserId`, falling back to email lookup +
  cache), writes an `attendanceEvents` row, and updates the derived
  `attendanceRecords` row for the day.
- Unmatched Slack users get an ephemeral "not recognized" message and an
  `UNMATCHED` event row instead of a silent failure.
- Deployed on Cloudflare Workers via `@cloudflare/vite-plugin` +
  `@tanstack/react-start/server-entry`.

## What's open

- No Admin UI for employee CRUD or attendance browsing — `employees.*` and
  `attendance.listRecords`/`listUnmatched` queries/mutations exist and are
  callable, but there's no page rendering them yet. `/` and `/login` are the
  only routes.
- Phase 4 (corrections UI, unmatched-review UI) not started.
- `.demo-*` scaffold CSS classes noted in [../agents.md](../agents.md) as a
  safe later rename — not touched yet.

## Next session should start with

Phase 3 remainder: build the employee list/create/edit/deactivate screen and
the attendance list with employee/date-range/status filters, both backed by
the existing reactive Convex queries (no manual refresh needed — see
[architecture.md](./architecture.md)).
