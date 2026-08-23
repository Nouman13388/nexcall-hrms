import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { DataTable } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import type { Id } from '../../../convex/_generated/dataModel'

type StatusFilter = '' | 'PRESENT' | 'MISSING_CHECKOUT' | 'COMPLETE'

const STATUS_VALUES: StatusFilter[] = [
  'PRESENT',
  'MISSING_CHECKOUT',
  'COMPLETE',
]

interface AttendanceSearch {
  status?: StatusFilter
  startDate?: string
  endDate?: string
}

// Lets the dashboard snapshot cards deep-link here pre-filtered (e.g.
// "3 Missing checkout" -> today, status=MISSING_CHECKOUT already applied)
// instead of landing on a blank page the admin has to filter by hand.
// All fields optional so plain nav links to this route (no filters) don't
// need a `search` prop at all — this stays additive to existing behavior.
export const Route = createFileRoute('/dashboard/attendance')({
  validateSearch: (search: Record<string, unknown>): AttendanceSearch => ({
    status: STATUS_VALUES.includes(search.status as StatusFilter)
      ? (search.status as StatusFilter)
      : undefined,
    startDate:
      typeof search.startDate === 'string' ? search.startDate : undefined,
    endDate: typeof search.endDate === 'string' ? search.endDate : undefined,
  }),
  component: AttendancePage,
})

function formatTime(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AttendancePage() {
  const initialSearch = Route.useSearch()
  // Snapshot of how this page was *entered*, independent of subsequent
  // filter edits — this is what decides whether the breadcrumb shows, not
  // the live filter state (a user filtering manually via the toolbar
  // shouldn't suddenly grow a "back to dashboard" link that wasn't there
  // when they arrived).
  const [arrivedViaDeepLink] = useState(
    () => Boolean(initialSearch.status) ||
      Boolean(initialSearch.startDate) ||
      Boolean(initialSearch.endDate),
  )

  const [employeeId, setEmployeeId] = useState<Id<'employees'> | ''>('')
  const [startDate, setStartDate] = useState(initialSearch.startDate ?? '')
  const [endDate, setEndDate] = useState(initialSearch.endDate ?? '')
  const [status, setStatus] = useState<StatusFilter>(
    initialSearch.status ?? '',
  )
  const hasActiveFilters = Boolean(employeeId || startDate || endDate || status)

  const { data: employees } = useQuery(convexQuery(api.employees.list, {}))

  // Filters are plain query args, so changing any of them changes the query
  // key and Convex/React Query refetch + keep the result live — no refresh
  // button, no manual refetch call.
  const { data: records } = useQuery(
    convexQuery(api.attendance.listRecords, {
      employeeId: employeeId || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: status || undefined,
    }),
  )

  const employeeName = (id: Id<'employees'>) =>
    employees?.find((e) => e._id === id)?.fullName ?? 'Unknown'

  return (
    <section className="card">
      {arrivedViaDeepLink && (
        <div className="breadcrumb">
          <Link to="/dashboard">← Back to dashboard</Link>
        </div>
      )}
      <h2>Attendance</h2>
      <div className="toolbar">
        <label className="field">
          Employee
          <select
            value={employeeId}
            onChange={(e) =>
              setEmployeeId(e.target.value as Id<'employees'> | '')
            }
          >
            <option value="">All employees</option>
            {employees?.map((e) => (
              <option key={e._id} value={e._id}>
                {e.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="field">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label className="field">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="">All statuses</option>
            <option value="PRESENT">Present</option>
            <option value="MISSING_CHECKOUT">Missing checkout</option>
            <option value="COMPLETE">Complete</option>
          </select>
        </label>
      </div>

      {records === undefined ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <DataTable
          rows={records}
          rowKey={(r) => r._id}
          emptyMessage={
            hasActiveFilters
              ? 'No attendance records match these filters.'
              : 'No attendance events yet — check-ins and check-outs from Slack will appear here.'
          }
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (r) => employeeName(r.employeeId),
            },
            { key: 'date', header: 'Date', render: (r) => r.date },
            {
              key: 'checkIn',
              header: 'Check in',
              render: (r) => formatTime(r.checkInAt),
            },
            {
              key: 'checkOut',
              header: 'Check out',
              render: (r) => formatTime(r.checkOutAt),
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
  )
}
