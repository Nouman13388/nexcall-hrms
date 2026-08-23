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
import { relativeTime } from '../../lib/format'
import type { Doc, Id } from '../../../convex/_generated/dataModel'

export const Route = createFileRoute('/dashboard/employees')({
  component: EmployeesPage,
})

interface SyncSummary {
  created: number
  matched: number
  skipped: number
  skippedReasons: string[]
}

interface LastSync {
  at: number
  summary: SyncSummary
}

// Sync from Slack is a one-shot action, not a subscription — unlike the
// rest of this app, its result doesn't stay current on its own, so it's
// worth remembering across a page reload rather than only for the current
// session. localStorage is enough for a single-admin tool; not worth a
// backend table for this.
const LAST_SYNC_KEY = 'nexcall-hrms:lastSlackSync'

function readLastSync(): LastSync | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY)
    return raw ? (JSON.parse(raw) as LastSync) : null
  } catch {
    return null
  }
}

function writeLastSync(entry: LastSync) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(entry))
  } catch {
    // Best-effort — private browsing / quota. Losing the "last synced"
    // label isn't worth surfacing an error for.
  }
}

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

  const [deactivatingId, setDeactivatingId] = useState<Id<'employees'> | null>(
    null,
  )

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [lastSync, setLastSync] = useState<LastSync | null>(() =>
    readLastSync(),
  )

  const handleSync = async () => {
    setIsSyncing(true)
    setSyncError('')
    try {
      // Reactive: employees.list is already subscribed above, so any rows
      // this creates/updates show up in the table the moment the action's
      // mutation writes land — no refetch call needed here.
      const summary = await syncFromSlack({})
      const entry = { at: Date.now(), summary }
      setLastSync(entry)
      writeLastSync(entry)
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Slack sync failed')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleDeactivate = async (employee: Doc<'employees'>) => {
    if (
      !window.confirm(
        `Deactivate ${employee.fullName}? There is no undo for this yet.`,
      )
    ) {
      return
    }
    setDeactivatingId(employee._id)
    try {
      await deactivateEmployee({ id: employee._id })
    } finally {
      setDeactivatingId(null)
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
          <div className="sync-controls">
            {lastSync && (
              <span className="sync-status">
                Last synced {relativeTime(lastSync.at)}
              </span>
            )}
            <button type="button" onClick={handleSync} disabled={isSyncing}>
              {isSyncing ? 'Syncing…' : 'Sync from Slack'}
            </button>
          </div>
        </div>

        {syncError && (
          <div className="error-message" role="alert">
            {syncError}
          </div>
        )}

        {lastSync && (
          <div className="notice" role="status">
            Last Slack sync: {lastSync.summary.created} created,{' '}
            {lastSync.summary.matched} matched, {lastSync.summary.skipped}{' '}
            skipped.
            {lastSync.summary.skippedReasons.length > 0 && (
              <details>
                <summary>Why records were skipped</summary>
                <ul>
                  {lastSync.summary.skippedReasons.map((reason) => (
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
                        disabled={deactivatingId === e._id}
                        onClick={() => void handleDeactivate(e)}
                      >
                        {deactivatingId === e._id
                          ? 'Deactivating…'
                          : 'Deactivate'}
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
