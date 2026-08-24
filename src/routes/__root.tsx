import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouteContext,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import type { AuthClient } from '@convex-dev/better-auth/react'
import type { ConvexQueryClient } from '@convex-dev/react-query'
import { authClient } from '../lib/auth-client'
import { getToken } from '../lib/auth-server'
import appCss from '../styles.css?url'
import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
  convexQueryClient: ConvexQueryClient
}

const getAuth = createServerFn({ method: 'GET' }).handler(async () => {
  return await getToken()
})

// beforeLoad re-runs on every preload (hover) *and* every navigation (click)
// by design — TanStack Router's preloadStaleTime only governs loader data,
// never beforeLoad (see docs/guide/preloading). So a hover immediately
// followed by a click was firing getAuth() twice. Dedupe it here instead.
//
// Client-side only: this is module state in the browser, scoped to one
// user's tab, so it's safe to cache. It must NOT run server-side, where the
// same module state would be shared across different users' requests in a
// warm Worker isolate — SSR always checks the real request's session fresh.
const AUTH_CACHE_MS = 30_000
let cachedAuthCall: { promise: ReturnType<typeof getAuth>; at: number } | null =
  null

function getCachedAuth() {
  // This check must run first. If window is ever defined during SSR (a
  // polyfill, a reordered guard), cachedAuthCall becomes shared state across
  // different users' requests on a warm Worker isolate — a real session
  // leak, not a style issue.
  if (typeof window === 'undefined') return getAuth()
  const now = Date.now()
  if (!cachedAuthCall || now - cachedAuthCall.at > AUTH_CACHE_MS) {
    cachedAuthCall = { promise: getAuth(), at: now }
  }
  return cachedAuthCall.promise
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Nexcall HRMS',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      // No brand asset existed anywhere in the repo (checked for a logo/
      // favicon from the marketing site work — none found) — a plain
      // wordmark initial in the existing brand teal (#247f82, matches
      // .app-nav/button colors in styles.css), inlined as a data URI so it
      // doesn't need its own asset-pipeline entry.
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23247f82'/%3E%3Ctext x='32' y='45' font-family='Arial, Helvetica, sans-serif' font-size='34' font-weight='700' fill='%23ffffff' text-anchor='middle'%3EN%3C/text%3E%3C/svg%3E",
      },
    ],
  }),
  beforeLoad: async (ctx) => {
    const token = await getCachedAuth()
    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    return {
      isAuthenticated: !!token,
      token,
    }
  },
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  const context = useRouteContext({ from: Route.id })
  return (
    <ConvexBetterAuthProvider
      client={context.convexQueryClient.convexClient}
      // Upstream type regression: get-convex/better-auth#420.
      authClient={authClient as unknown as AuthClient}
      initialToken={context.token}
    >
      <Outlet />
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
