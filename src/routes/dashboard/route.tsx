import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'

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
        <span className="brand">Nexcall HRMS</span>
        <Link to="/dashboard/employees" activeProps={{ className: 'active' }}>
          Employees
        </Link>
        <Link to="/dashboard/attendance" activeProps={{ className: 'active' }}>
          Attendance
        </Link>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
