import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

import type { ReactNode } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { ConvexProvider } from 'convex/react'
import { routerWithQueryClient } from '@tanstack/react-router-with-query'
import TanstackQueryProvider, {
  getContext,
} from './integrations/tanstack-query/root-provider'
import { ConvexProvider, ConvexReactClient } from 'convex/react'

const convexUrl = import.meta.env.VITE_CONVEX_URL as string
if (!convexUrl) throw new Error('VITE_CONVEX_URL is not set')

export function getRouter() {
  const convexQueryClient = new ConvexQueryClient(convexUrl, {
    expectAuth: true,
  })

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: convexQueryClient.hashFn(),
        queryFn: convexQueryClient.queryFn(),
      },
    },
  })
  
  convexQueryClient.connect(queryClient)

  const router = routerWithQueryClient(
    createTanStackRouter({
      routeTree,
      context: { queryClient, convexQueryClient },
      Wrap: ({ children }) => (
        <ConvexProvider client={convexQueryClient.convexClient}>{children}</ConvexProvider>
      ),
      scrollRestoration: true,
      defaultPreload: 'intent',
      defaultPreloadStaleTime: 0,
    }),
    queryClient
  )

  setupRouterSsrQueryIntegration({ router, queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
