import { createFileRoute, redirect } from '@tanstack/react-router'

// `/` never renders anything — same isAuthenticated check
// /dashboard/route.tsx's guard uses, computed once in __root.tsx's
// beforeLoad. No component: beforeLoad always throws a redirect, so there's
// nothing left to render here.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: context.isAuthenticated ? '/dashboard' : '/login' })
  },
})
