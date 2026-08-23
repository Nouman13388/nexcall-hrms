import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from '@convex-dev/react-query'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../../convex/_generated/api'
import { DataTable } from '../../components/DataTable'
import { EmployeeForm } from '../../components/EmployeeForm'
import { StatusBadge } from '../../components/StatusBadge'
import type { Id } from '../../../convex/_generated/dataModel'

export const Route = createFileRoute('/dashboard/employees')({
  component: EmployeesPage,
})

function EmployeesPage() {
  // convexQuery keeps this reactive over the live WebSocket subscription —
  // no manual refresh, this list updates itself when a mutation lands.
  const { data: employees } = useQuery(convexQuery(api.employees.list, {}))
  const createEmployee = useConvexMutation(api.employees.create)
  const updateEmployee = useConvexMutation(api.employees.update)
  const deactivateEmployee = useConvexMutation(api.employees.deactivate)
  const syncFromSlack = useConvexAction(api.slackSync.syncFromSlack)

  const [editingId, setEditingId] = useState<Id<'employees'> | null>(null)
  const editingEmployee = employees?.find((e) => e._id === editingId)

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncSummary, setSyncSummary] = useState<{
    created: number
    matched: number
    skipped: number
    skippedReasons: string[]
  } | null>(null)

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncError('')
    setSyncSummary(null)
    try {
      // Reactive: employees.list is already subscribed above, so any rows
      // this creates/updates show up in the table the moment the action's
      // mutation writes land — no refetch call needed here.
      const result = await syncFromSlack({})
      setSyncSummary(result)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Slack sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <>
      <section className="card">
        <h2>Add employee</h2>
        <EmployeeForm
          mode="create"
          onSubmit={(values) =>
            createEmployee({
              fullName: values.fullName,
              email: values.email,
              department: values.department || undefined,
              designation: values.designation || undefined,
            }).then(() => {})
          }
        />
      </section>

      {editingEmployee && (
        <section className="card">
          <h2>Edit {editingEmployee.fullName}</h2>
          <EmployeeForm
            mode="edit"
            initial={{
              fullName: editingEmployee.fullName,
              email: editingEmployee.email,
              department: editingEmployee.department,
              designation: editingEmployee.designation,
            }}
            onSubmit={(values) =>
              updateEmployee({
                id: editingEmployee._id,
                fullName: values.fullName,
                department: values.department || undefined,
                designation: values.designation || undefined,
              }).then(() => setEditingId(null))
            }
            onCancel={() => setEditingId(null)}
          />
        </section>
      )}

      <section className="card">
        <div className="section-header">
          <h2>Employees</h2>
          <button type="button" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? 'Syncing…' : 'Sync from Slack'}
          </button>
        </div>

        {syncError && (
          <div className="error-message" role="alert">
            {syncError}
          </div>
        )}

        {syncSummary && (
          <div className="notice" role="status">
            Slack sync: {syncSummary.created} created, {syncSummary.matched}{' '}
            matched, {syncSummary.skipped} skipped.
            {syncSummary.skippedReasons.length > 0 && (
              <details>
                <summary>Why records were skipped</summary>
                <ul>
                  {syncSummary.skippedReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {employees === undefined ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <DataTable
            rows={employees}
            rowKey={(e) => e._id}
            emptyMessage="No employees yet — add the first one above."
            columns={[
              { key: 'name', header: 'Name', render: (e) => e.fullName },
              { key: 'email', header: 'Email', render: (e) => e.email },
              {
                key: 'department',
                header: 'Department',
                render: (e) => e.department ?? '—',
              },
              {
                key: 'designation',
                header: 'Designation',
                render: (e) => e.designation ?? '—',
              },
              {
                key: 'status',
                header: 'Status',
                render: (e) => <StatusBadge status={e.employmentStatus} />,
              },
              {
                key: 'actions',
                header: '',
                render: (e) => (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setEditingId(e._id)}
                    >
                      Edit
                    </button>
                    {e.employmentStatus === 'active' && (
                      <button
                        type="button"
                        className="button-danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Deactivate ${e.fullName}? There is no undo for this yet.`,
                            )
                          ) {
                            void deactivateEmployee({ id: e._id })
                          }
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
    </>
  )
}
