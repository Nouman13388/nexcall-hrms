import { useState } from 'react'

// Shared by the "add employee" panel and the "edit employee" panel on the
// Employees route — one form, two modes, instead of two hand-written forms.
// Email is create-only: convex/employees.ts's `update` mutation doesn't
// accept an email change (email uniqueness is enforced at create time only).
export interface EmployeeFormValues {
  fullName: string
  email: string
  department: string
  designation: string
}

export function EmployeeForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial?: Partial<EmployeeFormValues>
  onSubmit: (values: EmployeeFormValues) => Promise<void>
  onCancel?: () => void
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [department, setDepartment] = useState(initial?.department ?? '')
  const [designation, setDesignation] = useState(initial?.designation ?? '')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await onSubmit({ fullName, email, department, designation })
      if (mode === 'create') {
        setFullName('')
        setEmail('')
        setDepartment('')
        setDesignation('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="error-message" role="alert">
          {error}
        </div>
      )}
      <div className="form-row">
        <label>
          Full name
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
        {mode === 'create' && (
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
        )}
        <label>
          Department
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </label>
        <label>
          Designation
          <input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? 'Saving...'
            : mode === 'create'
              ? 'Add employee'
              : 'Save changes'}
        </button>
        {onCancel && (
          <button type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
