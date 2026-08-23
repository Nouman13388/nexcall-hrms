import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { api } from '../../../convex/_generated/api'
import { DataTable } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import { relativeTime } from '../../lib/format'
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
        {/* No matching attendanceRecords.status exists for "not checked
            in" — it's the absence of a row, not a status value — so this
            links to today's attendance unfiltered rather than a status
            that can't be expressed as a filter. */}
        <Link
          to="/dashboard/attendance"
          className="card stat-card"
          search={{ status: '', startDate: today ?? '', endDate: today ?? '' }}
        >
          <div className="stat-number">{snapshot?.notCheckedIn ?? '—'}</div>
          <div className="stat-label">Not checked in</div>
        </Link>
        <Link to="/dashboard/employees" className="card stat-card">
          <div className="stat-number">{employees?.length ?? '—'}</div>
          <div className="stat-label">Employees</div>
        </Link>
      </div>

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
                render: (e) => relativeTime(e._creationTime),
              },
            ]}
          />
        )}
      </section>
    </>
  )
}
