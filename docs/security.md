# Security

## Auth boundary: admin-only

There is exactly one role. `convex/auth.ts` wires `@convex-dev/better-auth`
with `emailAndPassword` enabled and `disableSignUp: true` on the app-facing
auth instance (`createAuth`) — there is no signup UI and no path to create an
account except the seed mutation (below). A second, internal-only auth
builder (`createSeedAuth`) has `disableSignUp: false` and is only ever used
by `auth.seedAdmin`, never exposed to the client.

Every Admin-facing query and mutation (`employees.list/create/update/deactivate`,
`attendance.listRecords/correctRecord/listUnmatched/linkUnmatched`) starts
with `await requireAdmin(ctx)`, defined in `convex/auth.ts`:

```ts
export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx)
  if (!user) throw new ConvexError('Authentication required')
  return user
}
```

There's no per-user role check beyond "is there an authenticated user at
all" — that's correct for this phase (single Admin role, no Manager/Employee
login per [../agents.md](../agents.md)'s hard constraints), but if a second
role is ever introduced, every one of these call sites needs a role check
added, not just the login screen.

The Slack-only internal functions (`employees.getBySlackId`, `.getByEmail`,
`.updateSlackId`, and `attendance.recordEvent` itself) are `internalQuery`/
`internalMutation` — they have no `requireAdmin` check because they are not
reachable from the client at all; only `convex/slack.ts`'s `httpAction`s can
call them via `ctx.runQuery`/`ctx.runMutation(internal.*, …)`.

## Session lifetime and cookie cache — the revocation-latency tradeoff

`convex/auth.ts`'s `buildAuth` configures Better Auth's `session` options
(shape verified against the installed `@better-auth/core` types, not
assumed):

```ts
session: {
  expiresIn: 60 * 60 * 24 * 30, // 30 days
  updateAge: 60 * 60 * 24,      // refresh at most once/day of activity
  cookieCache: { enabled: true, maxAge: 60 * 5 }, // 5 minutes
}
```

`cookieCache` is the actual efficiency win: with it enabled, most session
checks validate off a signed cookie instead of round-tripping to the
database, and only fall back to a real DB check once `maxAge` (5 minutes)
elapses.

**The tradeoff, stated plainly, not hidden:** for up to `maxAge`, a session
that was just revoked — an admin manually invalidated, deactivated, or
otherwise cut off server-side — can still validate successfully off the
stale cached cookie, because the check isn't hitting the database to notice
the revocation. Worst case with the current config: **up to 5 minutes**
where a revoked session still works.

Why this is an acceptable tradeoff here, not just an overlooked one: this is
a single-admin internal tool (one seeded account, no signup, no
multi-tenant blast radius), served over HTTPS, with no current UI path to
revoke a session at all — so the realistic exposure window today is
theoretical. It would stop being acceptable the moment this app grows a
second role, a "sign out other sessions" feature, or any scenario where an
admin's access needs to be cut off *immediately* (e.g. an offboarding). If
that happens, either lower `cookieCache.maxAge`, add
`cookieCache.refreshCache` tuning, or reassess whether `cookieCache` should
be enabled at all for that flow.

## Slack signature verification and idempotency

Implemented in `convex/slack.ts`, `verifySlackSignature`, called at the top
of both `events` and `interactions` before the request body is trusted for
anything:

1. Read `X-Slack-Signature` and `X-Slack-Request-Timestamp`. Missing either
   → reject.
2. **Replay protection**: reject if `|now - timestamp| > 300s`.
3. Recompute `v0:{timestamp}:{rawBody}`, HMAC-SHA256 it with
   `SLACK_SIGNING_SECRET` via Web Crypto (`crypto.subtle`, no Node `crypto`
   import needed — this runs fine as a Convex `httpAction`), and compare
   against the supplied signature using `crypto.subtle.verify` (constant-time).
4. The signature format is validated (`v0=` prefix, 64 hex chars) before
   attempting to decode it, so malformed headers fail fast without ever
   touching the HMAC compare.

Only after this passes does the handler parse JSON/`URLSearchParams` and act
on Slack's claimed user identity. **Never trust `payload.user.id` before
this check runs** — this is the one thing that must never regress.

Idempotency lives in `attendance.recordEventLogic` (`convex/attendance.ts`),
not in the HTTP layer: a repeat `SLACK`-sourced `CHECK_IN`/`CHECK_OUT` on a
day that already has one returns `ALREADY_CHECKED_IN`/`ALREADY_CHECKED_OUT`
without mutating `attendanceRecords` again, while `ADMIN`-sourced events
always overwrite. This is also what a manual correction is: the same
mutation, called with `source: "ADMIN"`, which the idempotency check lets
through as an intentional overwrite instead of a duplicate.

Manual corrections never patch `attendanceRecords` directly — every
correction goes through `attendance.correctRecord` → `recordEventLogic`,
which appends a new `attendanceEvents` row (`source: "ADMIN"`) and sets
`correctedByAdmin: true` on the derived record. The audit trail
(`attendanceEvents` is append-only, never mutated) is not optional per
[../agents.md](../agents.md) and there is currently no code path that
bypasses it.

## Secrets management — which vars live where, and why

This distinction cost real debugging time this session (see the
`process.env` vs `import.meta.env` and Build-vs-Runtime entries in
[decisions-log.md](./decisions-log.md)) — read this section before touching
env handling.

There are **three separate places** a variable can live, and they are not
interchangeable:

| Location | Who reads it | How it's read | What lives there |
|---|---|---|---|
| **Convex deployment env** | Convex functions (`convex/*.ts`), running in Convex's own runtime | `process.env.X` inside a Convex function | `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `BETTER_AUTH_SECRET`, `SITE_URL` |
| **Cloudflare Build variables** | Vite, during `vite build` (both local `npm run build` and Cloudflare's build step) | `import.meta.env.X`, and only if the var name is prefixed `VITE_` | `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` |
| **Cloudflare Runtime variables / secrets** | The deployed Worker, at request time | `process.env.X` inside Worker/server code (via `nodejs_compat`) | Any server-only secret the Worker itself needs directly (none currently — auth/Slack secrets live in Convex, not Cloudflare, since all of that logic runs in Convex functions, not in the Worker) |

Why the split matters:

- **Convex env vars are invisible to the Cloudflare build and the Worker.**
  They only exist inside Convex's deployment, reachable only from
  `convex/*.ts` functions. Setting `SLACK_SIGNING_SECRET` in Cloudflare does
  nothing — it has to go through `npx convex env set` (or the Convex
  dashboard) against the target deployment. See [setup.md](./setup.md).
- **`VITE_`-prefixed vars are inlined into the client bundle at build time**
  by Vite. They must be readable via `import.meta.env`, and they must be
  present when `vite build` runs — not just present at request time in the
  deployed Worker. This is why they're a Cloudflare **Build** variable, not
  a Runtime one: if you only set `VITE_CONVEX_URL` as a Cloudflare Runtime
  variable, the build step that produces the static/SSR bundle never sees
  it, and `import.meta.env.VITE_CONVEX_URL` bakes in as `undefined`.
- **`process.env.X` inside Worker/SSR code and `import.meta.env.X` are not
  interchangeable**, even for the same underlying value. `src/lib/auth-server.ts`
  originally read `process.env.VITE_CONVEX_URL` / `process.env.VITE_CONVEX_SITE_URL`;
  this worked in some local dev paths but broke under the actual Cloudflare
  Workers build, because Vite only rewrites `import.meta.env.*` references at
  build time — it does not populate `process.env` with `VITE_`-prefixed
  values for you. Fixed in commit `ba54a42` by switching both reads to
  `import.meta.env`. **Rule of thumb: any `VITE_`-prefixed var, anywhere in
  `src/`, is read via `import.meta.env`, never `process.env`.**

## Pending Convex/auth hardening changes

The current `convex/auth.ts`, `attendance.ts`, `employees.ts`, and
`slack.ts` already reflect a hardening pass (typed internal
queries/mutations for Slack-only paths, `requireAdmin` on every
Admin-facing function, stricter Slack payload validation before employee
resolution — see commit `903693a`, "Harden Slack attendance flow and
auth"). There are no further hardening changes pending review at the time
of writing. If a future session lands another security-relevant diff to
`convex/`, log it here with what changed and why before merging — this file
is the reviewed record, [decisions-log.md](./decisions-log.md) is the
narrative one.
