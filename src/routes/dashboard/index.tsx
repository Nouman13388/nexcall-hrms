import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  component: DashboardHome,
})

function DashboardHome() {
  return (
    <section className="card">
      <h2>Welcome back</h2>
      <p className="intro" style={{ margin: 0 }}>
        Pick a workspace to get started.
      </p>
      <div className="form-actions" style={{ marginTop: '1.25rem' }}>
        <Link to="/dashboard/employees" className="primary-link">
          Manage employees
        </Link>
        <Link
          to="/dashboard/attendance"
          className="primary-link button-secondary"
        >
          View attendance
        </Link>
      </div>
    </section>
  )
}
