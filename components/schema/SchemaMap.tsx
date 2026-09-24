'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SchemaTable } from '@/lib/schema/introspect';
import type { AccessTier, ClusterEdge, LaidGroup, SubsystemGroup } from '@/lib/schema/layout';

export interface SchemaMapDataset { slug: string; title: string; keyGated: boolean }

const GROUP_W = 260;
const GROUP_H_HEAD = 46;
const ROW_H = 22;
const GROUP_GAP_X = 40;
const GROUP_GAP_Y = 36;
const PAD = 20;
const MAX_ROWS_COLLAPSED = 6;

const TIER_LABEL: Record<AccessTier, string> = { public: 'Public', key: 'Key-gated', admin: 'Admin only' };

function tierColor(t: AccessTier): string {
  if (t === 'public') return 'var(--supports)';
  if (t === 'key') return 'var(--accent)';
  return 'var(--faint-ink)';
}

interface Props {
  tables: SchemaTable[];
  groups: LaidGroup[];
  edges: ClusterEdge[];
  tiers: Record<string, { tier: AccessTier; reason: string }>;
  datasetTables: Record<string, string[]>;
  datasets: SchemaMapDataset[];
}

export default function SchemaMap({ tables, groups, edges, tiers, datasetTables, datasets }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [activeDataset, setActiveDataset] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<SubsystemGroup | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [hoverTable, setHoverTable] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => setNarrow(el.getBoundingClientRect().width < 900);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tableByName = useMemo(() => new Map(tables.map((t) => [t.name, t])), [tables]);
  const litTables = useMemo(() => {
    if (!activeDataset) return null;
    return new Set(datasetTables[activeDataset] ?? []);
  }, [activeDataset, datasetTables]);

  const openT = openTable ? tableByName.get(openTable) ?? null : null;
  const openTier = openTable ? tiers[openTable] ?? null : null;
  const readingDatasets = useMemo(() => {
    if (!openTable) return [];
    return datasets.filter((d) => (datasetTables[d.slug] ?? []).includes(openTable));
  }, [openTable, datasetTables, datasets]);
  const fksIn = useMemo(() => {
    if (!openTable) return [];
    const out: { table: string; column: string }[] = [];
    for (const t of tables) {
      for (const fk of t.fks) {
        if (fk.refTable === openTable) out.push({ table: t.name, column: fk.column });
      }
    }
    return out;
  }, [openTable, tables]);

  const legend = (
    <div className="dp-schema-legend">
      {(['public', 'key', 'admin'] as AccessTier[]).map((t) => (
        <span key={t} className="dp-schema-legend-item">
          <i style={{ background: tierColor(t) }} /> {TIER_LABEL[t]}
        </span>
      ))}
    </div>
  );

  const chips = (
    <div className="dp-schema-chips">
      {datasets.map((d) => (
        <button
          key={d.slug}
          type="button"
          className="dp-schema-chip"
          data-active={activeDataset === d.slug ? '' : undefined}
          onClick={() => setActiveDataset((cur) => (cur === d.slug ? null : d.slug))}
        >
          {d.title}
          {d.keyGated && <span className="dp-schema-chip-key">key</span>}
        </button>
      ))}
      {activeDataset && (
        <button type="button" className="dp-schema-chip dp-schema-chip-clear" onClick={() => setActiveDataset(null)}>
          Clear
        </button>
      )}
    </div>
  );

  const drawer = openT && (
    <div className="dp-schema-drawer" role="dialog" aria-label={`Table ${openT.name}`}>
      <div className="dp-schema-drawer-head">
        <div>
          <div className="dp-schema-drawer-title">{openT.name}</div>
          {openT.comment && <p className="dp-schema-drawer-comment">{openT.comment}</p>}
        </div>
        <button type="button" className="dp-schema-drawer-close" onClick={() => setOpenTable(null)} aria-label="Close">
          ×
        </button>
      </div>

      <div className="dp-schema-drawer-meta">
        <span>{openT.rows.toLocaleString()} rows (estimate)</span>
        {openTier && (
          <span className="dp-schema-tier" data-tier={openTier.tier}>
            <i style={{ background: tierColor(openTier.tier) }} /> {TIER_LABEL[openTier.tier]}
          </span>
        )}
      </div>
      {openTier && <p className="dp-schema-drawer-reason">{openTier.reason}</p>}

      <div className="dp-schema-drawer-section">
        <div className="dp-schema-drawer-label">Columns</div>
        <div className="dp-schema-cols">
          {openT.columns.map((c) => (
            <div key={c.name} className="dp-schema-col">
              <span className="dp-schema-col-name">{c.name}</span>
              <span className="dp-schema-col-type">
                {c.type}
                {c.nullable ? ' · nullable' : ''}
              </span>
              {c.enumValues && (
                <span className="dp-schema-col-enum">{c.enumValues.join(' · ')}</span>
              )}
              {c.comment && <span className="dp-schema-col-gloss">{c.comment}</span>}
            </div>
          ))}
        </div>
      </div>

      {openT.fks.length > 0 && (
        <div className="dp-schema-drawer-section">
          <div className="dp-schema-drawer-label">Foreign keys out</div>
          <ul className="dp-schema-fklist">
            {openT.fks.map((fk) => (
              <li key={`${fk.column}-${fk.refTable}`}>
                <button type="button" className="dp-schema-fklink" onClick={() => setOpenTable(fk.refTable)}>
                  {fk.column} → {fk.refTable}.{fk.refColumn}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {fksIn.length > 0 && (
        <div className="dp-schema-drawer-section">
          <div className="dp-schema-drawer-label">Foreign keys in</div>
          <ul className="dp-schema-fklist">
            {fksIn.map((fk) => (
              <li key={`${fk.table}-${fk.column}`}>
                <button type="button" className="dp-schema-fklink" onClick={() => setOpenTable(fk.table)}>
                  {fk.table}.{fk.column}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dp-schema-drawer-section">
        <div className="dp-schema-drawer-label">Datasets reading this table</div>
        {readingDatasets.length > 0 ? (
          <ul className="dp-schema-fklist">
            {readingDatasets.map((d) => (
              <li key={d.slug}>
                <a href={`/datasets/${d.slug}`}>{d.title}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dp-schema-drawer-reason">No dataset reads this table directly.</p>
        )}
      </div>
    </div>
  );

  if (narrow) {
    return (
      <div ref={wrapRef} className="dp-schema-wrap">
        {legend}
        {chips}
        <div className="dp-schema-list">
          {groups.map((g) => (
            <details key={g.key} className="dp-schema-detail">
              <summary>
                {g.label} <span className="dp-schema-detail-count">{g.tableCount} tables · {g.totalRows.toLocaleString()} rows</span>
              </summary>
              <div className="dp-schema-detail-rows">
                {g.tables.map((t) => {
                  const tier = tiers[t.name];
                  const lit = litTables ? litTables.has(t.name) : true;
                  return (
                    <button
                      key={t.name}
                      type="button"
                      className="dp-schema-row-btn"
                      data-dim={lit ? undefined : ''}
                      onClick={() => setOpenTable(t.name)}
                    >
                      <span>{t.name}</span>
                      <span className="dp-schema-row-rows">{t.rows.toLocaleString()}</span>
                      {tier && <i className="dp-schema-dot" style={{ background: tierColor(tier.tier) }} />}
                    </button>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
        {drawer}
      </div>
    );
  }

  const maxRow = groups.length ? Math.max(...groups.map((g) => g.row)) : 0;
  const colsInRow = (row: number) => groups.filter((g) => g.row === row).length;
  const maxCols = groups.length ? Math.max(...Array.from({ length: maxRow + 1 }, (_, r) => colsInRow(r))) : 1;
  const canvasW = maxCols * GROUP_W + (maxCols - 1) * GROUP_GAP_X + PAD * 2;

  const heightFor = (g: LaidGroup) => {
    const isOpen = expanded === g.key;
    const shown = isOpen ? g.tableCount : Math.min(g.tableCount, MAX_ROWS_COLLAPSED);
    const extra = !isOpen && g.tableCount > MAX_ROWS_COLLAPSED ? 1 : 0;
    return GROUP_H_HEAD + (shown + extra) * ROW_H + 10;
  };
  const rowHeights: number[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const inRow = groups.filter((g) => g.row === r);
    rowHeights[r] = Math.max(0, ...inRow.map(heightFor));
  }
  const rowY: number[] = [];
  let acc = PAD;
  for (let r = 0; r <= maxRow; r++) {
    rowY[r] = acc;
    acc += rowHeights[r] + GROUP_GAP_Y;
  }
  const canvasH = acc;

  const centerOf = (g: LaidGroup) => ({
    x: PAD + g.col * (GROUP_W + GROUP_GAP_X) + GROUP_W / 2,
    y: rowY[g.row] + heightFor(g) / 2,
  });

  return (
    <div ref={wrapRef} className="dp-schema-wrap">
      {legend}
      {chips}
      <div className="dp-schema-canvas" style={{ overflowX: 'auto' }}>
        <svg width={canvasW} height={canvasH} viewBox={`0 0 ${canvasW} ${canvasH}`} role="img" aria-label="Table schema map, grouped by subsystem">
          <g className="dp-schema-edges">
            {edges.map((e) => {
              const gA = groups.find((g) => g.key === e.from);
              const gB = groups.find((g) => g.key === e.to);
              if (!gA || !gB) return null;
              const a = centerOf(gA);
              const b = centerOf(gB);
              const midY = (a.y + b.y) / 2;
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M${a.x} ${a.y} C${a.x} ${midY} ${b.x} ${midY} ${b.x} ${b.y}`}
                  className="dp-schema-edge"
                  strokeWidth={Math.min(6, 1 + Math.log2(1 + e.count))}
                />
              );
            })}
          </g>
        </svg>
        <div className="dp-schema-groups" style={{ width: canvasW, height: canvasH }}>
          {groups.map((g) => {
            const isOpen = expanded === g.key;
            const shown = isOpen ? g.tables : g.tables.slice(0, MAX_ROWS_COLLAPSED);
            const hiddenCount = g.tableCount - shown.length;
            return (
              <div
                key={g.key}
                className="dp-schema-group"
                style={{
                  left: PAD + g.col * (GROUP_W + GROUP_GAP_X),
                  top: rowY[g.row],
                  width: GROUP_W,
                  height: heightFor(g),
                }}
              >
                <button
                  type="button"
                  className="dp-schema-group-head"
                  onClick={() => setExpanded((cur) => (cur === g.key ? null : g.key))}
                  aria-expanded={isOpen}
                >
                  <span className="dp-schema-group-title">{g.label}</span>
                  <span className="dp-schema-group-count">
                    {g.tableCount} tables · {g.totalRows.toLocaleString()} rows
                  </span>
                </button>
                <div className="dp-schema-group-rows">
                  {shown.map((t) => {
                    const tier = tiers[t.name];
                    const lit = litTables ? litTables.has(t.name) : true;
                    return (
                      <button
                        key={t.name}
                        type="button"
                        className="dp-schema-row-btn"
                        data-dim={lit ? undefined : ''}
                        onMouseEnter={() => setHoverTable(t.name)}
                        onMouseLeave={() => setHoverTable((cur) => (cur === t.name ? null : cur))}
                        onFocus={() => setHoverTable(t.name)}
                        onBlur={() => setHoverTable((cur) => (cur === t.name ? null : cur))}
                        onClick={() => setOpenTable(t.name)}
                        title={t.comment ?? undefined}
                      >
                        <span>{t.name}</span>
                        <span className="dp-schema-row-rows">{t.rows.toLocaleString()}</span>
                        {tier && <i className="dp-schema-dot" style={{ background: tierColor(tier.tier) }} />}
                      </button>
                    );
                  })}
                  {!isOpen && hiddenCount > 0 && (
                    <button type="button" className="dp-schema-row-more" onClick={() => setExpanded(g.key)}>
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {hoverTable && !openTable && (
        <div className="dp-schema-hovertip" aria-hidden="true">
          {tableByName.get(hoverTable)?.comment ?? hoverTable}
        </div>
      )}
      {drawer}
    </div>
  );
}

