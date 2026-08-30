'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DatasetColumn, DatasetRow } from '@/lib/datasets/core';
import type { ViewDataset } from '@/lib/types';
import ViewData from '@/components/ViewData';
import DatasetPreviewTable from '@/components/datasets/DatasetPreviewTable';

// The lightweight in-page explorer on a dataset page: filter, group, chart,
// export. It fetches the dataset's own public JSON endpoint (never lib/db; this
// is a client component) so what it explores is byte-identical to what a
// download gets. Charts are hand-rolled CSS bars in the house tradition; no
// chart dependency.
//
// React Compiler discipline: rows land in state via the fetch promise callback
// (never a synchronous setState in an effect body), and no refs are read during
// render.

type Agg = 'count' | 'sum' | 'avg';

const PREVIEW_ROWS = 200;

export default function DatasetExplorer({
  slug, columns,
}: {
  slug: string;
  columns: DatasetColumn[];
}) {
  const [rows, setRows] = useState<DatasetRow[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [enumSel, setEnumSel] = useState<Record<string, string>>({});
  const [groupBy, setGroupBy] = useState('');
  const [agg, setAgg] = useState<Agg>('count');
  const [aggCol, setAggCol] = useState('');
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    fetch(`/api/datasets/${slug}?format=json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { rows: DatasetRow[] }) => { if (live) setRows(data.rows); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [slug]);

  const enumCols = useMemo(() => columns.filter((c) => c.type === 'enum'), [columns]);
  const numberCols = useMemo(() => columns.filter((c) => c.type === 'number'), [columns]);
  const shownCols = columns.filter((c) => !hidden[c.key]);

  const enumValues = useMemo(() => {
    const out: Record<string, string[]> = {};
    if (!rows) return out;
    for (const c of enumCols) {
      const vals = new Set<string>();
      for (const r of rows) {
        const v = r[c.key];
        if (v !== null && v !== '') vals.add(String(v));
      }
      out[c.key] = [...vals].sort();
    }
    return out;
  }, [rows, enumCols]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      for (const [key, val] of Object.entries(enumSel)) {
        if (val && String(r[key] ?? '') !== val) return false;
      }
      if (!needle) return true;
      return columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle));
    });
  }, [rows, search, enumSel, columns]);

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const buckets = new Map<string, { n: number; sum: number }>();
    for (const r of filtered) {
      const key = String(r[groupBy] ?? '') || '(blank)';
      const b = buckets.get(key) ?? { n: 0, sum: 0 };
      b.n += 1;
      const v = aggCol ? r[aggCol] : null;
      if (typeof v === 'number') b.sum += v;
      buckets.set(key, b);
    }
    const value = (b: { n: number; sum: number }): number =>
      agg === 'count' ? b.n : agg === 'sum' ? b.sum : b.n ? b.sum / b.n : 0;
    return [...buckets.entries()]
      .map(([key, b]) => ({ key, value: value(b), n: b.n }))
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  }, [filtered, groupBy, agg, aggCol]);

  // Exportable view of exactly what is on screen (nulls become empty cells;
  // ViewDataset rows are string|number only).
  const viewDataset: ViewDataset = useMemo(() => {
    if (grouped) {
      const aggLabel = agg === 'count' ? 'Count' : `${agg === 'sum' ? 'Sum' : 'Average'} of ${aggCol}`;
      return {
        title: `${slug} by ${groupBy}`,
        columns: [
          { key: 'group', label: groupBy, def: `Distinct ${groupBy} values in the filtered rows.` },
          { key: 'value', label: aggLabel, def: 'Aggregate over the filtered rows.' },
          { key: 'rows', label: 'Rows', def: 'Row count in the group.' },
        ],
        rows: grouped.map((g) => ({
          group: g.key,
          value: agg === 'avg' ? Number(g.value.toFixed(2)) : g.value,
          rows: g.n,
        })),
        methodology: 'Aggregated in the browser over the filtered dataset rows; the full dataset is available from the download links above.',
        source: `/api/datasets/${slug}`,
      };
    }
    return {
      title: slug,
      columns: shownCols.map((c) => ({ key: c.key, label: c.key, def: c.def })),
      rows: filtered.map((r) => {
        const out: Record<string, string | number> = {};
        for (const c of shownCols) out[c.key] = r[c.key] ?? '';
        return out;
      }),
      methodology: 'The filtered rows as shown; the unfiltered dataset is available from the download links above.',
      source: `/api/datasets/${slug}`,
    };
  }, [grouped, filtered, shownCols, slug, groupBy, agg, aggCol]);

  if (error) {
    return <p style={{ fontSize: 13, color: 'var(--faint-ink)' }}>The explorer could not load this dataset. The download links above still work.</p>;
  }
  if (!rows) {
    return <p style={{ fontSize: 13, color: 'var(--faint-ink)' }}>Loading rows…</p>;
  }

  const maxVal = grouped?.length ? Math.max(...grouped.map((g) => g.value)) : 0;

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 12 }}>
        <input
          className="input"
          placeholder="Filter rows"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        {enumCols.map((c) => (
          <select
            key={c.key}
            className="input"
            value={enumSel[c.key] ?? ''}
            onChange={(e) => setEnumSel((s) => ({ ...s, [c.key]: e.target.value }))}
            style={{ maxWidth: 180 }}
          >
            <option value="">{`${c.key}: all`}</option>
            {(enumValues[c.key] ?? []).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ))}
        <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">group by: none</option>
          {columns.filter((c) => c.type !== 'longtext' && c.type !== 'number').map((c) => (
            <option key={c.key} value={c.key}>{`group by: ${c.key}`}</option>
          ))}
        </select>
        {groupBy && (
          <select
            className="input"
            value={agg === 'count' ? 'count' : `${agg}:${aggCol}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'count') { setAgg('count'); setAggCol(''); return; }
              const [a, key] = v.split(':');
              setAgg(a as Agg);
              setAggCol(key);
            }}
            style={{ maxWidth: 200 }}
          >
            <option value="count">count</option>
            {numberCols.flatMap((c) => [
              <option key={`sum:${c.key}`} value={`sum:${c.key}`}>{`sum of ${c.key}`}</option>,
              <option key={`avg:${c.key}`} value={`avg:${c.key}`}>{`avg of ${c.key}`}</option>,
            ])}
          </select>
        )}
        <ViewData dataset={viewDataset} label="Export this view" />
      </div>

      {!groupBy && (
        <details style={{ marginBottom: 12 }}>
          <summary style={{ fontSize: 12, color: 'var(--faint-ink)', cursor: 'pointer' }}>Columns</summary>
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 8 }}>
            {columns.map((c) => (
              <label key={c.key} style={{ fontSize: 12, fontFamily: 'var(--font-mono)', display: 'flex', gap: 5, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={!hidden[c.key]}
                  onChange={(e) => setHidden((h) => ({ ...h, [c.key]: !e.target.checked }))}
                />
                {c.key}
              </label>
            ))}
          </div>
        </details>
      )}

      {grouped ? (
        <div>
          <p style={{ fontSize: 12, color: 'var(--faint-ink)', marginBottom: 10 }}>
            {grouped.length} groups over {filtered.length} rows
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
            {grouped.slice(0, 24).map((g) => (
              <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', width: 170, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.key}>
                  {g.key}
                </span>
                <span style={{ flex: 1, height: 12, background: 'color-mix(in oklab, var(--accent) 10%, transparent)' }}>
                  <span
                    style={{
                      display: 'block', height: '100%', background: 'var(--accent)',
                      width: `${maxVal ? Math.max(2, (g.value / maxVal) * 100) : 0}%`,
                    }}
                  />
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', width: 70, textAlign: 'right' }}>
                  {agg === 'avg' ? g.value.toFixed(2) : g.value}
                </span>
              </div>
            ))}
          </div>
          {grouped.length > 24 && (
            <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 8 }}>
              Showing the top 24 groups; export the view for all of them.
            </p>
          )}
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12, color: 'var(--faint-ink)', marginBottom: 10 }}>
            {filtered.length} of {rows.length} rows{filtered.length > PREVIEW_ROWS ? `, first ${PREVIEW_ROWS} shown` : ''}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <DatasetPreviewTable columns={shownCols} rows={filtered.slice(0, PREVIEW_ROWS)} />
          </div>
        </div>
      )}
    </div>
  );
}
