import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">Nexcall HRMS</p>
        <h1>Attendance management</h1>
        <p className="intro">
          Slack attendance is connected. Sign in to the admin workspace to
          manage employee and attendance records.
        </p>
        <Link className="primary-link" to="/login">
          Continue to admin login
        </Link>
      </section>
    </main>
  )
}
