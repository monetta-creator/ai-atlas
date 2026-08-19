'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScEdge, ScLayer, ScNodeView } from '@/lib/supply-chain/map';
import { RISK_DOT_VAR, RISK_LABEL } from '@/lib/supply-chain/map';
import SupplyChainDrawer from './SupplyChainDrawer';

const NODE_W = 150;
const NODE_H = 44;
const H_GAP = 16;
const LAYER_GAP = 60; // vertical space between one tier's node row and the next band
const BAND_LABEL_H = 24;
const PAD = 16;
const CROSS_GAP = 34; // extra separation before the cross-cutting band

interface LaidNode extends ScNodeView {
  x: number;
  y: number;
  lines: string[];
}
interface LaidEdge {
  key: string;
  from: string;
  to: string;
  d: string;
  emphasis: boolean;
}
interface LaidBand {
  index: number;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Two lines max: break a long label at the space nearest its midpoint.
function wrapLabel(label: string): string[] {
  if (label.length <= 15) return [label];
  const mid = Math.floor(label.length / 2);
  let best = -1;
  for (let i = 0; i < label.length; i++) {
    if (label[i] === ' ' && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  if (best === -1) return [label];
  return [label.slice(0, best), label.slice(best + 1)];
}

// Explicit-tier layout: the doc gives us the layer index, so no depth search is needed.
// Layer 0 (raw materials) sits at the top and flow runs downward to end users; the
// cross-cutting band is set apart at the bottom. Edges route from the nearer vertical
// edge of each node, so the few upstream-of-the-grid links (energy under data centers)
// curve cleanly instead of looping.
function layout(layers: ScLayer[], nodes: ScNodeView[], edges: ScEdge[]) {
  const ordered = [...layers].sort((a, b) => a.index - b.index);
  const byLayer = new Map<number, ScNodeView[]>();
  for (const n of nodes) {
    const list = byLayer.get(n.layer) ?? [];
    list.push(n);
    byLayer.set(n.layer, list);
  }
  // chokepoints first, then alphabetical, for a stable reading order within a tier
  for (const list of byLayer.values()) {
    list.sort((a, b) =>
      a.isChokepoint === b.isChokepoint ? a.name.localeCompare(b.name) : a.isChokepoint ? -1 : 1
    );
  }

  const widthOf = (count: number) => count * NODE_W + Math.max(0, count - 1) * H_GAP;
  const contentW = Math.max(
    NODE_W,
    ...ordered.map((l) => widthOf((byLayer.get(l.index) ?? []).length))
  );
  const width = contentW + PAD * 2;

  const laid = new Map<string, LaidNode>();
  const bands: LaidBand[] = [];
  let y = PAD;
  for (const layer of ordered) {
    if (layer.band === 'crosscutting') y += CROSS_GAP;
    const rowNodes = byLayer.get(layer.index) ?? [];
    const bandTop = y;
    const nodeY = y + BAND_LABEL_H;
    const layerW = widthOf(rowNodes.length);
    const startX = (width - layerW) / 2;
    rowNodes.forEach((n, i) => {
      laid.set(n.slug, { ...n, x: startX + i * (NODE_W + H_GAP), y: nodeY, lines: wrapLabel(n.label) });
    });
    bands.push({
      index: layer.index,
      title: layer.title,
      x: PAD / 2,
      y: bandTop,
      w: width - PAD,
      h: BAND_LABEL_H + NODE_H + 8,
    });
    y = nodeY + NODE_H + LAYER_GAP;
  }
  const height = y - LAYER_GAP + PAD;

  const paths: LaidEdge[] = [];
  for (const e of edges) {
    const f = laid.get(e.from);
    const t = laid.get(e.to);
    if (!f || !t) continue;
    const x1 = f.x + NODE_W / 2;
    const x2 = t.x + NODE_W / 2;
    let y1: number;
    let y2: number;
    if (f.y <= t.y) {
      y1 = f.y + NODE_H; // exit the bottom of the upper node
      y2 = t.y; // enter the top of the lower node
    } else {
      y1 = f.y; // upstream-of-grid: exit the top
      y2 = t.y + NODE_H; // enter the bottom
    }
    const mid = (y1 + y2) / 2;
    paths.push({
      key: `${e.from}__${e.to}`,
      from: e.from,
      to: e.to,
      emphasis: !!e.emphasis,
      d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`,
    });
  }

  const listLayers = ordered.map((l) => ({ layer: l, nodes: byLayer.get(l.index) ?? [] }));

  return { width, height, nodes: [...laid.values()], edges: paths, bands, listLayers };
}

export default function SupplyChainMap({
  layers,
  nodes,
  edges,
  admin,
}: {
  layers: ScLayer[];
  nodes: ScNodeView[];
  edges: ScEdge[];
  admin: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<SVGGElement | HTMLButtonElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const g = useMemo(() => layout(layers, nodes, edges), [layers, nodes, edges]);
  const bySlug = useMemo(() => new Map(nodes.map((n) => [n.slug, n])), [nodes]);
  const layerTitle = useMemo(() => new Map(layers.map((l) => [l.index, l.title])), [layers]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => setNarrow(el.getBoundingClientRect().width < 640);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = (slug: string, el: SVGGElement | HTMLButtonElement) => {
    triggerRef.current = el;
    setOpenSlug(slug);
  };
  const close = () => {
    setOpenSlug(null);
    // return focus to the node that opened the drawer
    triggerRef.current?.focus();
  };

  // who is connected to the hovered node (for dimming the rest), mirroring ConceptGraph
  const related = new Set<string>();
  if (hover) {
    related.add(hover);
    for (const e of g.edges) {
      if (e.from === hover) related.add(e.to);
      if (e.to === hover) related.add(e.from);
    }
  }
  const dimmed = (slug: string) => hover != null && !related.has(slug);

  const openNode = openSlug ? bySlug.get(openSlug) ?? null : null;

  const legend = (
    <div className="sc-legend">
      <span>Raw materials at the top, flow runs down to end users. Hover a node to trace its links.</span>
      <span className="sc-legend-key">
        <i className="sc-legend-choke" /> chokepoint
        <span className="sc-legend-risk">
          risk
          <i style={{ background: RISK_DOT_VAR.low }} />
          <i style={{ background: RISK_DOT_VAR.medium }} />
          <i style={{ background: RISK_DOT_VAR.high }} />
          <i style={{ background: RISK_DOT_VAR.critical }} />
        </span>
      </span>
    </div>
  );

  if (narrow) {
    return (
      <div ref={wrapRef}>
        {legend}
        <div className="sc-list">
          {g.listLayers.map(({ layer, nodes: rowNodes }) => (
            <div key={layer.index} className="sc-list-layer">
              <div className="sc-list-label">{layer.band === 'crosscutting' ? layer.title : `L${layer.index} · ${layer.title}`}</div>
              <div className="sc-list-row">
                {rowNodes.map((n) => (
                  <button
                    key={n.slug}
                    type="button"
                    className="sc-chip"
                    data-chokepoint={n.isChokepoint ? '' : undefined}
                    onClick={(e) => open(n.slug, e.currentTarget)}
                  >
                    <span className="sc-chip-risk" data-risk={n.risk} aria-hidden="true" />
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <SupplyChainDrawer node={openNode} layerTitle={openNode ? layerTitle.get(openNode.layer) ?? null : null} admin={admin} onClose={close} />
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      {legend}
      <div className="sc-canvas">
        <svg
          className="sc-graph"
          width={g.width}
          height={g.height}
          viewBox={`0 0 ${g.width} ${g.height}`}
          role="img"
          aria-label="AI economy supply chain, raw materials at the top flowing down to end users"
        >
          {g.bands.map((b) => (
            <g key={b.index} className="sc-band-g">
              <rect className="sc-band" x={b.x} y={b.y} width={b.w} height={b.h} rx={10} />
              <text className="sc-band-label" x={b.x + 12} y={b.y + 15}>
                {b.index <= 15 ? `L${b.index} · ${b.title}` : b.title}
              </text>
            </g>
          ))}

          {g.edges.map((p) => {
            const isHot = hover === p.from || hover === p.to;
            const cls = ['sc-edge', p.emphasis ? 'emph' : '', hover && isHot ? 'hot' : '', hover && !isHot ? 'faded' : '']
              .filter(Boolean)
              .join(' ');
            return <path key={p.key} d={p.d} className={cls} />;
          })}

          {g.nodes.map((n) => (
            <g
              key={n.slug}
              className={`sc-node${dimmed(n.slug) ? ' dim' : ''}${hover === n.slug ? ' hot' : ''}`}
              data-chokepoint={n.isChokepoint ? '' : undefined}
              transform={`translate(${n.x}, ${n.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${n.name}${n.isChokepoint ? ', chokepoint' : ''}, risk ${RISK_LABEL[n.risk]}`}
              onMouseEnter={() => setHover(n.slug)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.slug)}
              onBlur={() => setHover(null)}
              onClick={(e) => open(n.slug, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(n.slug, e.currentTarget);
                }
              }}
            >
              {n.hasRecentSignal && (
                <rect className="sc-pulse" x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={12} aria-hidden="true" />
              )}
              <rect className="sc-node-box" width={NODE_W} height={NODE_H} rx={9} />
              {n.isChokepoint && <rect className="sc-choke-stripe" x={0} y={0} width={3.5} height={NODE_H} />}
              {n.lines.map((line, i) => (
                <text
                  key={i}
                  className="sc-node-label"
                  x={NODE_W / 2}
                  y={NODE_H / 2 + (n.lines.length === 1 ? 0 : i === 0 ? -7 : 7)}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {line}
                </text>
              ))}
              <circle className="sc-risk" data-risk={n.risk} cx={NODE_W - 11} cy={11} r={4}>
                <title>{`Risk: ${RISK_LABEL[n.risk]}`}</title>
              </circle>
            </g>
          ))}
        </svg>
      </div>
      <SupplyChainDrawer node={openNode} layerTitle={openNode ? layerTitle.get(openNode.layer) ?? null : null} admin={admin} onClose={close} />
    </div>
  );
}
