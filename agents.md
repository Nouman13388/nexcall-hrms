# Nexcall HRMS — Phase 1 Build (Antigravity mission brief / AGENTS.md)

Save this file as `AGENTS.md` in the project root. Antigravity reads it as the standing ruleset for every agent session, not a one-time instruction — don't treat it as consumed after Phase 0.

## Mission

Build a working attendance-management system: Slack check-in/out → Convex → live Admin dashboard. Admin role only. Nothing else. Target: 3 hours, walking-skeleton first.

## Before the clock starts (you do this, ~10 min, not agent work)

1. `npx convex dev` in the project — authenticates via browser, creates the deployment. Note the `.convex.cloud` and `.convex.site` URLs.
2. Create a Slack app at api.slack.com/apps:
   - Scopes: `users:read`, `users:read.email`, `chat:write`
   - Enable Interactivity, set Request URL to `<convex-site-url>/slack/interactions`
   - Enable Events API, set Request URL to `<convex-site-url>/slack/events`
   - Install to workspace, copy Signing Secret + Bot Token
3. Set Convex env vars: `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `BETTER_AUTH_SECRET`, `SITE_URL`
4. Have your own email ready as the first employee record — you'll use it to test the Slack auto-match live.

## Hard constraints — non-negotiable

- Do not invent scope beyond this doc. Ambiguous → stop and report, don't guess and proceed.
- Admin only. No leave, shifts, Manager/Employee login, Google Sheets, biometric — not even stubs.
- Convex has no DB-level unique constraint. Employee email uniqueness and "one `attendanceRecords` row per employee/day" must be enforced in mutation code with a query-before-insert check — don't skip this because the schema doesn't force it.
- Never trust Slack request identity before the signature is verified. Verify on every inbound request; reject anything >5 min old (replay protection).
- Manual admin corrections write a new `attendanceEvents` row with `source = "ADMIN"` — never a silent field edit on `attendanceRecords`. Audit trail is not optional.

## Time-boxed build order (walking skeleton, not feature-by-feature)

**Phase 0 — 15 min — scaffold**
Human already ran: `npx @tanstack/cli create . --add-ons tanstack-query -y --force`, 
`npm install convex better-auth @convex-dev/better-auth`, `npx convex dev`.
Agent: wire ConvexProvider in router.tsx per docs.convex.dev/quickstart/tanstack-start, 
set up @convex-dev/better-auth for a single seeded Admin login (no signup form).

**Phase 1 — 35 min — schema + core mutation**
`convex/schema.ts` per §Schema below. Build ONE shared mutation, `attendance.recordEvent`, that both the Slack path and the future Admin manual-correction path call — do not fork this logic per source. `employees.create/list/update/deactivate`.

**Phase 2 — 45 min — Slack path end-to-end. This is the checkpoint.**
`convex/http.ts` routes for `/slack/events` and `/slack/interactions`, signature verification (Web Crypto, no Node action needed), employee resolution (`slackUserId` index → email lookup + cache → unmatched fallback), idempotency check via `recordEvent`, App Home view with Check In/Check Out buttons.
**Test a real check-in from your own Slack account before writing another line of UI.** If Slack → Convex isn't verifiably working, stop and fix it — everything after this assumes it works.

**Phase 3 — 45 min — Admin UI**
Login screen, employee list + create/edit/deactivate, attendance list with employee/date-range/status filters (reactive — no manual refresh).

**Phase 4 — 30 min — corrections + unmatched review**
Manual correction UI on `attendanceRecords` (via `attendance.recordEvent`, `source="ADMIN"`), unmatched-events queue with a manual link-to-employee action.

**Phase 5 — 10 min — smoke pass**
One employee checks in/out via Slack and it appears live on the Admin dashboard with no refresh. One manual correction round-trips and shows `correctedByAdmin: true`. One unmatched event gets linked and reclassified.

**If time runs out, cut Phase 4 first, not Phase 2.** A working Slack→Convex→live-dashboard loop with employee CRUD is a complete, demoable Phase 1 on its own. Corrections/unmatched-review can ship in a follow-up session without touching what's already built.

**Optional accelerator**: Phase 1 (schema/mutations) and the routing/UI shell portion of Phase 3 have no hard dependency on each other once the schema types exist — if using Antigravity's Manager view, these can run as parallel agents to compress the budget further.

## Stack

Convex (backend + DB) · TanStack Start via React Query + Convex hooks (frontend) · `@convex-dev/better-auth` (auth, single Admin role) · `convex/http.ts` HTTP actions for Slack.

## Schema (`convex/schema.ts`)

```ts
employees: defineTable({
  fullName: v.string(),
  email: v.string(),                    // uniqueness enforced in mutation
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

## Slack employee resolution flow

1. Interaction arrives with Slack `user.id` → lookup `by_slackUserId`. Match → fast path.
2. No match → `users.info` for email → lookup `by_email` → match → mutation caches `slackUserId` on the employee doc.
3. No match at all → insert `attendanceEvents` with `resolutionStatus: "UNMATCHED"`, raw Slack id/email populated, ephemeral "not recognized, contact HR" response. Never silently dropped or guessed.

## Function surface

| function | type | purpose |
|---|---|---|
| `slack.events` / `slack.interactions` | httpAction | Slack Events API + Interactivity, signature-verified |
| `employees.list/create/update/deactivate` | query/mutation | Admin employee CRUD |
| `attendance.recordEvent` | mutation | shared write path for Slack + Admin sources, includes idempotency check |
| `attendance.listRecords` | query | filter by employee/date/status |
| `attendance.correctRecord` | mutation | wraps `recordEvent` with `source="ADMIN"` |
| `attendance.listUnmatched` / `.linkUnmatched` | query/mutation | unmatched-event review queue |

## Definition of done for this session

- [ ] Admin can log in (seeded account, no signup flow)
- [ ] Admin can create/edit/deactivate an employee
- [ ] A real Slack check-in/check-out from a matched employee updates `attendanceRecords` and appears on the Admin dashboard live
- [ ] An unresolved Slack event (unknown email) lands in the unmatched queue instead of failing silently or crashing
- [ ] At least one manual correction round-trips and is visibly flagged `correctedByAdmin: true`

Everything else in the full case-study doc (leave, shifts, Manager/Employee roles, Google Sheets, biometric) stays out — this session doesn't touch it, not even as a stub.