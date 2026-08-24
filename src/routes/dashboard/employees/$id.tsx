import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { api } from '../../../../convex/_generated/api'
import { DataTable } from '../../../components/DataTable'
import { StatusBadge } from '../../../components/StatusBadge'
import { formatClockTime } from '../../../lib/format'
import type { Id } from '../../../../convex/_generated/dataModel'

// The foundation roadmap.md's Priority 2 monthly-report route nests under
// (`/dashboard/employees/:id/report`) — a real page now, not a placeholder,
// so that nesting has somewhere real to attach to later.
export const Route = createFileRoute('/dashboard/employees/$id')({
  component: EmployeeDetailPage,
})

function EmployeeDetailPage() {
  const { id } = Route.useParams()
  const employeeId = id as Id<'employees'>

  // Same pattern the list/edit views already use (employees.tsx) rather
  // than a dedicated `employees.get` query — employees.list is already
  // bounded (500 rows), admin-gated, and subscribed everywhere else in
  // this app, so finding one row client-side avoids a second query shape
  // for the same data.
  const { data: employees } = useQuery(convexQuery(api.employees.list, {}))
  const employee = employees?.find((e) => e._id === employeeId)

  // Same query shape the main Attendance list uses
  // (convex/attendance.ts's listRecords), just scoped to this one
  // employee instead of exposing the employee filter.
  const { data: records } = useQuery(
    convexQuery(api.attendance.listRecords, { employeeId }),
  )

  if (employees && !employee) {
    return (
      <section className="card">
        <div className="breadcrumb">
          <Link to="/dashboard/employees">← Back to employees</Link>
        </div>
        <p className="empty-state">
          No employee found for this link — it may have been removed.
        </p>
      </section>
    )
  }

  return (
    <>
      <section className="card">
        <div className="breadcrumb">
          <Link to="/dashboard/employees">← Back to employees</Link>
        </div>

        {employee ? (
          <>
            <div className="section-header">
              <h2>{employee.fullName}</h2>
              <StatusBadge status={employee.employmentStatus} />
            </div>
            <dl className="profile-grid">
              <div>
                <dt>Email</dt>
                <dd>{employee.email}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{employee.department ?? '—'}</dd>
              </div>
              <div>
                <dt>Designation</dt>
                <dd>{employee.designation ?? '—'}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p className="empty-state">Loading…</p>
        )}
      </section>

      <section className="card">
        <h2>Attendance history</h2>
        {records === undefined ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <DataTable
            rows={records}
            rowKey={(r) => r._id}
            emptyMessage="No attendance events yet for this employee."
            columns={[
              { key: 'date', header: 'Date', render: (r) => r.date },
              {
                key: 'checkIn',
                header: 'Check in',
                render: (r) => formatClockTime(r.checkInAt),
              },
              {
                key: 'checkOut',
                header: 'Check out',
                render: (r) => formatClockTime(r.checkOutAt),
              },
              {
                key: 'hours',
                header: 'Hours',
                render: (r) => (r.workingHours ? r.workingHours.toFixed(2) : '—'),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => <StatusBadge status={r.status} />,
              },
              {
                key: 'corrected',
                header: 'Corrected',
                render: (r) => (r.correctedByAdmin ? 'Yes' : '—'),
              },
            ]}
          />
        )}
      </section>
    </>
  )
}
