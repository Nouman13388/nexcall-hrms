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

attendanceRecords: defineTable({        // derived, one row per employee per day
  employeeId: v.id("employees"),
  date: v.string(),                     // ISO date
  checkInAt: v.optional(v.number()),
  checkOutAt: v.optional(v.number()),
  workingHours: v.optional(v.number()),
  status: v.union(v.literal("PRESENT"), v.literal("MISSING_CHECKOUT"), v.literal("COMPLETE")),
  correctedByAdmin: v.boolean(),
})
  .index("by_employee_date", ["employeeId", "date"]),
```

Convex has no DB-level unique constraint, so two things are enforced in
mutation code instead of the schema:

- **Employee email uniqueness** — `employees.create` normalizes the email
  (trim + lowercase) and does a query-before-insert on `by_email` before
  inserting.
- **One `attendanceRecords` row per employee per day** — `recordEventLogic`
  in `convex/attendance.ts` looks up the existing row via `by_employee_date`
  and patches it instead of inserting a duplicate.

## Function surface

| function | type | purpose |
|---|---|---|
| `slack.events` / `slack.interactions` | `httpAction` | Slack Events API + Interactivity, signature-verified |
| `employees.list/create/update/deactivate` | query/mutation | Admin employee CRUD (all gated by `requireAdmin`) |
| `employees.getBySlackId/getByEmail/updateSlackId` | internal query/mutation | Slack-only employee resolution helpers, not callable from the client |
| `attendance.recordEvent` | `internalMutation` | shared write path for Slack + Admin sources, includes idempotency check |
| `attendance.listRecords` | query | filter by employee/date range/status |
| `attendance.correctRecord` | mutation | wraps the same recording logic with `source: "ADMIN"` |
| `attendance.listUnmatched` / `.linkUnmatched` | query/mutation | unmatched-event review queue |
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
   action is needed — this runs as a plain `httpAction`.
2. **Employee resolution** (`convex/slack.ts` → `interactions`):
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
4. **App Home**: `publishAppHome` posts a `views.publish` call with Check
   In / Check Out buttons (`action_id: check_in_action` / `check_out_action`)
   whenever Slack sends an `app_home_opened` event.

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
