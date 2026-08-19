'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Stance, Claim, Edge } from '@/lib/types';
import HeatChips from './HeatChips';

type Rel = 'support' | 'contradict' | 'depends';

interface MapEdge {
  id: string;
  claimId: string;
  stanceId: string;
  rel: Rel;
  proposed?: boolean;
}

interface DrawnPath extends MapEdge {
  d: string;
}

// A not-yet-committed claim, overlaid as a dashed "ghost" so the admin can SEE where
// it lands before committing (Phase 3). Only claim->stance edges show on this graph;
// bridge edges preview separately (bridges aren't in the SVG graph).
export interface ProposedClaim {
  id: string;        // synthetic id, e.g. '__proposed__'
  code: string;
  statement: string;
  stanceEdges: { stanceId: string; relation: string }[];
}

function relOf(relation: string): Rel {
  if (relation === 'supports') return 'support';
  if (relation === 'contradicts') return 'contradict';
  return 'depends';
}

// The signature claims↔stances bipartite graph (Console design system). Edges are
// drawn from each claim node's right edge to each stance node's left edge, measured
// after layout. Hovering a node makes its edges hot, fades the rest, and dims
// unrelated nodes. Below 820px the curves drop in favor of inline relation chips.
export default function QuestionMap({
  stances,
  claims,
  edges,
  admin,
  proposed = null,
}: {
  stances: Stance[];
  claims: Claim[];
  edges: Edge[];
  admin: boolean;
  proposed?: ProposedClaim | null;
}) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<DrawnPath[]>([]);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);

  const claimById = useMemo(() => new Set(claims.map((c) => c.id)), [claims]);
  const stanceById = useMemo(() => new Set(stances.map((s) => s.id)), [stances]);
  const stanceCode = useMemo(
    () => Object.fromEntries(stances.map((s) => [s.id, s.code])),
    [stances]
  );

  const csEdges: MapEdge[] = useMemo(() => {
    const base: MapEdge[] = edges
      .filter(
        (e) =>
          e.from_type === 'claim' &&
          e.to_type === 'stance' &&
          claimById.has(e.from_id) &&
          stanceById.has(e.to_id)
      )
      .map((e) => ({ id: e.id, claimId: e.from_id, stanceId: e.to_id, rel: relOf(e.relation) }));
    if (proposed) {
      for (const e of proposed.stanceEdges) {
        if (stanceById.has(e.stanceId)) {
          base.push({ id: `prop-${e.stanceId}`, claimId: proposed.id, stanceId: e.stanceId, rel: relOf(e.relation), proposed: true });
        }
      }
    }
    return base;
  }, [edges, claimById, stanceById, proposed]);

  // per-claim relation chips (the mobile fallback, hidden by CSS on wide screens)
  const chipsByClaim = useMemo(() => {
    const m: Record<string, { code: string; rel: Rel }[]> = {};
    for (const e of csEdges) {
      (m[e.claimId] ??= []).push({ code: stanceCode[e.stanceId], rel: e.rel });
    }
    return m;
  }, [csEdges, stanceCode]);

  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const mr = map.getBoundingClientRect();
    if (mr.width < 560) {
      setPaths([]);
      return;
    }
    const next: DrawnPath[] = [];
    for (const e of csEdges) {
      const c = map.querySelector<HTMLElement>(`[data-claim="${e.claimId}"]`);
      const s = map.querySelector<HTMLElement>(`[data-stance="${e.stanceId}"]`);
      if (!c || !s) continue;
      const cr = c.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      const ax = cr.right - mr.left;
      const ay = cr.top - mr.top + cr.height / 2;
      const bx = sr.left - mr.left;
      const by = sr.top - mr.top + sr.height / 2;
      const dx = Math.max(40, (bx - ax) * 0.5);
      next.push({
        ...e,
        d: `M${ax} ${ay} C${ax + dx} ${ay} ${bx - dx} ${by} ${bx} ${by}`,
      });
    }
    setDims({ w: mr.width, h: mr.height });
    setPaths(next);
  }, [csEdges]);

  useEffect(() => {
    draw();
    const map = mapRef.current;
    const ro = new ResizeObserver(() => draw());
    if (map) ro.observe(map);
    window.addEventListener('resize', draw);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(draw).catch(() => {});
    }
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [draw]);

  if (stances.length === 0 || (claims.length === 0 && !proposed)) {
    return <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No claims mapped to stances yet.</p>;
  }

  // who is related to the hovered node (for dimming)
  const related = new Set<string>();
  if (hover) {
    related.add(hover);
    for (const e of csEdges) {
      if (e.claimId === hover) related.add(e.stanceId);
      if (e.stanceId === hover) related.add(e.claimId);
    }
  }
  const dimmed = (id: string) => hover != null && !related.has(id);

  return (
    <div className="map" ref={mapRef}>
      <svg
        className="edges"
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {paths.map((p) => {
          const isHot = hover === p.claimId || hover === p.stanceId;
          const cls = [
            p.rel === 'contradict' ? 'contradict' : p.rel === 'support' ? 'support' : '',
            p.proposed ? 'proposed' : '',
            hover && isHot ? 'hot' : '',
            hover && !isHot ? 'faded' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <path
              key={p.id}
              d={p.d}
              className={cls}
              data-c={p.claimId}
              data-s={p.stanceId}
              style={p.rel === 'depends' && !p.proposed ? { stroke: 'var(--heat-against)' } : undefined}
            />
          );
        })}
      </svg>

      <div className="map-col claims">
        <div className="col-label">Claims</div>
        {claims.map((c) => (
          <div
            key={c.id}
            className={`node node-claim${dimmed(c.id) ? ' dim' : ''}`}
            data-claim={c.id}
            role="link"
            tabIndex={0}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHover(c.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(c.id)}
            onBlur={() => setHover(null)}
            onClick={() => router.push(`/claim/${encodeURIComponent(c.code)}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                router.push(`/claim/${encodeURIComponent(c.code)}`);
              }
            }}
          >
            <span className="cnum">{c.code}</span>
            <div>
              <div className="ctxt">{c.statement}</div>
              {admin && c.confidence != null && (
                <div className="crow">
                  <HeatChips confidence={c.confidence} label={c.confidence_label} />
                </div>
              )}
              <div className="relchips">
                {(chipsByClaim[c.id] ?? []).map((chip, i) => (
                  <span key={i} className={`relchip ${chip.rel === 'contradict' ? 'con' : 'sup'}`}>
                    {chip.code}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}

        {proposed && (
          <div
            className={`node node-claim${dimmed(proposed.id) ? ' dim' : ''}`}
            data-claim={proposed.id}
            data-proposed=""
            style={{ cursor: 'default' }}
            onMouseEnter={() => setHover(proposed.id)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="cnum">{proposed.code || 'new'}</span>
            <div>
              <div className="ctxt">{proposed.statement || '(your claim)'}</div>
              <span className="proposed-tag">proposed</span>
              <div className="relchips">
                {(chipsByClaim[proposed.id] ?? []).map((chip, i) => (
                  <span key={i} className={`relchip ${chip.rel === 'contradict' ? 'con' : 'sup'}`}>
                    {chip.code}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="map-col stances">
        <div className="col-label">Stances</div>
        {stances.map((s) => (
          <div
            key={s.id}
            className={`node node-stance${dimmed(s.id) ? ' dim' : ''}`}
            data-stance={s.id}
            onMouseEnter={() => setHover(s.id)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="scode">{s.code}</div>
            <div className="stxt">{s.title}</div>
            {s.holder && <div className="swho">held by {s.holder}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
