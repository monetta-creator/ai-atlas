'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { DatasetColumn, DatasetDef, DatasetRow } from '@/lib/datasets/core';
import {
  type BuilderState, type SortRow, type WhereRow,
  MAX_IN_VALUES, MAX_LIMIT, MAX_Q_LEN, MAX_SORT, MAX_WHERE, MIN_LIMIT,
  describeState, fromViewParams, hrefs, opsForType, requiresNarrowing, toSearchParams,
} from '@/lib/datasets/query-url';
import DatasetPreviewTable from '@/components/datasets/DatasetPreviewTable';
import SavedViews from '@/components/datasets/SavedViews';

// The query builder plate on a dataset page: filters, a column projection,
// sort, limit, search, and the Preview/Download/Copy/Schema actions, all
// over the download route's own where/cols/sort/limit/q grammar
// (lib/datasets/filter.ts, translated by lib/datasets/query-url.ts). State
// mirrors the URL via history.replaceState (never a synchronous setState in
// the effect body), so a shared link reproduces the builder; the page reads
// the same params to seed `initial`. Enum values arrive already resolved in
// `columns[].values`, so this file never imports handoff-shared.

export interface QueryColumn {
  key: string;
  label: string;
  type: DatasetColumn['type'];
  def: string;
  values?: string[] | null; // resolved server-side; null/undefined = free text
}

const OP_LABELS: Record<string, string> = {
  eq: 'is', ne: 'is not', in: 'is one of', contains: 'contains',
  isnull: 'is blank', notnull: 'is set',
  gt: '>', gte: '≥', lt: '<', lte: '≤',
};

const PUSHDOWN_LABELS: Record<string, string> = {
  lens: 'Lens', day: 'Day', since: 'Since', source: 'Source code', company: 'Company',
};

function normalizeCommaList(raw: string): string {
  return raw.split(',').map((v) => v.trim()).filter(Boolean).slice(0, MAX_IN_VALUES).join(',');
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; rows: DatasetRow[]; rowCount: number }
  | { status: 'error'; message: string };

export default function QueryBuilder({
  slug, columns, filters, heavy, keyGated, unlocked, portal, lensValues, initial, initialView,
}: {
  slug: string;
  columns: QueryColumn[];
  filters: DatasetDef['filters'];
  heavy: boolean;
  keyGated: boolean;
  unlocked: boolean;
  // The portal-identity gate for Saved views (a portal-identity feature, not
  // a per-dataset access one): true for an active keyholder or admin, unlike
  // `unlocked` which is also true for a sessionless guest on a public
  // dataset. page.tsx's own `portal = identity.active` already covers admin
  // (PortalIdentity's ADMIN row sets `active: true`), so no `|| admin` here.
  portal: boolean;
  lensValues: string[];
  initial: BuilderState;
  initialView?: { id: string; name: string; spec: Record<string, string | string[]> } | null;
}) {
  // A ?view=<uuid> link (migration 0064) seeds the builder from that saved
  // view's own spec instead of the page's raw query params (`initial`, still
  // used for a plain shared /datasets/<slug>?where=... link). This runs once,
  // read by every useState lazy initializer below; it never re-triggers a
  // state reset on its own (initialView only ever changes via a fresh page
  // load, which remounts this component).
  const seed: BuilderState = initialView ? fromViewParams(initialView.spec, { columns, filters }) : initial;

  const [whereRows, setWhereRows] = useState<WhereRow[]>(() => seed.where.slice(0, MAX_WHERE));
  const [cols, setCols] = useState<string[]>(() => seed.cols);
  const [sortRows, setSortRows] = useState<SortRow[]>(() => seed.sort.slice(0, MAX_SORT));
  const [limitInput, setLimitInput] = useState(() => (seed.limit !== null ? String(seed.limit) : ''));
  const [q, setQ] = useState(() => seed.q);
  const [lensVal, setLensVal] = useState(() => seed.pushdowns.lens ?? '');
  const [dayVal, setDayVal] = useState(() => seed.pushdowns.day ?? '');
  const [sinceVal, setSinceVal] = useState(() => seed.pushdowns.since ?? '');
  const [sourceVal, setSourceVal] = useState(() => seed.pushdowns.source ?? '');
  const [companyVal, setCompanyVal] = useState(() => seed.pushdowns.company ?? '');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [copied, setCopied] = useState(false);
  const [loadedView, setLoadedView] = useState<
    { id: string; name: string; spec: Record<string, string | string[]> } | null
  >(() => (initialView ? { id: initialView.id, name: initialView.name, spec: initialView.spec } : null));
  const [viewLinkCopied, setViewLinkCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const firstRender = useRef(true);

  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c] as const)), [columns]);

  const state: BuilderState = useMemo(() => {
    let limit: number | null = null;
    if (limitInput.trim() !== '') {
      const n = Number.parseInt(limitInput, 10);
      if (Number.isFinite(n)) limit = Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
    }
    const pushdowns: Record<string, string> = {};
    if (lensVal) pushdowns.lens = lensVal;
    if (dayVal) pushdowns.day = dayVal;
    if (sinceVal) pushdowns.since = sinceVal;
    if (sourceVal) pushdowns.source = sourceVal;
    if (companyVal) pushdowns.company = companyVal;
    return { where: whereRows, cols, sort: sortRows, limit, q, pushdowns };
  }, [whereRows, cols, sortRows, limitInput, q, lensVal, dayVal, sinceVal, sourceVal, companyVal]);

  const narrowingBlocked = requiresNarrowing({ slug }, state);
  const description = describeState(state);
  // Whether the builder has drifted from the loaded view's own saved spec,
  // compared by description rather than deep-equality (state carries blank
  // in-progress rows a spec never does). Copying the view link while edited
  // would hand out a URL that reproduces the OLD spec, not what's on screen.
  const viewEdited = loadedView
    ? description !== describeState(fromViewParams(loadedView.spec, { columns, filters }))
    : false;
  // A sort with no where/search takes the route's cheap SQL-LIMIT path: it
  // fetches the first 25 rows of the build, THEN sorts those in JS, so
  // Preview shows 25 arbitrary rows reordered, not the 25 highest/lowest.
  // Only a download runs the sort over the full corpus.
  const sortOnlyPreview =
    sortRows.some((s) => s.col) && whereRows.length === 0 && !q.trim();

  // URL mirror: a direct history write, not a setState, so this is a plain
  // effect side effect (the React Compiler's set-state-in-effect rule bans
  // calling this component's own setState synchronously in an effect body,
  // not writing to window.history). Skips its first run (the DatasetCatalog
  // idiom) so a plain visit to /datasets/<slug> is never rewritten before
  // the visitor has touched anything; once the builder has real content (or
  // the page already arrived on #query), the hash is pinned to #query so a
  // shared link scrolls to it, otherwise whatever hash was already there is
  // left alone.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const qs = toSearchParams(state).toString();
    const keepQueryHash = qs !== '' || window.location.hash === '#query';
    window.history.replaceState(
      null, '', `/datasets/${slug}${qs ? `?${qs}` : ''}${keepQueryHash ? '#query' : ''}`
    );
  }, [state, slug]);

  function addWhereRow() {
    setWhereRows((rows) => (rows.length >= MAX_WHERE ? rows : [...rows, { col: '', op: '', value: '' }]));
  }
  function updateWhereRow(i: number, patch: Partial<WhereRow>) {
    setWhereRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeWhereRow(i: number) {
    setWhereRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  function addSortRow() {
    setSortRows((rows) => (rows.length >= MAX_SORT ? rows : [...rows, { col: '', dir: 'asc' }]));
  }
  function updateSortRow(i: number, patch: Partial<SortRow>) {
    setSortRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeSortRow(i: number) {
    setSortRows((rows) => rows.filter((_, idx) => idx !== i));
  }

  function toggleColumn(key: string) {
    setCols((prev) => {
      const allKeys = columns.map((c) => c.key);
      const current = prev.length ? prev : allKeys;
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
      if (next.length === 0) return prev; // keep at least one column selected
      return next.length === allKeys.length ? [] : allKeys.filter((k) => next.includes(k));
    });
  }

  function resetAll() {
    setWhereRows([]);
    setCols([]);
    setSortRows([]);
    setLimitInput('');
    setQ('');
    setLensVal(''); setDayVal(''); setSinceVal(''); setSourceVal(''); setCompanyVal('');
    setPreview({ status: 'idle' });
    setLoadedView(null);
  }

  async function runPreview() {
    if (!unlocked || narrowingBlocked) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPreview({ status: 'loading' });
    try {
      const res = await fetch(hrefs(slug, state, 'preview', 25), { signal: controller.signal });
      if (res.status === 401) {
        setPreview({ status: 'error', message: 'Unlock with an access key to preview this dataset.' });
        return;
      }
      if (!res.ok) {
        let message = `Could not load the preview (status ${res.status}).`;
        try {
          const body: { error?: string } = await res.json();
          if (body.error) message = body.error;
        } catch { /* non-JSON error body; keep the generic message */ }
        setPreview({ status: 'error', message });
        return;
      }
      const data: { rows: DatasetRow[]; dataset: { row_count: number } } = await res.json();
      setPreview({ status: 'ok', rows: data.rows ?? [], rowCount: data.dataset?.row_count ?? data.rows.length });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setPreview({ status: 'error', message: 'Could not load the preview.' });
    }
  }

  function copyUrl() {
    const href = hrefs(slug, state, 'csv');
    const abs = `${window.location.origin}${href}`;
    navigator.clipboard?.writeText(abs)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  // SavedViews computes the loaded view's BuilderState itself (it holds the
  // same columns/filters this component does) and hands it back here, an
  // event handler, so every setter below runs from a click, never from an
  // effect body.
  function handleLoadView(
    loaded: BuilderState, view: { id: string; name: string; spec: Record<string, string | string[]> }
  ) {
    setWhereRows(loaded.where.slice(0, MAX_WHERE));
    setCols(loaded.cols);
    setSortRows(loaded.sort.slice(0, MAX_SORT));
    setLimitInput(loaded.limit !== null ? String(loaded.limit) : '');
    setQ(loaded.q);
    setLensVal(loaded.pushdowns.lens ?? '');
    setDayVal(loaded.pushdowns.day ?? '');
    setSinceVal(loaded.pushdowns.since ?? '');
    setSourceVal(loaded.pushdowns.source ?? '');
    setCompanyVal(loaded.pushdowns.company ?? '');
    setLoadedView({ id: view.id, name: view.name, spec: view.spec });
  }

  // Copies the PAGE link (the builder seeded from this view, `?view=<id>`),
  // not the download route: that's what "view link" means to someone pasting
  // it for a colleague, and it's distinct from SavedViews' own per-row "Copy
  // download link" which hits /api/datasets directly.
  function copyViewLink() {
    if (!loadedView) return;
    const abs = `${window.location.origin}/datasets/${slug}?view=${loadedView.id}#query`;
    navigator.clipboard?.writeText(abs)
      .then(() => {
        setViewLinkCopied(true);
        setTimeout(() => setViewLinkCopied(false), 1500);
      })
      .catch(() => {});
  }

  const previewColumns: DatasetColumn[] = useMemo(() => {
    const source = cols.length ? columns.filter((c) => cols.includes(c.key)) : columns;
    return source.map((c) => ({ key: c.key, label: c.label, type: c.type, def: c.def }));
  }, [cols, columns]);

  const anyPushdown = Boolean(filters?.lens || filters?.day || filters?.since || filters?.source || filters?.company);

  return (
    <div className="plate dp-qb" id="query">
      <div className="dp-qb-head">
        <div className="section-label">Query builder</div>
        <p className="dp-qb-desc" aria-live="polite">{description}</p>
      </div>

      {heavy && (
        <p className="dp-qb-hint">Heavy dataset: the preview is capped at 25 rows; download for the full corpus.</p>
      )}

      {anyPushdown && (
        <div className="dp-qb-section">
          <div className="dp-qb-label">Narrow the pull</div>
          <div className="dp-qb-pushdowns">
            {filters?.lens && (
              <label className="dp-qb-field">
                <span>{PUSHDOWN_LABELS.lens}</span>
                <select className="input" value={lensVal} onChange={(e) => setLensVal(e.target.value)} aria-label="Lens">
                  <option value="">Every lens</option>
                  {lensValues.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            )}
            {filters?.day && (
              <label className="dp-qb-field">
                <span>{PUSHDOWN_LABELS.day}</span>
                <input className="input" type="date" value={dayVal} onChange={(e) => setDayVal(e.target.value)} aria-label="Day" />
              </label>
            )}
            {filters?.since && (
              <label className="dp-qb-field">
                <span>{PUSHDOWN_LABELS.since}</span>
                <input className="input" type="date" value={sinceVal} onChange={(e) => setSinceVal(e.target.value)} aria-label="Since" />
              </label>
            )}
            {filters?.source && (
              <label className="dp-qb-field">
                <span>{PUSHDOWN_LABELS.source}</span>
                <input
                  className="input" type="text" value={sourceVal} onChange={(e) => setSourceVal(e.target.value)}
                  pattern="[a-z0-9_]{1,32}" placeholder="edgar_xbrl" aria-label="Source code"
                />
              </label>
            )}
            {filters?.company && (
              <label className="dp-qb-field">
                <span>{PUSHDOWN_LABELS.company}</span>
                <input
                  className="input" type="text" value={companyVal} onChange={(e) => setCompanyVal(e.target.value)}
                  pattern="[a-z0-9-]{1,64}" placeholder="acme-bank" aria-label="Company slug"
                />
              </label>
            )}
          </div>
        </div>
      )}

      <div className="dp-qb-section">
        <div className="dp-qb-label">Filters</div>
        {whereRows.map((row, i) => {
          const column = colByKey.get(row.col);
          return (
            <div className="dp-qb-row" key={i}>
              <select
                className="input dp-qb-col"
                value={row.col}
                onChange={(e) => updateWhereRow(i, { col: e.target.value, op: '', value: '' })}
                aria-label={`Column for filter row ${i + 1}`}
              >
                <option value="">Choose a column</option>
                {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select
                className="input dp-qb-op"
                value={row.op}
                onChange={(e) => updateWhereRow(i, { op: e.target.value, value: '' })}
                aria-label={`Operator for filter row ${i + 1}`}
                disabled={!column}
              >
                <option value="">Choose an operator</option>
                {(column ? opsForType(column.type) : []).map((op) => (
                  <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>
                ))}
              </select>
              {column && row.op && row.op !== 'isnull' && row.op !== 'notnull' && (
                row.op === 'in' && column.type === 'enum' && column.values ? (
                  <select
                    multiple
                    className="input dp-qb-value"
                    value={row.value ? row.value.split(',').filter(Boolean) : []}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                      updateWhereRow(i, { value: selected.join(',') });
                    }}
                    aria-label={`Values for filter row ${i + 1}`}
                  >
                    {column.values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : row.op === 'in' ? (
                  <input
                    className="input dp-qb-value"
                    type="text"
                    value={row.value}
                    onChange={(e) => updateWhereRow(i, { value: e.target.value })}
                    onBlur={(e) => updateWhereRow(i, { value: normalizeCommaList(e.target.value) })}
                    placeholder={`Comma-separated, up to ${MAX_IN_VALUES}`}
                    aria-label={`Values for filter row ${i + 1}`}
                  />
                ) : column.type === 'enum' && column.values ? (
                  <select
                    className="input dp-qb-value"
                    value={row.value}
                    onChange={(e) => updateWhereRow(i, { value: e.target.value })}
                    aria-label={`Value for filter row ${i + 1}`}
                  >
                    <option value="">Choose a value</option>
                    {column.values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : column.type === 'date' ? (
                  <input
                    className="input dp-qb-value" type="date" value={row.value}
                    onChange={(e) => updateWhereRow(i, { value: e.target.value })}
                    aria-label={`Value for filter row ${i + 1}`}
                  />
                ) : column.type === 'number' ? (
                  <input
                    className="input dp-qb-value" type="number" value={row.value}
                    onChange={(e) => updateWhereRow(i, { value: e.target.value })}
                    aria-label={`Value for filter row ${i + 1}`}
                  />
                ) : (
                  <input
                    className="input dp-qb-value" type="text" value={row.value}
                    onChange={(e) => updateWhereRow(i, { value: e.target.value })}
                    aria-label={`Value for filter row ${i + 1}`}
                  />
                )
              )}
              <button
                type="button" className="btn btn--quiet btn--sm dp-qb-remove"
                onClick={() => removeWhereRow(i)} aria-label={`Remove filter row ${i + 1}`}
              >
                Remove
              </button>
            </div>
          );
        })}
        <button type="button" className="btn btn--ghost btn--sm" onClick={addWhereRow} disabled={whereRows.length >= MAX_WHERE}>
          Add filter{whereRows.length >= MAX_WHERE ? ` (max ${MAX_WHERE})` : ''}
        </button>
      </div>

      <div className="dp-qb-section">
        <div className="dp-qb-label">Columns</div>
        <div className="dp-qb-cols" role="group" aria-label="Columns to include">
          {columns.map((c) => {
            const checked = cols.length === 0 || cols.includes(c.key);
            return (
              <label key={c.key} className="dp-qb-colchip" title={c.def}>
                <input type="checkbox" checked={checked} onChange={() => toggleColumn(c.key)} />
                {c.label}
              </label>
            );
          })}
        </div>
      </div>

      <div className="dp-qb-section">
        <div className="dp-qb-label">Sort</div>
        {sortRows.map((s, i) => (
          <div className="dp-qb-row" key={i}>
            <select
              className="input dp-qb-col" value={s.col}
              onChange={(e) => updateSortRow(i, { col: e.target.value })}
              aria-label={`Sort column ${i + 1}`}
            >
              <option value="">Choose a column</option>
              {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select
              className="input dp-qb-op" value={s.dir}
              onChange={(e) => updateSortRow(i, { dir: e.target.value as 'asc' | 'desc' })}
              aria-label={`Sort direction ${i + 1}`}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button
              type="button" className="btn btn--quiet btn--sm dp-qb-remove"
              onClick={() => removeSortRow(i)} aria-label={`Remove sort key ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn--ghost btn--sm" onClick={addSortRow} disabled={sortRows.length >= MAX_SORT}>
          Add sort key{sortRows.length >= MAX_SORT ? ` (max ${MAX_SORT})` : ''}
        </button>
      </div>

      <div className="dp-qb-section">
        <div className="dp-qb-inline">
          <label className="dp-qb-field">
            <span>Limit</span>
            <input
              className="input" type="number" min={MIN_LIMIT} max={MAX_LIMIT} value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)} placeholder="No limit" aria-label="Row limit"
            />
          </label>
          <label className="dp-qb-field dp-qb-field--grow">
            <span>Search</span>
            <input
              className="input" type="text" value={q} onChange={(e) => setQ(e.target.value)} maxLength={MAX_Q_LEN}
              placeholder="Search text, longtext, and enum columns" aria-label="Free-text search"
            />
          </label>
        </div>
      </div>

      {narrowingBlocked && (
        <p className="dp-qb-warn" role="status">
          This dataset runs to millions of rows. Set a since, source, or company value above before filtering, sorting, or searching.
        </p>
      )}
      {sortOnlyPreview && (
        <p className="dp-qb-hint">
          Preview sorts the first 25 rows, not the whole dataset. Download for the true order.
        </p>
      )}

      <div className="dp-qb-actions">
        <button
          type="button" className="btn btn--primary btn--sm"
          onClick={() => void runPreview()}
          disabled={!unlocked || narrowingBlocked || preview.status === 'loading'}
        >
          {preview.status === 'loading' ? 'Loading…' : 'Preview'}
        </button>
        {unlocked ? (
          <>
            <a className="btn btn--ghost btn--sm" href={hrefs(slug, state, 'csv')}>Download CSV</a>
            <a className="btn btn--ghost btn--sm" href={hrefs(slug, state, 'json')}>Download JSON</a>
            <button type="button" className="btn btn--quiet btn--sm" onClick={copyUrl}>{copied ? 'Copied' : 'Copy URL'}</button>
            <a className="btn btn--quiet btn--sm" href={hrefs(slug, state, 'schema')}>Schema</a>
          </>
        ) : (
          <>
            <Link className="btn btn--ghost btn--sm" href="/datasets/request">Request access</Link>
            <Link className="btn btn--primary btn--sm" href="/ask">Unlock with an access key</Link>
          </>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={resetAll}>Reset</button>
      </div>
      {!unlocked && (
        <p className="dp-qb-hint">
          {keyGated ? 'Preview needs an access key. Unlock once and it opens up here.' : 'This dataset is locked.'}
        </p>
      )}

      {loadedView && (
        <div className="dp-qb-viewline">
          <span>View: {loadedView.name}{viewEdited ? ' (edited)' : ''}</span>
          {!viewEdited && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={copyViewLink}>
              {viewLinkCopied ? 'Copied' : 'Copy view link'}
            </button>
          )}
        </div>
      )}

      <SavedViews
        slug={slug}
        unlocked={portal}
        state={state}
        onLoad={handleLoadView}
        format="csv"
        columns={columns}
        filters={filters}
      />

      <div className="dp-qb-preview" aria-live="polite">
        {preview.status === 'loading' && <p className="dp-qb-hint">Loading preview…</p>}
        {preview.status === 'error' && <p className="dp-qb-hint dp-qb-hint--error">{preview.message}</p>}
        {preview.status === 'ok' && (
          <>
            <p className="dp-qb-hint">
              {preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} in this preview
              {preview.rows.length === 25 ? '. Capped at 25; download for the full set.' : ''}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <DatasetPreviewTable columns={previewColumns} rows={preview.rows} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
