import type { DatasetColumn } from '@/lib/datasets/core';

// Server-rendered schema table for a dataset page: the registry's column
// contract, in the house .viewdata-table styling. This is the human-readable
// half of the catalog; the machine-readable half is the `catalog` dataset.
export default function DatasetSchemaTable({ columns }: { columns: DatasetColumn[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="viewdata-table">
        <thead>
          <tr>
            <th className="vd-label">Column</th>
            <th className="vd-label">Type</th>
            <th className="vd-label">Definition</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.key}>
              <td className="vd-label" style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{c.key}</td>
              <td className="vd-label" style={{ color: 'var(--faint-ink)', whiteSpace: 'nowrap' }}>{c.type}</td>
              <td className="vd-label">{c.def}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
