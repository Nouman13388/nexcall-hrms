# Setup

Everything a fresh session or a new machine needs before touching feature
code. Cross-references [security.md](./security.md) for *why* each var
lives where it does — this file is just the checklist.

## Prerequisites

- Node.js 22+
- A Convex account and project (`npx convex dev` — authenticates via
  browser, creates the deployment)
- A Slack workspace you can install an app into

## 1. Convex deployment

```bash
npx convex dev
```

This authenticates via browser and creates/connects the deployment. Note
both URLs it prints:

- `https://<name>.convex.cloud` — the Convex API URL (`VITE_CONVEX_URL`)
- `https://<name>.convex.site` — the Convex HTTP actions URL
  (`VITE_CONVEX_SITE_URL`), also the base for the Slack Request URLs below

**Local vs. cloud deployment — this matters more than it sounds like it
should:** `npx convex dev` gives you a working deployment, but Slack needs
to reach `<convex-site-url>/slack/events` and `/slack/interactions` over
real HTTPS. Make sure the Slack app's Request URLs point at the actual
`.convex.site` origin for the deployment you're testing against, not an
assumption that "convex dev running locally" is enough — see the
decisions-log entry in [decisions-log.md](./decisions-log.md) for the
exact failure mode this caused.

### `CONVEX_DEPLOY_KEY` — never stored, always inline

`CONVEX_DEPLOY_KEY` is **never** kept in `.env` or `.env.local` — not even
temporarily. A key sitting in either file gets loaded automatically by every
`npx convex dev` invocation, and since a deploy key is scoped to a specific
target deployment (dev vs. prod are different keys), an auto-loaded
prod-scoped key silently hijacks `convex dev` into operating on production
instead of spinning up its own local/dev deployment — no prompt, no warning.
This already happened once in this project; see
[decisions-log.md](./decisions-log.md).

The rule: `CONVEX_DEPLOY_KEY` is supplied **inline, per command**, only when
a prod action is genuinely intended, and only for that one invocation —
never exported into a shell you also use for everyday `convex dev`, never
written to a file that's auto-loaded.

```bash
# Everyday local work — no deploy key present anywhere, dev deployment only
npx convex dev

# A genuinely intended prod action — key supplied inline, scoped to this command
CONVEX_DEPLOY_KEY="prod:<deployment>|<key>" npx convex env set SOME_VAR value --prod
CONVEX_DEPLOY_KEY="prod:<deployment>|<key>" npm run deploy
```

Generate the key fresh from the Convex dashboard for the target deployment
each time you need one; don't keep a copy on disk.

## 2. Slack app

Create at [api.slack.com/apps](https://api.slack.com/apps):

1. **Scopes** (OAuth & Permissions → Bot Token Scopes): `users:read`,
   `users:read.email`, `chat:write`
2. **Interactivity & Shortcuts**: enable, set Request URL to
   `<convex-site-url>/slack/interactions`
3. **Event Subscriptions**: enable, set Request URL to
   `<convex-site-url>/slack/events`
4. **Install App to Workspace**
5. Copy:
   - **Signing Secret** (Basic Information → App Credentials) →
     `SLACK_SIGNING_SECRET`
   - **Bot User OAuth Token** (OAuth & Permissions) → `SLACK_BOT_TOKEN`

## 3. Environment variables — which vars go where

Full rationale in [security.md](./security.md#secrets-management--which-vars-live-where-and-why).
Quick reference:

**Convex deployment env** (`npx convex env set <NAME> <value>`, or the
Convex dashboard — never in a client-exposed file):

| Var | Value |
| --- | --- |
| `SLACK_SIGNING_SECRET` | from the Slack app's Basic Information page |
| `SLACK_BOT_TOKEN` | from the Slack app's OAuth & Permissions page |
| `BETTER_AUTH_SECRET` | a random secret for Better Auth session signing |
| `SITE_URL` | this app's public site URL (used as Better Auth's `baseURL`) |

**Cloudflare Build variables** (must be present during `vite build`, both
locally and in Cloudflare's build step — read via `import.meta.env` in
`src/`, never `process.env`):

| Var | Value |
| --- | --- |
| `VITE_CONVEX_URL` | the `.convex.cloud` URL from step 1 |
| `VITE_CONVEX_SITE_URL` | the `.convex.site` URL from step 1 |

Copy `.env.example` to `.env.local` for local dev with the same two
`VITE_*` values — `.env.local` is git-ignored.

**Cloudflare Runtime variables/secrets:** none currently — every server-side
secret this app needs lives in Convex's env instead (see the table above),
because all Slack/auth logic runs inside Convex functions, not inside the
Cloudflare Worker.

## 4. Seed the first Admin + first employee

Run the `auth.seedAdmin` internal mutation (via the Convex dashboard
Functions tab, or a one-off script) with the email/password you'll log in
with.

Have your own email ready as the **first `employees` record** too (create
it via `employees.create` once the Admin UI or a dashboard mutation call is
available) — you'll use it to test the Slack auto-match (`by_email` lookup
→ `slackUserId` cache) live, per [../agents.md](../agents.md).

## 5. Run it

```bash
npm install
npm run dev             # http://localhost:3000
```

Other commands:

```bash
npm run typecheck       # TypeScript validation
npm run build           # Production build
npm run generate-routes # Regenerate the TanStack route tree
npm run preview         # Convex deploy (build) + wrangler dev, for a local prod-like check
npm run deploy          # Convex deploy + wrangler deploy — confirm the target deployment first
```

## 6. Verify before calling it done

1. `npm run typecheck && npm run build` — both clean.
2. Open the deployed (or local) `/login` route in a real browser, check the
   console for errors.
3. From Slack, open the app's Home tab and do one real Check In / Check Out.
   Confirm it lands in Convex (`attendanceEvents` + `attendanceRecords`)
   before writing any more UI — this is the Phase 2 checkpoint in
   [../agents.md](../agents.md) and [status.md](./status.md).
