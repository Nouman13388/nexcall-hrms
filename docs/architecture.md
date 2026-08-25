# Architecture

Start with [status.md](./status.md) for what's actually built. This doc
describes the design as implemented in `convex/` and `src/`.

## Stack

- **Convex** — backend, database, and HTTP actions (`convex/http.ts`).
- **TanStack Start** (React Router + React Query + Convex hooks) — frontend,
  server-rendered, deployed as a Cloudflare Worker.
- **`@convex-dev/better-auth`** — auth. Single seeded Admin role, no signup
  flow (`disableSignUp: true` in `convex/auth.ts`).
- **Cloudflare Workers** — hosting, via `@cloudflare/vite-plugin` and
  `@tanstack/react-start/server-entry` as the Worker's `main` (see
  [decisions-log.md](./decisions-log.md) for why Workers over Pages).

## Data model (`convex/schema.ts`)

```ts
employees: defineTable({
  fullName: v.string(),
  email: v.string(),                    // uniqueness enforced in mutation code
  slackUserId: v.optional(v.string()),  // cached on first resolved Slack event
  department: v.optional(v.string()),
  designation: v.optional(v.string()),
  employmentStatus: v.union(v.literal("active"), v.literal("inactive")),
  requiredHoursPerDay: v.optional(v.number()), // admin-set per person, no default
})
  .index("by_email", ["email"])
  .index("by_slackUserId", ["slackUserId"]),

attendanceEvents: defineTable({         // raw, append-only, never mutated
  employeeId: v.optional(v.id("employees")), // null when unresolved
  eventType: v.union(v.literal("CHECK_IN"), v.literal("CHECK_OUT")),
  source: v.union(v.literal("SLACK"), v.literal("ADMIN")),
  occurredAt: v.number(),
  resolutionStatus: v.union(v.literal("RESOLVED"), v.literal("UNMATCHED")),
  rawSlackUserId: v.optional(v.string()),
  rawSlackEmail: v.optional(v.string()),
})
  .index("by_employee_time", ["employeeId", "occurredAt"])
  .index("by_resolution", ["resolutionStatus"]),

// Session model, not date-bucketed: one row per continuous check-in/
// check-out span. Replaces attendanceRecords (one row per employee per
// calendar day), which was the root cause of the midnight-reset bug — a
// check-in before midnight and a check-out after it landed in two
// different date buckets. checkInAt/checkOutAt now define the row instead
// of a `date` string, so there is no date comparison anywhere in
// recordEvent. `date` and `status` are deliberately absent: both are
// computed on read, never stored (see attendanceStatus.ts below).
attendanceSessions: defineTable({
  employeeId: v.id("employees"),
  checkInAt: v.number(),                // required — no session before check-in
  checkOutAt: v.optional(v.number()),   // absent = currently open
  workingHours: v.optional(v.number()), // computed at checkout
  correctedByAdmin: v.boolean(),
})
  .index("by_employee_checkInAt", ["employeeId", "checkInAt"]) // listing/history
  .index("by_employee_open", ["employeeId", "checkOutAt"])     // find the open session, no date lookup
  .index("by_checkInAt", ["checkInAt"]),                       // cross-employee range queries (todaySnapshot, unfiltered/date-ranged listRecords)
```

`attendanceRecords` still exists in `schema.ts` (marked `LEGACY`) purely as
the read source for the one-time migration in `convex/migrateSessions.ts` —
nothing writes to it anymore. It's dropped from the schema once the
migration is run and verified; see [decisions-log.md](./decisions-log.md).

Convex has no DB-level unique constraint, so things like this are enforced
in mutation code instead of the schema:

- **Employee email uniqueness** — `employees.create` normalizes the email
  (trim + lowercase) and does a query-before-insert on `by_email` before
  inserting.
- **One open session per employee** — `recordEventLogic` in
  `convex/attendance.ts` looks up the open session via `by_employee_open`
  before every check-in/check-out; a check-in with one already open is
  rejected (`ALREADY_CHECKED_IN`) rather than opening a second one.

### Status is computed, not stored (`convex/attendanceStatus.ts`)

`NOT_CHECKED_IN` / `PRESENT` / `MISSING_CHECKOUT` / `COMPLETE` /
`INCOMPLETE` are derived on read by `computeDayStatus`, the one function
every status-displaying query goes through — `dashboard.todaySnapshot`,
`attendance.listRecords` (which both the Attendance list and the employee
detail page render directly), never reimplemented per caller:

- No sessions that day → `NOT_CHECKED_IN`
- An open session → `PRESENT`, unless it's been open longer than
  `MISSING_CHECKOUT_THRESHOLD_HOURS` (16h, a named constant, not a magic
  number — a stated assumption, easy to change) → `MISSING_CHECKOUT`
- All sessions closed, summed `workingHours` ≥ `employees.requiredHoursPerDay`
  → `COMPLETE`; below it → `INCOMPLETE`
- `requiredHoursPerDay` unset for that employee → treated as `COMPLETE`
  (nothing to fall short of; the blank "Required hours/day" field on the
  employee record is the actual thing to act on)

`attendance.listRecords` groups the bounded set of sessions it reads into
one row per employee per calendar day (Asia/Karachi, `time.ts`'s
`localDateString`) before computing status per group — this is what makes
the Attendance list's "Date / Check in / Check out / Hours / Status" table
possible even though sessions aren't stored pre-grouped by day.

## Function surface

| function | type | purpose |
|---|---|---|
| `slack.events` / `slack.interactions` | `httpAction` | Slack Events API + Interactivity, signature-verified |
| `employees.list/create/update/deactivate` | query/mutation | Admin employee CRUD (all gated by `requireAdmin`) |
| `employees.getBySlackId/getByEmail/updateSlackId` | internal query/mutation | Slack-only employee resolution helpers, not callable from the client |
| `slackSync.syncFromSlack` | action | matches workspace members to employee records by email, backs the Admin "Sync from Slack" button |
| `attendance.recordEvent` | `internalMutation` | shared write path for Slack + Admin sources, includes idempotency check |
| `attendance.getToday` | `internalQuery` | this employee's open session (`by_employee_open`) or today's most recent closed one — backs the Slack Home tab's context-aware buttons |
| `attendance.listRecords` | query | sessions grouped into day rows (`attendanceStatus.ts`), filtered by employee/date range/computed status |
| `attendance.correctRecord` | mutation | wraps the same recording logic with `source: "ADMIN"` |
| `attendance.listUnmatched` / `.linkUnmatched` | query/mutation | unmatched-event review queue (backend only — no Admin UI yet, see [status.md](./status.md)) |
| `dashboard.todaySnapshot` / `.recentActivity` | query | live Admin dashboard: today's present/missing-checkout/complete/incomplete/not-checked-in counts + recent `attendanceEvents` feed |
| `migrateSessions.dryRun/.run/.verify` | internal query/mutation/query | one-time `attendanceRecords` → `attendanceSessions` migration (dry run → confirm → run → verify), see the module's own comments |
| `auth.seedAdmin` | `internalMutation` | one-time admin account creation (see [setup.md](./setup.md)) |

`attendance.recordEvent` is `internalMutation`, not a public `mutation` — the
Slack HTTP actions call it via `ctx.runMutation(internal.attendance.recordEvent, …)`,
and the Admin path calls the same underlying `recordEventLogic` function
directly through `attendance.correctRecord` (a public mutation gated by
`requireAdmin`). One shared code path, two callers, per the "do not fork this
logic per source" rule in [../agents.md](../agents.md).

## Slack integration design

1. **Signature verification** (`convex/http.ts` → `convex/slack.ts`,
   `verifySlackSignature`): every inbound request is verified with Web Crypto
   HMAC-SHA256 over `v0:{timestamp}:{body}` before any payload is trusted.
   Requests older than 5 minutes are rejected (replay protection). No Node
   action is needed — this runs as a plain `httpAction`. The HMAC key is
   imported with `["verify"]` usage (imported with `["sign"]` at one point —
   a real bug that made every Slack request fail; see
   [decisions-log.md](./decisions-log.md)).
2. **Employee resolution** (`convex/slack.ts`, `resolveEmployee()` — shared
   by both `events` and `interactions`, not duplicated per caller):
   - Look up `slackUserId` via `employees.getBySlackId` (`by_slackUserId`
     index) — fast path for a previously-matched user.
   - No match → call Slack's `users.info` for the email, look up
     `employees.getByEmail` (`by_email` index). On match, cache the
     `slackUserId` back onto the employee doc via `employees.updateSlackId`
     so the next interaction hits the fast path.
   - No match at all → `attendance.recordEvent` is still called (with
     `employeeId` omitted), which inserts an `attendanceEvents` row with
     `resolutionStatus: "UNMATCHED"` and the raw Slack id/email. An ephemeral
     "User not recognized. Please contact HR." message is sent back. Never
     silently dropped.
3. **Idempotency**: `recordEventLogic` treats a repeat `CHECK_IN` (or
   `CHECK_OUT`) from `SLACK` on a day that already has one as a no-op
   (`ALREADY_CHECKED_IN` / `ALREADY_CHECKED_OUT`), while `ADMIN`-sourced
   events always overwrite — that's what makes manual corrections possible
   without a separate code path.
4. **App Home**: on `app_home_opened`, `resolveEmployee()` runs first, then
   `publishAppHome` posts a `views.publish` call. The view is context-aware
   against `attendance.getToday` for that employee: Check In button only if
   not checked in yet, Check Out button only if checked in and not out, no
   buttons (just the completed status/times) once the day is done. An
   unresolved employee gets a "contact HR" view instead of buttons. The
   button handler (`interactions`) also calls `publishAppHome` again after
   recording the event, so the tab reflects the write immediately rather than
   waiting for the next manual reopen. Day-bucketing and displayed times both
   go through [`convex/time.ts`](../convex/time.ts) (`Asia/Karachi`, not the
   runtime's default UTC — see [decisions-log.md](./decisions-log.md)).

## TanStack Start + Cloudflare Workers deployment model

- `vite.config.ts` wires three plugins: `@tailwindcss/vite`,
  `@tanstack/react-start/plugin/vite`, and `@cloudflare/vite-plugin`
  (`viteEnvironment: { name: 'ssr' }`) — the last one is what makes the SSR
  build target the Workers runtime instead of Node.
- `wrangler.jsonc` sets `main` to
  `@tanstack/react-start/server-entry` — TanStack Start ships its own
  Workers-compatible server entry point; there's no hand-written
  `worker.ts`.
- `nodejs_compat` is enabled in `compatibility_flags` because some
  dependencies (Better Auth, Convex client) expect Node built-ins.
- Client-side Convex access goes through `ConvexQueryClient` +
  `@convex-dev/react-query`, wired in `src/router.tsx` and connected to
  React Query so Convex subscriptions drive cache updates — this is what
  makes the Admin dashboard reactive with no manual refresh once it's built.
- Auth token handoff for SSR: `src/routes/__root.tsx`'s `beforeLoad` calls a
  server function (`getAuth`, wrapping `getToken()` from
  `src/lib/auth-server.ts`) and pushes the token onto
  `convexQueryClient.serverHttpClient` before render, so the first
  server-rendered response is already authenticated instead of flashing an
  unauthenticated state.
- See [security.md](./security.md) for exactly which env vars this
  deployment model requires in Convex vs. Cloudflare Build vs. Cloudflare
  Runtime — getting that distinction wrong was a real source of broken
  deploys this build (see [decisions-log.md](./decisions-log.md)).
