'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { EvidenceGraphSource, EvidenceGraphHypothesis, EvidenceGraphEdge } from '@/lib/data';

// Bipartite sources ↔ hypotheses connector (measured-anchor technique): sources
// on the left, hypotheses on the right, evidence as green/red edges. Hover a
// node to trace its links; hypotheses with no incoming edge are flagged as gaps.
// Receives an already-filtered subgraph and just renders it.

type Rel = 'support' | 'contradict' | 'depends';
function relOf(d: string): Rel {
  return d === 'supports' ? 'support' : d === 'contradicts' ? 'contradict' : 'depends';
}
function truncate(s: string, n = 90) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default function SourceEvidenceMap({
  sources,
  hypotheses,
  edges,
}: {
  sources: EvidenceGraphSource[];
  hypotheses: EvidenceGraphHypothesis[];
  edges: EvidenceGraphEdge[];
}) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ id: string; d: string; rel: Rel; from: string; to: string }[]>([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  // only sources that actually have evidence appear on the left
  const sourceIdsWithEdges = useMemo(() => new Set(edges.map((e) => e.source_id)), [edges]);
  const shownSources = useMemo(
    () => sources.filter((s) => sourceIdsWithEdges.has(s.id)),
    [sources, sourceIdsWithEdges]
  );
  const targetsWithEdges = useMemo(
    () => new Set(edges.map((e) => `hyp:${e.hypothesis_id}`)),
    [edges]
  );

  const mapEdges = useMemo(
    () => edges.map((e, i) => ({
      id: `${e.source_id}-${i}`,
      from: `source:${e.source_id}`,
      to: `hyp:${e.hypothesis_id}`,
      rel: relOf(e.direction),
    })),
    [edges]
  );

  // Mobile fallback data: the SVG connectors are hidden at <=820px (and the two
  // columns stack), so the source↔hypothesis links would be invisible. Precompute,
  // per source, the codes it bears on + their relation, rendered as relation chips
  // inside each source node (shown only when the curves are hidden — see .relchips).
  const codeOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of hypotheses) m.set(`hyp:${h.id}`, h.code);
    return m;
  }, [hypotheses]);
  const sourceRels = useMemo(() => {
    const m = new Map<string, { code: string; rel: Rel }[]>();
    for (const e of mapEdges) {
      const code = codeOf.get(e.to);
      if (!code) continue;
      let arr = m.get(e.from);
      if (!arr) { arr = []; m.set(e.from, arr); }
      arr.push({ code, rel: e.rel });
    }
    return m;
  }, [mapEdges, codeOf]);

  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const mr = map.getBoundingClientRect();
    if (mr.width < 560) { setPaths([]); return; }
    const next: typeof paths = [];
    for (const e of mapEdges) {
      const a = map.querySelector<HTMLElement>(`[data-node="${e.from}"]`);
      const b = map.querySelector<HTMLElement>(`[data-node="${e.to}"]`);
      if (!a || !b) continue;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const ax = ar.right - mr.left, ay = ar.top - mr.top + ar.height / 2;
      const bx = br.left - mr.left, by = br.top - mr.top + br.height / 2;
      const dx = Math.max(40, (bx - ax) * 0.5);
      next.push({ ...e, d: `M${ax} ${ay} C${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}` });
    }
    setDims({ w: mr.width, h: mr.height });
    setPaths(next);
  }, [mapEdges]);

  useEffect(() => {
    draw();
    const map = mapRef.current;
    const ro = new ResizeObserver(() => draw());
    if (map) ro.observe(map);
    window.addEventListener('resize', draw);
    return () => { ro.disconnect(); window.removeEventListener('resize', draw); };
  }, [draw]);

  if (!edges.length) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No evidence attached yet. Nothing to map.</p>;
  }

  const related = new Set<string>();
  if (hover) {
    related.add(hover);
    for (const e of mapEdges) {
      if (e.from === hover) related.add(e.to);
      if (e.to === hover) related.add(e.from);
    }
  }
  const dim = (k: string) => hover != null && !related.has(k);

  const sourceNode = (s: EvidenceGraphSource) => (
    <div
      key={s.id}
      className={`node${dim(`source:${s.id}`) ? ' dim' : ''}`}
      data-node={`source:${s.id}`}
      role="link"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
      onMouseEnter={() => setHover(`source:${s.id}`)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(`source:${s.id}`)}
      onBlur={() => setHover(null)}
      onClick={() => router.push(`/source/${s.id}`)}
      onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/source/${s.id}`); }}
    >
      <div className="stxt" style={{ fontSize: 14 }}>{s.title || 'Untitled source'}</div>
      {(s.outlet || s.reliability_prior != null) && (
        <div className="swho">
          {s.outlet || ''}{s.outlet && s.reliability_prior != null ? ' · ' : ''}
          {s.reliability_prior != null ? `prior ${s.reliability_prior}` : ''}
        </div>
      )}
      {/* Relation-chip fallback (visible only when curves are hidden on mobile). */}
      {(() => {
        const rels = sourceRels.get(`source:${s.id}`);
        if (!rels?.length) return null;
        return (
          <div className="relchips">
            {rels.map((r, i) => (
              <span key={i} className={`relchip${r.rel === 'support' ? ' sup' : r.rel === 'contradict' ? ' con' : ''}`}>
                {r.code}{r.rel === 'support' ? ' ↑' : r.rel === 'contradict' ? ' ↓' : ''}
              </span>
            ))}
          </div>
        );
      })()}
    </div>
  );

  const hypothesisNode = (h: EvidenceGraphHypothesis) => {
    const key = `hyp:${h.id}`;
    const gap = !targetsWithEdges.has(key);
    const href = `/hypothesis/${encodeURIComponent(h.code)}`;
    return (
      <div
        key={key}
        className={`node node-claim${dim(key) ? ' dim' : ''}`}
        data-node={key}
        role="link"
        tabIndex={0}
        style={{ cursor: 'pointer', opacity: gap ? 0.6 : undefined }}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(key)}
        onBlur={() => setHover(null)}
        onClick={() => router.push(href)}
        onKeyDown={(e) => { if (e.key === 'Enter') router.push(href); }}
      >
        <span className="cnum">{h.code}</span>
        <div>
          <div className="ctxt">{truncate(h.statement)}</div>
          {gap && <div className="relchips"><span className="relchip" style={{ color: 'var(--faint-ink)' }}>no evidence</span></div>}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="map-legend">
        <span className="k sup"><span className="line" /> supports</span>
        <span className="k con"><span className="line" /> contradicts</span>
        <span style={{ marginLeft: 'auto', color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          hover a node to trace its links
        </span>
      </div>
      <div className="map" ref={mapRef}>
        <svg className="edges" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="none" aria-hidden="true">
          {paths.map((p) => {
            const hot = hover === p.from || hover === p.to;
            const cls = [
              p.rel === 'contradict' ? 'contradict' : p.rel === 'support' ? 'support' : '',
              hover && hot ? 'hot' : '',
              hover && !hot ? 'faded' : '',
            ].filter(Boolean).join(' ');
            return <path key={p.id} d={p.d} className={cls} style={p.rel === 'depends' ? { stroke: 'var(--heat-against)' } : undefined} />;
          })}
        </svg>

        <div className="map-col">
          <div className="col-label">Sources ({shownSources.length})</div>
          {shownSources.map(sourceNode)}
        </div>

        <div className="map-col">
          <div className="col-label">Hypotheses</div>
          {hypotheses.map(hypothesisNode)}
        </div>
      </div>
    </div>
  );
}
