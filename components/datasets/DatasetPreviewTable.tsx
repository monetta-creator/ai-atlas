import type { DatasetColumn, DatasetRow } from '@/lib/datasets/core';

const CLIP = 140;

const clip = (v: string | number | null): string => {
  if (v === null) return '';
  const s = String(v);
  return s.length > CLIP ? `${s.slice(0, CLIP)}…` : s;
};

// The one shared row-preview table: house .viewdata-table markup, vd-label/
// vd-num cell classes, 140-char clip on every cell. Presentational only, no
// data fetching, so DatasetExplorer's own filtered/grouped rows and
// DatasetPreview's fetched rows render through the exact same markup.
export default function DatasetPreviewTable({
  columns, rows,
}: {
  columns: DatasetColumn[];
  rows: DatasetRow[];
}) {
  return (
    <table className="viewdata-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className="vd-label" title={c.def}>{c.key}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c.key} className={c.type === 'number' ? 'vd-num' : 'vd-label'}>
                {clip(r[c.key] ?? null)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
