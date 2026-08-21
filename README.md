# Nexcall HRMS

Admin-only attendance management built with TanStack Start, Convex, Better Auth,
Slack, and Cloudflare Workers.

## Current scope

- Slack App Home check-in and check-out
- Signature verification and five-minute replay protection
- Employee matching by Slack ID, then email
- Append-only attendance events and derived daily records
- Unmatched Slack event capture
- Seeded admin authentication
- Admin UI in progress

Leave, shifts, employee/manager portals, biometrics, and spreadsheet sync are
intentionally out of scope. See [agents.md](./agents.md) for the complete build
rules.

## Local development

Requirements: Node.js 22+, a Convex deployment, and a configured Slack app.

```bash
npm install
npm run dev
```

The web app runs at `http://localhost:3000`.

Copy `.env.example` to `.env.local` and provide the public Convex URLs. Keep
Slack and Better Auth secrets in the Convex deployment environment, not in
client-exposed variables.

## Commands

```bash
npm run dev             # Local TanStack Start server
npm run typecheck       # TypeScript validation
npm run build           # Production build
npm run generate-routes # Regenerate the TanStack route tree
npm run deploy          # Convex + Cloudflare production deploy
```

Production deploys require confirming both the Convex and Cloudflare targets.
Do not run `npm run deploy` against an unidentified deployment.

## Required configuration

Web application:

- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`

Convex deployment:

- `SLACK_SIGNING_SECRET`
- `SLACK_BOT_TOKEN`
- `BETTER_AUTH_SECRET`
- `SITE_URL`

Slack routes:

- Events: `<convex-site-url>/slack/events`
- Interactions: `<convex-site-url>/slack/interactions`

## Architecture

1. Slack signs and sends an interaction to a Convex HTTP action.
2. Convex verifies the signature before reading identity data.
3. The employee is resolved by cached Slack ID or Slack email.
4. A shared internal mutation appends the event and updates the daily record.
5. Convex subscriptions drive the admin UI without manual refresh.

Only the HTTP Slack boundary can call Slack-specific helper functions. Admin
queries and mutations require an authenticated Better Auth user.

## Verification

Before shipping:

```bash
npm run typecheck
npm run build
```

Then verify the deployed `/login` route in a real browser, check the browser
console, and complete one Slack check-in/out round trip.
