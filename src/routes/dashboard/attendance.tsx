import { convexQuery } from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { DataTable } from '../../components/DataTable'
import { StatusBadge } from '../../components/StatusBadge'
import type { Id } from '../../../convex/_generated/dataModel'

export const Route = createFileRoute('/dashboard/attendance')({
  component: AttendancePage,
})

type StatusFilter = '' | 'PRESENT' | 'MISSING_CHECKOUT' | 'COMPLETE'

function formatTime(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AttendancePage() {
  const [employeeId, setEmployeeId] = useState<Id<'employees'> | ''>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')

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
          emptyMessage="No attendance records match these filters."
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
