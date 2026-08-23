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
