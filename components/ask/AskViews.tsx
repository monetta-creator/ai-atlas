'use client';

import { useState, type ReactNode } from 'react';
import type { AtlasView } from '@/lib/tools/types';

// Generative views (redo Phase 4): tables, timelines, and charts whose rows the
// server bound from a query. Nothing here computes or invents a value; sorting
// only reorders the rows it was handed. Each row's citation label renders as the
// existing citation pill when it parses as one, else as plain text.

type Cell = string | number | null;
type Rendered = { nodes: ReactNode[]; unverified: number };
type RenderCite = (label: string) => Rendered;

const SERIES_COLORS = ['var(--accent)', 'var(--supports)', 'var(--contradicts)', 'var(--heat-3)'];

// Axis ticks: compact (2.6B, 410K) so a large value never overflows the left gutter.
const fmtTick = (v: number): string =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(v);

const fmtNum = (v: number): string => {
  if (!Number.isFinite(v)) return String(v);
  return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(v * 10000) / 10000);
};

function CiteCell({ label, renderCite }: { label: Cell | undefined; renderCite: RenderCite }) {
  if (typeof label !== 'string' || !label) return <>{'–'}</>;
  if (/^\[[^\]]+\]$/.test(label)) {
    const r = renderCite(label);
    if (r.unverified === 0 && r.nodes.length) return <>{r.nodes}</>;
  }
  return <span className="ask-view-cite-text">{label}</span>;
}

function Table({ view, renderCite }: { view: AtlasView; renderCite: RenderCite }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const cols = view.columns ?? (view.rows[0] ? Object.keys(view.rows[0]).filter((k) => k !== view.cite).map((k) => ({ key: k, label: k, type: 'text' as const })) : []);
  const rows = sort
    ? view.rows.slice().sort((a, b) => {
        const x = a[sort.key] ?? null;
        const y = b[sort.key] ?? null;
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return c * sort.dir;
      })
    : view.rows;
  const show = (c: { key: string; type: string }, v: Cell | undefined) =>
    v === null || v === undefined || v === '' ? '–' : c.type === 'number' && typeof v === 'number' ? fmtNum(v) : String(v);
  const click = (key: string) => setSort((s) => (s && s.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  return (
    <>
      <div className="ask-view-scroll">
        <table className="ask-view-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} data-num={c.type === 'number' ? '' : undefined} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" onClick={() => click(c.key)}>
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
              {view.cite && <th>Source</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} data-num={c.type === 'number' ? '' : undefined} data-label={c.label}>{show(c, r[c.key])}</td>
                ))}
                {view.cite && <td data-label="Source"><CiteCell label={r[view.cite]} renderCite={renderCite} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Timeline({ view, renderCite }: { view: AtlasView; renderCite: RenderCite }) {
  const xk = view.x ?? 'date';
  const yk = view.y ?? 'title';
  return (
    <ol className="ask-view-tl">
      {view.rows.map((r, i) => (
        <li key={i}>
          <span className="ask-view-tl-date">{r[xk] ?? '–'}</span>
          <span className="ask-view-tl-title">{r[yk] ?? ''}</span>
          {view.cite && <span className="ask-view-tl-cite"><CiteCell label={r[view.cite]} renderCite={renderCite} /></span>}
        </li>
      ))}
    </ol>
  );
}

function Chart({ view }: { view: AtlasView }) {
  const xk = view.x ?? 'period';
  const yk = view.y ?? 'value';
  const sk = view.series;
  const pts = view.rows.filter((r) => typeof r[yk] === 'number' && r[xk] != null);
  if (!pts.length) return <p className="ask-view-empty">No numeric points to plot.</p>;
  const xs = [...new Set(pts.map((r) => String(r[xk])))].sort();
  const names = [...new Set(pts.map((r) => (sk ? String(r[sk] ?? '') : '')))];
  const vals = pts.map((r) => r[yk] as number);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const W = 640, H = 240, L = 64, R = 14, T = 12, B = 30;
  const px = (x: string) => (xs.length === 1 ? (L + W - R) / 2 : L + (xs.indexOf(x) / (xs.length - 1)) * (W - L - R));
  const py = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const tickIdx = xs.length <= 6 ? xs.map((_, i) => i) : [0, Math.round((xs.length - 1) / 3), Math.round(((xs.length - 1) * 2) / 3), xs.length - 1];
  return (
    <>
      <svg className="ask-view-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={view.title}>
        <line x1={L} y1={T} x2={L} y2={H - B} className="ask-view-axis" />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} className="ask-view-axis" />
        <line x1={L} y1={T} x2={W - R} y2={T} className="ask-view-grid" />
        <text x={L - 6} y={T + 4} textAnchor="end" className="ask-view-tick">{fmtTick(hi)}</text>
        <text x={L - 6} y={H - B} textAnchor="end" className="ask-view-tick">{fmtTick(lo)}</text>
        {tickIdx.map((i) => (
          <text key={i} x={px(xs[i])} y={H - B + 16} textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'} className="ask-view-tick">{xs[i]}</text>
        ))}
        {names.map((n, si) => {
          const color = SERIES_COLORS[si % SERIES_COLORS.length];
          const line = pts
            .filter((r) => (sk ? String(r[sk] ?? '') : '') === n)
            .sort((a, b) => String(a[xk]).localeCompare(String(b[xk])));
          return (
            <g key={n} style={{ color }}>
              <polyline fill="none" stroke="currentColor" strokeWidth={1.75} points={line.map((r) => `${px(String(r[xk]))},${py(r[yk] as number)}`).join(' ')} />
              {line.map((r, i) => (
                <circle key={i} cx={px(String(r[xk]))} cy={py(r[yk] as number)} r={2.5} fill="currentColor">
                  <title>{`${n ? `${n}: ` : ''}${r[xk]}: ${fmtNum(r[yk] as number)}${view.unit ? ` ${view.unit}` : ''}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {names.length > 0 && names[0] !== '' && (
        <ul className="ask-view-legend">
          {names.map((n, si) => (
            <li key={n}><span className="ask-view-swatch" style={{ background: SERIES_COLORS[si % SERIES_COLORS.length] }} aria-hidden="true" />{n}</li>
          ))}
        </ul>
      )}
      {view.unit && <p className="ask-view-note">Unit: {view.unit}</p>}
    </>
  );
}

export default function AskViews({ views, renderCite }: { views: AtlasView[]; renderCite: RenderCite }) {
  return (
    <div className="ask-views">
      {views.map((v, i) => (
        <figure key={i} className="ask-view" data-kind={v.kind}>
          <figcaption className="ask-view-head">
            <span className="ask-view-title">{v.title}</span>
            <span className="ask-view-count">{v.rows.length} row{v.rows.length === 1 ? '' : 's'}</span>
          </figcaption>
          {v.kind === 'table' && <Table view={v} renderCite={renderCite} />}
          {v.kind === 'timeline' && <Timeline view={v} renderCite={renderCite} />}
          {v.kind === 'chart' && <Chart view={v} />}
          {v.note && <p className="ask-view-note">{v.note}</p>}
        </figure>
      ))}
    </div>
  );
}
