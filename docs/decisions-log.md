# Decisions log

Chronological, one entry per real decision or real bug. Reasoning and
trade-off, not just the outcome — the point of this file is that nobody
re-triggers the same bug or re-litigates a settled choice. Newest at the
bottom.

## Convex over Cloudflare D1

**Decision:** Backend + database is Convex, not D1.

**Reasoning:** The mission needs live-updating Admin dashboards (attendance
appearing "with no refresh" per [../agents.md](../agents.md)) plus an
auth component, scheduled/HTTP actions for Slack, and mutation-level
invariants (email uniqueness, one-record-per-day) with no DB-level unique
constraint to lean on. Convex gives reactive queries/subscriptions, an
auth component ecosystem (`@convex-dev/better-auth`), and transactional
mutations out of the box. D1 is plain SQL storage — reactivity, auth, and
the HTTP action layer would all have to be hand-built on top of it.

**Trade-off accepted:** an extra moving part alongside Cloudflare (two
platforms, two sets of env vars/secrets — see
[security.md](./security.md)) in exchange for not hand-rolling realtime
sync and auth.

## TanStack Start over Next.js

**Decision:** Frontend is TanStack Start (React Router + React Query +
Convex hooks), not Next.js.

**Reasoning:** TanStack Start's file-router and server functions integrate
directly with `@convex-dev/react-query`'s `ConvexQueryClient`, and it
deploys cleanly to Cloudflare Workers via `@tanstack/react-start/server-entry`
as the Worker's `main` — no adapter layer. Next.js on Cloudflare needs the
`@cloudflare/next-on-pages`/OpenNext adapter path, which adds its own set of
edge-runtime constraints on top of the ones already being managed for
Convex + Better Auth.

**Trade-off accepted:** a less mainstream framework with a smaller
ecosystem, in exchange for a materially simpler Cloudflare + Convex
deployment path.

## Cloudflare Workers over Cloudflare Pages

**Decision:** Deploy target is Cloudflare Workers (`wrangler deploy`), not
Pages.

**Reasoning:** TanStack Start's Cloudflare output is a Worker
(`@tanstack/react-start/server-entry`), not a Pages Functions bundle.
Workers also gives one deployment model for both static assets and the SSR
server function, and matches `nodejs_compat` needs for Better Auth/Convex
client dependencies.

**Trade-off accepted:** none material — Pages was never a realistic fit
once TanStack Start's Cloudflare adapter target was Workers-shaped.

## Bug: GitHub App never had repo access → silent CI failure

**What happened:** A GitHub App tied to this repo's automation lacked
repository access permissions. Because the failure mode was "the App has no
access," nothing ran and nothing surfaced as a visible error — it looked
like CI was simply idle rather than broken.

**Root cause:** repo access for the App was never granted/confirmed after
setup.

**Fix / takeaway:** when CI or an integration appears to silently do
nothing instead of failing loudly, check the App's repo access grant first,
before debugging workflow YAML or code. A "silent no-op" is a strong signal
of a permissions/access problem, not a logic problem.

## Bug: `process.env` vs `import.meta.env` for `VITE_*` vars under Cloudflare Workers

**What happened:** `src/lib/auth-server.ts` read
`process.env.VITE_CONVEX_URL` / `process.env.VITE_CONVEX_SITE_URL`. This
did not reliably resolve under the actual Cloudflare Workers build.

**Root cause:** Vite inlines `import.meta.env.VITE_*` at build time; it does
not mirror those values into `process.env`. Reading a `VITE_`-prefixed var
via `process.env` anywhere in `src/` depends on incidental Node-compat
behavior, not a guarantee — and broke under the Workers SSR build
specifically.

**Fix:** commit `ba54a42`, "Fix env var access in auth-server.ts for
Vite/Cloudflare" — switched both reads to `import.meta.env`. See
[security.md](./security.md) for the full rule and the related
Build-vs-Runtime variable entry below.

## Bug: Convex local vs. cloud deployment — local dev has no public URL, breaks Slack entirely

**What happened:** Slack's Events API and Interactivity requests need a
publicly reachable HTTPS URL (`<convex-site-url>/slack/events` and
`/slack/interactions`, per [../agents.md](../agents.md)). A `npx convex dev`
local/dev deployment does not expose one the way a deployed Convex project
does — pointing Slack's Request URLs at a local dev deployment's address
simply does not work; there is nothing at the other end for Slack to reach.

**Root cause:** conflating "Convex is running" (true for `npx convex dev`)
with "Convex is reachable from Slack's servers" (only true once Slack's
Request URLs point at the deployment's real `.convex.site` origin).

**Fix / takeaway:** the Slack app's Request URLs must always point at the
target Convex deployment's actual `.convex.site` URL, confirmed reachable,
before testing any Slack interaction — not assumed from "convex dev is
running in another terminal." See [setup.md](./setup.md).

## Bug: Cloudflare's separate Build-vs-Runtime variable scoping

**What happened:** A variable set in one Cloudflare scope (e.g. Runtime
variables/secrets on the Worker) was not visible where it was needed (the
Vite build step), and vice versa.

**Root cause:** Cloudflare treats "Build variables" (visible to the build
step that produces the deployable bundle, i.e. to `vite build` and thus to
anything read via `import.meta.env`) and "Runtime variables/secrets"
(visible to the deployed Worker at request time, i.e. to `process.env`
inside server code) as two separate scopes. Setting a var in only one scope
makes it invisible in the other context, with no error — just an
`undefined` that surfaces later, often confusingly, as a broken auth/Convex
connection.

**Fix / takeaway:** every `VITE_`-prefixed client var
(`VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`) must be set as a Cloudflare
**Build** variable. Any secret consumed only by server code inside the
Worker itself would need to be a **Runtime** variable/secret instead — but
in this project's current design, all real secrets
(`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `BETTER_AUTH_SECRET`,
`SITE_URL`) live in the Convex deployment's env, not in Cloudflare at all
(see [security.md](./security.md)'s table). Cross-check both scopes
explicitly any time a var "used to work locally" but breaks after a
Cloudflare deploy.

## Bug: duplicate TanStack Query instance breaking SSR hydration

**What happened:** The TanStack CLI scaffold's default TanStack Query
add-on wired its own `QueryClientProvider` (`src/integrations/tanstack-query/root-provider.tsx`
and `devtools.tsx`). Wiring Convex's `ConvexQueryClient` into `src/router.tsx`
added a second, separately-constructed `QueryClient`. Two independent
`QueryClient` instances meant the server-dehydrated query state and the
client's rehydrating `QueryClient` didn't necessarily agree, producing SSR
hydration inconsistencies.

**Root cause:** the scaffold's default Query provider and the hand-wired
Convex-aware Query provider were never meant to coexist — only one
`QueryClient` should exist for the whole app, created once in
`src/router.tsx` and threaded through router context
(`context: { queryClient, convexQueryClient }`), with
`setupRouterSsrQueryIntegration` handling the SSR dehydrate/hydrate
handoff.

**Fix:** commit `903693a` ("Harden Slack attendance flow and auth") deleted
`src/integrations/tanstack-query/root-provider.tsx` and `devtools.tsx`,
leaving `src/router.tsx`'s single `ConvexQueryClient`-backed `QueryClient`
as the only instance in the app.

## Bug: prod-scoped `CONVEX_DEPLOY_KEY` in `.env` hijacked `npx convex dev`

**What happened:** `.env` held a prod-scoped `CONVEX_DEPLOY_KEY` (left over
from a manual `npx convex env set ... --prod` session) alongside the usual
Slack/auth secrets. A later plain `npx convex dev --once`, run only to
type-check a change, silently targeted the production deployment
(`proficient-okapi-951`) instead of spinning up its own local/dev
deployment — no prompt, no warning that it wasn't a dev deployment.

**Root cause:** `.env`/`.env.local` are auto-loaded by every `convex`
invocation. A deploy key is scoped to one specific target deployment (dev
and prod are different keys), so an auto-loaded prod key overrides
`convex dev`'s normal behavior of managing its own dev deployment.

**Fix / takeaway:** `CONVEX_DEPLOY_KEY` is never written to `.env` or
`.env.local` — only supplied inline, per command, for a deliberately
intended prod action (`CONVEX_DEPLOY_KEY="..." npx convex <command>
--prod`), never left sitting in a file or shell that also runs everyday
`convex dev`. See [setup.md](./setup.md). **This recurred once already**
after being fixed — the key was re-added to `.env` mid-session and a plain
`npx convex dev --once` (run only to type-check an unrelated change) hijacked
prod again. Treat "is `CONVEX_DEPLOY_KEY` present in `.env`/`.env.local` right
now" as a check worth making before *any* `convex dev`, not a one-time fix.

## Bug: `verifySlackSignature` imported its HMAC key with `["sign"]` but called `.verify()` on it — every Slack request failed, silently

**What happened:** `convex/slack.ts`'s signature check imported the HMAC key
via `crypto.subtle.importKey(..., ["sign"])`, then called
`crypto.subtle.verify(...)` on that same key. WebCrypto enforces that a key's
declared usages must include the operation being performed — a key imported
for `"sign"` cannot be used with `verify()`. This threw
`InvalidAccessError: CryptoKey does not have "verify" usage` on **every**
inbound Slack request (the URL-verification handshake, `app_home_opened`,
button interactions — all of it), before any routing or resolution logic
ever ran. From the outside this looked like a Slack-side configuration
problem: the Event Subscriptions Request URL failed to verify with a generic
"HTTP error," and zero events ever showed up in `npx convex logs --prod`.

**Root cause:** a copy-paste/typo-class bug in `importKey`'s `keyUsages`
argument — should have matched the operation actually performed
(`verify`), not the opposite one (`sign`). The function never signs
anything, only verifies inbound signatures.

**Fix / takeaway:** `convex/slack.ts`'s `verifySlackSignature` now imports
the key with `["verify"]`. Takeaway for next time: when a Slack Request URL
won't verify and the log tail shows *nothing at all* (not even an error) for
url_verification, don't assume it's a Slack app-config problem first — check
`npx convex logs --prod` for an uncaught exception in the handler itself.
"Zero events ever arrive" and "the handler always throws before logging
anything useful" produce an identical symptom from Slack's side; the log
tail is what tells them apart.

## Bug: attendance day-bucketing and Slack-displayed times used UTC instead of the org's timezone

**What happened:** `attendance.ts` (`recordEvent`'s day bucketing, `getToday`),
`dashboard.ts` (`todaySnapshot`'s "today"), and `slack.ts` (the Home tab's
displayed check-in/check-out times) all computed dates/times via
`new Date(...).toISOString()` or `.toLocaleTimeString()` with no `timeZone`
option — which defaults to UTC in Convex's runtime. This team operates in
Pakistan (`Asia/Karachi`, UTC+5): displayed times were off by a flat 5 hours
(a 4:44/4:45 PM check-in/out actually happened at 9:44/9:45 PM local), and —
more seriously — the calendar-day boundary used for "one `attendanceRecords`
row per employee per day" was shifted: an event between roughly 12am-5am PKT
would bucket into the *previous* day under UTC, silently splitting what
should be one day's attendance across two `attendanceRecords` rows.

**Root cause:** no explicit `timeZone` on any `Date` formatting call in the
attendance/dashboard/Slack code paths — three independent call sites all
defaulted to UTC the same way, so the bug was consistent (no cross-path data
corruption) but uniformly wrong relative to the employee's actual local day.

**Fix:** added [convex/time.ts](../convex/time.ts) — `ORG_TIMEZONE =
'Asia/Karachi'`, plus `localDateString()` (day bucketing, via `en-CA`
locale formatting which happens to output `YYYY-MM-DD`) and
`localTimeString()` (Slack display) — and pointed all three call sites at
it instead of ad-hoc `Date` formatting. Any future "what day/time is it"
logic should import from here rather than reintroducing a fourth ad-hoc UTC
call site. If the org ever operates across multiple timezones, this single
constant is the one place that assumption would need to become
per-employee instead of global.

## Bug: reinstalling the Slack app rotates `SLACK_BOT_TOKEN`, breaking every Slack API call until it's re-synced

**What happened:** Reinstalling the Slack app to the workspace — for a
scope change, an uninstall/reinstall, or any other trigger that forces
reinstall — issues a brand new `xoxb-` Bot User OAuth Token. The value
Convex has set for `SLACK_BOT_TOKEN` (`npx convex env set` on the prod
deployment, per [setup.md](./setup.md)) does not update itself; it keeps
the old, now-invalid token until someone copies the new one over. Every
Slack API call `convex/slack.ts` makes with the stale token
(`users.info`, `views.publish`, `chat.postMessage`) then fails silently
from the outside — the symptom looks like a code bug ("should work but
doesn't") when it's actually a stale credential.

**Root cause:** the local `.env` copy of `SLACK_BOT_TOKEN` and the actual
value set on the Convex deployment are two independent copies with no
automatic sync. A reinstall updates neither on its own — updating the
local `.env` file is not the same as updating Convex's env.

**Fix / takeaway:** after *any* Slack app reinstall, re-copy the new
`xoxb-` token from Slack's OAuth & Permissions page into Convex's prod env
using the inline `CONVEX_DEPLOY_KEY` pattern established above:
`CONVEX_DEPLOY_KEY="..." npx convex env set SLACK_BOT_TOKEN "xoxb-..."
--prod`. Editing local `.env` alone does not fix anything Convex actually
calls — that's the second time in this session a stale credential caused
a "should work but doesn't" symptom, so treat "did we just reinstall the
Slack app" as a standing first-check whenever Slack API calls start
failing after previously working.
