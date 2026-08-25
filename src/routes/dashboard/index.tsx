import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import { DataTable } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import { dayLabel, relativeTime } from '../../lib/format'
import type { Id } from '../../../convex/_generated/dataModel'

export const Route = createFileRoute('/dashboard/')({
  component: DashboardHome,
})

function DashboardHome() {
  // All three reactive: this view updates itself as Slack events land,
  // same as the Employee/Attendance lists — no refresh button anywhere.
  const { data: snapshot } = useQuery(convexQuery(api.dashboard.todaySnapshot, {}))
  const { data: activity } = useQuery(convexQuery(api.dashboard.recentActivity, {}))
  const { data: employees } = useQuery(convexQuery(api.employees.list, {}))

  const employeeName = (id?: Id<'employees'>) =>
    (id && employees?.find((e) => e._id === id)?.fullName) || undefined

  const today = snapshot?.date

  return (
    <>
      <div className="stat-grid">
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{ status: 'PRESENT', startDate: today ?? '', endDate: today ?? '' }}
        >
          <div className="stat-number">{snapshot?.present ?? '—'}</div>
          <div className="stat-label">Present today</div>
        </Link>
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{
            status: 'MISSING_CHECKOUT',
            startDate: today ?? '',
            endDate: today ?? '',
          }}
        >
          <div className="stat-number">{snapshot?.missingCheckout ?? '—'}</div>
          <div className="stat-label">Missing checkout</div>
        </Link>
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{ status: 'COMPLETE', startDate: today ?? '', endDate: today ?? '' }}
        >
          <div className="stat-number">{snapshot?.complete ?? '—'}</div>
          <div className="stat-label">Complete</div>
        </Link>
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{ status: 'INCOMPLETE', startDate: today ?? '', endDate: today ?? '' }}
        >
          <div className="stat-number">{snapshot?.incomplete ?? '—'}</div>
          <div className="stat-label">Incomplete</div>
        </Link>
        {/* No matching computed status exists for "not checked in" — it's
            the absence of a session that day, not a status value (see
            convex/attendanceStatus.ts) — so this links to today's
            attendance unfiltered rather than a status that can't be
            expressed as a filter. */}
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{ status: '', startDate: today ?? '', endDate: today ?? '' }}
        >
          <div className="stat-number">{snapshot?.notCheckedIn ?? '—'}</div>
          <div className="stat-label">Not checked in</div>
        </Link>
      </div>

      {/* Deliberately outside .stat-grid: total headcount is a different
          kind of number from the four cards above (roster size vs. today's
          status breakdown), not a 5th daily stat — grouping it apart avoids
          the grid ever needing to resolve an odd card count into a clean
          row, and is the more honest read of what this number actually is. */}
      <Link to="/dashboard/employees" className="card team-card">
        <div className="team-card-meta">
          <span className="stat-number">{employees?.length ?? '—'}</span>
          <span className="stat-label">Employees</span>
        </div>
        <span className="team-card-cta">View all →</span>
      </Link>

      <section className="card">
        <h2>Recent activity</h2>
        {activity === undefined ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <DataTable
            rows={activity}
            rowKey={(e) => e._id}
            emptyMessage="No attendance events yet."
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (e) =>
                  employeeName(e.employeeId) ?? e.rawSlackEmail ?? 'Unrecognized',
              },
              {
                key: 'event',
                header: 'Event',
                render: (e) => <StatusBadge status={e.eventType} />,
              },
              {
                key: 'time',
                header: 'When',
                // occurredAt (the actual check-in/out instant), not
                // _creationTime (row insert time) — they usually match, but
                // an ADMIN correction can backdate occurredAt, and this is
                // also the same instant attendanceSessions is day-bucketed by,
                // so the label here stays consistent with which day's
                // snapshot the event actually counts toward.
                render: (e) => `${dayLabel(e.occurredAt)}, ${relativeTime(e.occurredAt)}`,
              },
            ]}
          />
        )}
      </section>
    </>
  )
}
