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
| 2 — Slack path (checkpoint) | `/slack/events` + `/slack/interactions`, signature verification, employee resolution, App Home Check In/Out buttons | ✅ Done, verified with a real Slack round trip — see the signature-verification and Slack app-config bugs below, both hit and fixed this session |
| 3 — Admin UI | Login screen, employee list + create/edit/deactivate + Slack employee sync, attendance list with employee/date-range/status filters, live dashboard (today's snapshot + recent activity feed) | ✅ Done |
| 4 — Corrections + unmatched review | Manual correction UI, unmatched-events queue with link-to-employee action | ⬜ Not started (backend mutations exist: `attendance.correctRecord`, `attendance.listUnmatched`, `attendance.linkUnmatched` — no UI) |
| 5 — Smoke pass | Live dashboard check, one correction round-trip, one unmatched-event link | ⚠️ Partial — Slack check-in/out → live dashboard update verified for real this session; correction round-trip and unmatched-event link still blocked on Phase 4 UI |

## What's actually working right now

- Admin can log in via seeded email/password (Better Auth), no signup flow.
- Employee list with create/edit/deactivate, plus a "Sync from Slack" action
  ([convex/slackSync.ts](../convex/slackSync.ts)) that matches workspace
  members to employee records by email.
- Attendance list with employee/date-range/status filters, deep-linkable
  (dashboard snapshot cards link here pre-filtered).
- Live dashboard: today's present/missing-checkout/complete/not-checked-in
  snapshot and a recent-activity feed, both reactive (no manual refresh).
- Slack App Home shows Check In / Check Out buttons that are **context-aware**
  against today's `attendanceRecords` state (Check In only if not checked in,
  Check Out only if checked in and not out, no buttons once complete — with
  today's status/time shown), and republishes immediately after a button tap
  so the tab reflects the write without a manual reopen. An unresolved Slack
  user sees a "contact HR" view instead of buttons.
- A real Slack interaction resolves the employee (by `slackUserId`, falling
  back to email lookup + cache — shared between the Home tab and the button
  handler via `resolveEmployee()` in `convex/slack.ts`), writes an
  `attendanceEvents` row, and updates the derived `attendanceRecords` row for
  the day, bucketed by calendar day in `Asia/Karachi` (see
  [decisions-log.md](./decisions-log.md) — this was UTC and wrong until this
  session).
- Unmatched Slack users get an ephemeral "not recognized" message and an
  `UNMATCHED` event row instead of a silent failure.
- Deployed on Cloudflare Workers via `@cloudflare/vite-plugin` +
  `@tanstack/react-start/server-entry`.

## What's open

- Phase 4 (corrections UI, unmatched-review UI) not started — `/` and
  `/dashboard/{index,employees,attendance}` are the only routes; no page for
  `attendance.correctRecord`/`listUnmatched`/`linkUnmatched` yet.
- Phase 5 smoke pass items tied to Phase 4 (manual correction round-trip,
  unmatched-event link) still open.

## Next session should start with

Phase 4: manual correction UI on `attendanceRecords` (via `attendance.
correctRecord`, `source="ADMIN"`) and an unmatched-events queue with a
link-to-employee action, then close out the Phase 5 smoke pass items that
depend on it. See [decisions-log.md](./decisions-log.md) for the Slack
signature-verification bug, the UTC-vs-`Asia/Karachi` timezone bug, and the
`CONVEX_DEPLOY_KEY`/`SLACK_BOT_TOKEN` credential-hygiene rules hit this
session — worth reading before touching `convex/slack.ts` or any deploy
command again.
