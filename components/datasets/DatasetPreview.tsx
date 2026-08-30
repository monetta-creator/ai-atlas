'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DatasetColumn, DatasetRow } from '@/lib/datasets/core';
import DatasetPreviewTable from '@/components/datasets/DatasetPreviewTable';

// A collapsed-by-default row preview for a dataset download card or a dataset
// page: expands to fetch `?preview=N` (small, cheap, cached per-viewer server
// side) and renders it through the shared DatasetPreviewTable. Collapsing
// again never refetches; the fetched rows stay in state.
//
// React Compiler discipline: rows land in state via the fetch promise
// callback, never a synchronous setState in an effect body.
export default function DatasetPreview({
  slug, columns, limit = 25, day,
}: {
  slug: string;
  columns: DatasetColumn[];
  limit?: number;
  day?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DatasetRow[] | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'locked' | 'error'>('idle');

  const expand = () => {
    setOpen(true);
    if (status !== 'idle') return;
    setStatus('loading');
    const qs = `preview=${limit}${day ? `&day=${day}` : ''}`;
    fetch(`/api/datasets/${slug}?${qs}`)
      .then(async (r) => {
        if (r.status === 401) { setStatus('locked'); return; }
        if (!r.ok) { setStatus('error'); return; }
        const data: { rows: DatasetRow[] } = await r.json();
        setRows(data.rows);
        setStatus('ok');
      })
      .catch(() => setStatus('error'));
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--sm" onClick={expand}>
        Preview data
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 8 }}>
        <button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>
          Hide preview
        </button>
        {status === 'loading' && (
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>Loading…</span>
        )}
      </div>
      {status === 'locked' && (
        <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Key-gated: unlock with the team key on <Link href="/ask">/ask</Link>.
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          Could not load the preview. <button type="button" className="btn btn--quiet btn--sm" onClick={expand}>Retry</button>
        </p>
      )}
      {status === 'ok' && rows && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <DatasetPreviewTable columns={columns} rows={rows} />
          </div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6 }}>
            first {rows.length} rows · download for the full set
          </p>
        </>
      )}
    </div>
  );
}
