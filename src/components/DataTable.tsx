// One table pattern for every list in the admin dashboard (Employees,
// Attendance). Callers supply columns + rows; this owns the markup, the
// empty state, and the styling hook (.table) so list views never hand-roll
// their own <table>.
export interface DataTableColumn<T> {
  key: string
  header: string
  render: (row: T) => React.ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = 'Nothing to show yet.',
}: {
  columns: DataTableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
