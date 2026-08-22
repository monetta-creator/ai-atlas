'use client';

import type { SavedReportMeta } from '@/lib/types';

// The saved-reports list: open a stored report back into the editor, or delete it. Hidden
// when there are none. The currently-open report is highlighted.
export default function SavedReports({
  reports,
  currentId,
  onOpen,
  onDelete,
}: {
  reports: SavedReportMeta[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!reports.length) return null;
  return (
    <section style={{ marginTop: 16 }}>
      <div className="section-label">Saved reports ({reports.length})</div>
      <div className="flex flex-col gap-1">
        {reports.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between flex-wrap gap-2 rounded-[var(--radius)] border p-2.5"
            style={{ background: 'var(--surface)', borderColor: r.id === currentId ? 'var(--accent)' : 'var(--line)' }}
          >
            <button
              type="button"
              onClick={() => onOpen(r.id)}
              title="Open in the editor"
              style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              <span style={{ color: 'var(--ink)', fontWeight: 600, fontSize: 14 }}>{r.title}</span>
              <span style={{ color: 'var(--faint-ink)', fontSize: 12, marginLeft: 8 }}>
                {r.date_from} → {r.date_to} · {r.contexts.length} context{r.contexts.length === 1 ? '' : 's'} · saved {r.updated_at.slice(0, 10)}
              </span>
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => { if (window.confirm('Delete this saved report?')) onDelete(r.id); }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
