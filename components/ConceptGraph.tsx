'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ConceptEdge, ConceptStatus } from '@/lib/types';
import { CONCEPT_STATUS_LABEL } from '@/lib/format';

export interface ConceptGraphNode {
  id: string;
  slug: string;
  name: string;
  short_definition: string;
  status: ConceptStatus;
}

const NODE_W = 160;
const NODE_H = 46;
const H_GAP = 18;
const V_GAP = 58;
const PAD = 14;

interface LaidNode extends ConceptGraphNode {
  depth: number;
  x: number;
  y: number;
  lines: string[];
}

interface LaidEdge {
  key: string;
  conceptId: string;
  prerequisiteId: string;
  d: string;
}

// Two lines max: break at the space nearest the middle of a long name.
function wrapName(name: string): string[] {
  if (name.length <= 17) return [name];
  const mid = Math.floor(name.length / 2);
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ' ' && (best === -1 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  if (best === -1) return [name];
  return [name.slice(0, best), name.slice(best + 1)];
}

// Layered DAG layout: depth = longest prerequisite chain (0 = foundational, drawn
// at the BOTTOM), with two barycenter sweeps to reduce edge crossings.
function layout(nodes: ConceptGraphNode[], edges: ConceptEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const live = edges.filter((e) => ids.has(e.concept_id) && ids.has(e.prerequisite_id));

  const prereqsOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const e of live) {
    const ps = prereqsOf.get(e.concept_id) ?? [];
    ps.push(e.prerequisite_id);
    prereqsOf.set(e.concept_id, ps);
    const ds = dependentsOf.get(e.prerequisite_id) ?? [];
    ds.push(e.concept_id);
    dependentsOf.set(e.prerequisite_id, ds);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // cycle guard (the writer keeps the graph a DAG)
    visiting.add(id);
    const ps = prereqsOf.get(id) ?? [];
    const d = ps.length ? 1 + Math.max(...ps.map(depthOf)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));
  const maxDepth = nodes.length ? Math.max(...nodes.map((n) => depth.get(n.id)!)) : 0;

  const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
  [...nodes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((n) => layers[depth.get(n.id)!].push(n.id));

  const pos = new Map<string, number>();
  layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  const sortLayer = (layer: string[], neighborOf: Map<string, string[]>) => {
    const score = (id: string) => {
      const ns = (neighborOf.get(id) ?? []).map((n) => pos.get(n)).filter((v): v is number => v !== undefined);
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : pos.get(id)!;
    };
    layer.sort((a, b) => score(a) - score(b));
    layer.forEach((id, i) => pos.set(id, i));
  };
  for (let d = 1; d <= maxDepth; d++) sortLayer(layers[d], prereqsOf);
  for (let d = maxDepth - 1; d >= 0; d--) sortLayer(layers[d], dependentsOf);

  const maxPerLayer = Math.max(1, ...layers.map((l) => l.length));
  const width = maxPerLayer * NODE_W + (maxPerLayer - 1) * H_GAP + PAD * 2;
  const height = (maxDepth + 1) * NODE_H + maxDepth * V_GAP + PAD * 2;

  const laid = new Map<string, LaidNode>();
  for (const n of nodes) {
    const d = depth.get(n.id)!;
    const layer = layers[d];
    const layerW = layer.length * NODE_W + (layer.length - 1) * H_GAP;
    laid.set(n.id, {
      ...n,
      depth: d,
      x: (width - layerW) / 2 + pos.get(n.id)! * (NODE_W + H_GAP),
      y: PAD + (maxDepth - d) * (NODE_H + V_GAP),
      lines: wrapName(n.name),
    });
  }

  // Each edge climbs from the prerequisite's top edge to the dependent's bottom edge.
  const paths: LaidEdge[] = [];
  for (const e of live) {
    const p = laid.get(e.prerequisite_id)!;
    const c = laid.get(e.concept_id)!;
    const x1 = p.x + NODE_W / 2;
    const y1 = p.y;
    const x2 = c.x + NODE_W / 2;
    const y2 = c.y + NODE_H;
    const mid = (y1 + y2) / 2;
    paths.push({
      key: `${e.prerequisite_id}-${e.concept_id}`,
      conceptId: e.concept_id,
      prerequisiteId: e.prerequisite_id,
      d: `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`,
    });
  }

  // Top-down layers (most advanced first) for the narrow-screen list fallback.
  const layersTopDown = [...layers].reverse().map((l) => l.map((id) => laid.get(id)!));

  return { nodes: [...laid.values()], paths, width, height, layersTopDown };
}

// The /concepts scaffold: foundational concepts at the bottom, advanced at the top,
// dependency edges climbing between them. Hover for the definition, click through to
// the concept page. Below ~640px the boxes-and-lines view gives way to a layered list.
export default function ConceptGraph({
  nodes,
  edges,
}: {
  nodes: ConceptGraphNode[];
  edges: ConceptEdge[];
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  const g = useMemo(() => layout(nodes, edges), [nodes, edges]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const check = () => setNarrow(el.getBoundingClientRect().width < 640);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (nodes.length === 0) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No concepts yet.</p>;
  }

  // who is related to the hovered node (for dimming), mirroring QuestionMap
  const related = new Set<string>();
  if (hover) {
    related.add(hover);
    for (const p of g.paths) {
      if (p.conceptId === hover) related.add(p.prerequisiteId);
      if (p.prerequisiteId === hover) related.add(p.conceptId);
    }
  }
  const dimmed = (id: string) => hover != null && !related.has(id);
  const hovered = hover ? g.nodes.find((n) => n.id === hover) : null;
  // Tooltip sits below the node, unless the node is near the bottom of the canvas.
  const tipBelow = hovered ? hovered.y + NODE_H + 150 < g.height : true;

  const legend = (
    <div className="concept-legend">
      <span>foundational at the bottom, each line means “understand the lower concept first”</span>
      <span className="concept-legend-key">
        <i data-status="settled" /> settled
        <i data-status="contested" /> contested definition
      </span>
    </div>
  );

  if (narrow) {
    return (
      <div ref={wrapRef}>
        {legend}
        <div className="concept-layers">
          {g.layersTopDown.map((layer, i) => (
            <div key={i} className="concept-layer">
              <div className="concept-layer-label">
                {i === 0 ? 'most advanced' : i === g.layersTopDown.length - 1 ? 'foundational' : '·'}
              </div>
              <div className="concept-layer-row">
                {layer.map((n) => (
                  <Link key={n.id} href={`/concepts/${n.slug}`} className="concept-chip" data-status={n.status}>
                    {n.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      {legend}
      <div className="concept-canvas">
        <svg
          className="concept-graph"
          width={g.width}
          height={g.height}
          viewBox={`0 0 ${g.width} ${g.height}`}
          role="img"
          aria-label="Concept dependency graph, foundational concepts at the bottom, advanced at the top"
        >
          {g.paths.map((p) => {
            const isHot = hover === p.conceptId || hover === p.prerequisiteId;
            const cls = ['cedge', hover && isHot ? 'hot' : '', hover && !isHot ? 'faded' : '']
              .filter(Boolean)
              .join(' ');
            return <path key={p.key} d={p.d} className={cls} />;
          })}
          {g.nodes.map((n) => (
            <g
              key={n.id}
              className={`concept-node${dimmed(n.id) ? ' dim' : ''}${hover === n.id ? ' hot' : ''}`}
              data-status={n.status}
              transform={`translate(${n.x}, ${n.y})`}
              role="link"
              tabIndex={0}
              aria-label={`${n.name}, ${CONCEPT_STATUS_LABEL[n.status]}`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              onClick={() => router.push(`/concepts/${n.slug}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/concepts/${n.slug}`);
                }
              }}
            >
              <rect width={NODE_W} height={NODE_H} rx={9} />
              {n.lines.map((line, i) => (
                <text
                  key={i}
                  x={NODE_W / 2}
                  y={NODE_H / 2 + (n.lines.length === 1 ? 0 : i === 0 ? -7 : 7)}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {line}
                </text>
              ))}
              {n.status === 'contested' && <circle className="cmark" cx={NODE_W - 11} cy={11} r={3.5} />}
            </g>
          ))}
        </svg>

        {hovered && (
          <div
            className="concept-tip"
            style={{
              left: hovered.x + NODE_W / 2,
              top: tipBelow ? hovered.y + NODE_H + 10 : undefined,
              bottom: tipBelow ? undefined : g.height - hovered.y + 10,
            }}
          >
            <div className="concept-tip-head">
              <strong>{hovered.name}</strong>
              <span className="concept-tip-status" data-status={hovered.status}>
                {CONCEPT_STATUS_LABEL[hovered.status]}
              </span>
            </div>
            <p>{hovered.short_definition}</p>
          </div>
        )}
      </div>
    </div>
  );
}
