'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { dateLabel } from '@/lib/format';
import { FIT_BAND_LABEL } from './labels';
import ProductLogo from './ProductLogo';
import ProductQuickRead from './ProductQuickRead';
import { TABLE_COLUMNS, cellValue, compareRows, rowMatches, type SortDir, type TableRow } from '@/lib/tooling/table-core';

const PAGE_SIZE = 50;
const MAX_COMPARE = 4;

function formatCell(row: TableRow, key: string): React.ReactNode {
  if (key === 'firstSeen') return dateLabel(row.firstSeen) ?? '–';
  if (key === 'fit') {
    if (row.fit == null) return '–';
    return (
      <span className="flex items-center gap-1.5">
        <span style={{ fontFamily: 'var(--font-mono)' }}>{row.fit}</span>
        {row.fitBand && (
          <span className="tl-fit" style={{ fontSize: 11 }}>{FIT_BAND_LABEL[row.fitBand]}</span>
        )}
      </span>
    );
  }
  const v = cellValue(row, key);
  if (v == null || v === '') return '–';
  if (Array.isArray(v)) return v.length ? v.join(' · ') : '–';
  return v;
}

function SortHeader({
  col, sortKey, sortDir, onSort,
}: {
  col: { key: string; label: string; kind: string };
  sortKey: string;
  sortDir: SortDir;
  onSort: (key: string) => void;
}) {
  const active = sortKey === col.key;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  const numeric = col.kind === 'number';
  return (
    <th scope="col" aria-sort={ariaSort} className={numeric ? 'vd-num' : undefined}>
      <button type="button" onClick={() => onSort(col.key)}>
        {col.label}
        {active && <span aria-hidden="true"> {sortDir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

export default function ProductTable({
  rows, portal, admin, csvHref,
}: {
  rows: TableRow[];
  portal: boolean;
  admin: boolean;
  csvHref: string;
}) {
  const columns = useMemo(() => TABLE_COLUMNS.filter((c) => !c.portal || portal), [portal]);

  const [sortKey, setSortKey] = useState('firstSeen');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [needle, setNeedle] = useState('');
  const [visibleCols, setVisibleCols] = useState<Set<string>>(
    () => new Set(TABLE_COLUMNS.filter((c) => c.defaultOn && (!c.portal || portal)).map((c) => c.key))
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<TableRow | null>(null);

  function onSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  function toggleCol(key: string) {
    setVisibleCols((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COMPARE) next.add(id);
      return next;
    });
  }

  const searchKeys = useMemo(() => Array.from(visibleCols), [visibleCols]);

  const filtered = useMemo(() => {
    const n = needle.trim();
    if (!n) return rows;
    return rows.filter((r) => rowMatches(r, n, searchKeys));
  }, [rows, needle, searchKeys]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareRows(a, b, sortKey, sortDir)),
    [filtered, sortKey, sortDir]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.id)),
    [rows, selected]
  );
  const featureUnion = useMemo(() => {
    const set = new Set<string>();
    for (const r of selectedRows) for (const f of r.allFeatures) set.add(f);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [selectedRows]);

  const orderedColumns = columns.filter((c) => visibleCols.has(c.key));

  return (
    <div>
      <div className="tl-tbar">
        <input
          type="search"
          className="input"
          aria-label="Filter rows"
          placeholder="Filter rows…"
          value={needle}
          onChange={(e) => { setNeedle(e.target.value); setPage(1); }}
          style={{ maxWidth: 240 }}
        />
        <details className="tl-details">
          <summary className="text-sm" style={{ color: 'var(--dim)' }}>Columns</summary>
          <div className="flex flex-col gap-1.5" style={{ marginTop: 8, minWidth: 200 }}>
            {columns.map((c) => (
              <label key={c.key} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                {c.label}
              </label>
            ))}
          </div>
        </details>
        <span className="text-sm" style={{ color: 'var(--faint-ink)' }}>
          {filtered.length} of {rows.length} products
        </span>
        <a className="btn btn--ghost btn--sm" href={csvHref} style={{ marginLeft: 'auto' }}>
          Download CSV
        </a>
      </div>

      {selectedRows.length >= 2 && (
        <div className="tl-compare">
          <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
            <span className="section-label" style={{ margin: 0 }}>Compare</span>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
          <div className="tl-tablewrap">
            <table className="tl-compare-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {selectedRows.map((r) => (
                    <th scope="col" key={r.id}>
                      <Link href={`/tooling/${r.slug}`} style={{ color: 'var(--ink)' }}>{r.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureUnion.map((f) => (
                  <tr key={f}>
                    <td>{f}</td>
                    {selectedRows.map((r) => (
                      <td key={r.id} className="vd-num">{r.allFeatures.includes(f) ? '✓' : ''}</td>
                    ))}
                  </tr>
                ))}
                {featureUnion.length === 0 && (
                  <tr><td colSpan={selectedRows.length + 1} style={{ color: 'var(--faint-ink)' }}>No recorded features to compare.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="tl-tablewrap">
        <table className="viewdata-table tl-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Compare"></th>
              {orderedColumns.map((c) => (
                <SortHeader key={c.key} col={c} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => (
              <tr
                key={row.id}
                data-selected={selected.has(row.id) ? '' : undefined}
                onClick={() => setOpenRow(row)}
                style={{ cursor: 'pointer' }}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Compare ${row.name}`}
                    checked={selected.has(row.id)}
                    disabled={!selected.has(row.id) && selected.size >= MAX_COMPARE}
                    onChange={() => toggleSelect(row.id)}
                  />
                </td>
                {orderedColumns.map((c) => {
                  if (c.key === 'name') {
                    return (
                      <td key={c.key} className="vd-label tl-name-cell">
                        <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <ProductLogo name={row.name} domain={row.vendorDomain} url={row.url} size={20} />
                          <Link href={`/tooling/${row.slug}`} style={{ color: 'var(--ink)' }}>{row.name}</Link>
                        </span>
                      </td>
                    );
                  }
                  if (c.key === 'vendor') {
                    return <td key={c.key} style={{ color: 'var(--faint-ink)' }}>{row.vendor ?? '–'}</td>;
                  }
                  return (
                    <td key={c.key} className={c.kind === 'number' ? 'vd-num' : undefined}>
                      {formatCell(row, c.key)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={orderedColumns.length + 1} style={{ color: 'var(--faint-ink)' }}>No products match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="tl-pager">
        <button type="button" className="btn btn--ghost btn--sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
          Prev
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className="btn btn--ghost btn--sm"
            aria-current={n === currentPage ? 'page' : undefined}
            onClick={() => setPage(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
          Next
        </button>
      </div>

      {openRow && <ProductQuickRead row={openRow} portal={portal || admin} onClose={() => setOpenRow(null)} />}
    </div>
  );
}
