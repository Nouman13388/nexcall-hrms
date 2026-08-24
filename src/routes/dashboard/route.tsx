import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '../../lib/auth-client'

// The one shared authenticated-route layout: every protected route (this
// one, employees, attendance, and whatever Phase 4 adds later) nests under
// `/dashboard` and gets this guard + nav for free instead of reimplementing
// its own auth check.
//
// This is a UX guard, not a data authorization boundary (see TanStack's
// authenticated-routes guide) — the real enforcement is `requireAdmin` in
// each Convex query/mutation, which already exists independently of this.
export const Route = createFileRoute('/dashboard')({
  beforeLoad: ({ context }) => {
    if (!context.isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <div className="app-shell">
      <nav className="app-nav">
        <Link to="/dashboard" className="brand">
          Nexcall HRMS
        </Link>
        <Link to="/dashboard/employees" activeProps={{ className: 'active' }}>
          Employees
        </Link>
        <Link to="/dashboard/attendance" activeProps={{ className: 'active' }}>
          Attendance
        </Link>
        <LogoutButton />
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

function LogoutButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleLogout = async () => {
    setIsLoading(true)
    const { error } = await authClient.signOut()

    // A hard navigation, not router.navigate() — mirrors login.tsx.
    // __root.tsx's beforeLoad caches the server auth check for 30s
    // (AUTH_CACHE_MS) to dedupe hover+click preloads; a client-side route
    // change would keep serving that stale "authenticated" result instead
    // of picking up the now-cleared session cookie. A full reload forces a
    // fresh server-side check.
    if (error) {
      setIsLoading(false)
      window.alert(error.message || 'Logout failed. Please try again.')
      return
    }

    window.location.href = '/login'
  }

  return (
    <button
      type="button"
      className="logout-button"
      onClick={handleLogout}
      disabled={isLoading}
    >
      {isLoading ? 'Signing out...' : 'Log out'}
    </button>
  )
}
