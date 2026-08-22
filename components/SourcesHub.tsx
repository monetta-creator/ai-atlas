'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { SourceWithCounts, EvidenceGraph } from '@/lib/data';
import { timeAgo } from '@/lib/format';
import SourceEvidenceMap from './SourceEvidenceMap';

type Direction = 'any' | 'supports' | 'contradicts' | 'mixed' | 'none';

export default function SourcesHub({
  sources,
  graph,
}: {
  sources: SourceWithCounts[];
  graph: EvidenceGraph;
}) {
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [hasDossier, setHasDossier] = useState(false);
  const [minPrior, setMinPrior] = useState(0);
  const [direction, setDirection] = useState<Direction>('any');
  const [hypothesis, setHypothesis] = useState('');
  const [search, setSearch] = useState('');

  // Per-source direction tallies + touched hypotheses, from the graph edges.
  const perSource = useMemo(() => {
    const m = new Map<string, { supports: number; contradicts: number; hyps: Set<string> }>();
    for (const e of graph.edges) {
      let rec = m.get(e.source_id);
      if (!rec) { rec = { supports: 0, contradicts: 0, hyps: new Set() }; m.set(e.source_id, rec); }
      if (e.direction === 'supports') rec.supports++;
      if (e.direction === 'contradicts') rec.contradicts++;
      rec.hyps.add(e.hypothesis_id);
    }
    return m;
  }, [graph.edges]);

  const filtered = useMemo(
    () =>
      sources.filter((s) => {
        const rec = perSource.get(s.id);
        if (hasDossier && !s.dossier) return false;
        if (minPrior > 0 && (s.reliability_prior ?? 0) < minPrior) return false;
        if (direction === 'supports' && !(rec && rec.supports > 0)) return false;
        if (direction === 'contradicts' && !(rec && rec.contradicts > 0)) return false;
        if (direction === 'mixed' && !(rec && rec.supports > 0 && rec.contradicts > 0)) return false;
        if (direction === 'none' && s.evidence_count > 0) return false;
        if (hypothesis && !rec?.hyps.has(hypothesis)) return false;
        if (search) {
          const hay = `${s.title ?? ''} ${s.outlet ?? ''} ${s.author ?? ''}`.toLowerCase();
          if (!hay.includes(search.toLowerCase())) return false;
        }
        return true;
      }),
    [sources, hasDossier, minPrior, direction, hypothesis, search, perSource]
  );

  // subgraph for the map view (same filters; the hypothesis filter scopes the right column)
  const allowedSourceIds = useMemo(() => new Set(filtered.map((s) => s.id)), [filtered]);
  const mapSources = useMemo(() => graph.sources.filter((s) => allowedSourceIds.has(s.id)), [graph.sources, allowedSourceIds]);
  const mapHypotheses = useMemo(
    () => (hypothesis ? graph.hypotheses.filter((h) => h.id === hypothesis) : graph.hypotheses),
    [graph.hypotheses, hypothesis]
  );
  const mapEdges = useMemo(() => {
    const hypIds = new Set(mapHypotheses.map((h) => h.id));
    return graph.edges.filter((e) => allowedSourceIds.has(e.source_id) && hypIds.has(e.hypothesis_id));
  }, [graph.edges, allowedSourceIds, mapHypotheses]);

  const selStyle = { width: 'auto', padding: '6px 10px', fontSize: 12.5 } as const;

  return (
    <div>
      {/* tabs + add */}
      <div className="flex items-center justify-between flex-wrap gap-3" style={{ marginBottom: 16 }}>
        <div className="flex items-center gap-2">
          {(['list', 'map'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={tab === t ? 'btn btn--ghost btn--sm' : 'btn btn--quiet btn--sm'}
              style={tab === t ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            >
              {t === 'list' ? 'List' : 'Evidence map'}
            </button>
          ))}
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
            {filtered.length} of {sources.length}
          </span>
        </div>
        <Link href="/ingest" className="btn btn--primary btn--sm">+ Add source</Link>
      </div>

      {/* filter bar */}
      <div
        className="flex items-center flex-wrap gap-2 rounded-[var(--radius)] border p-3"
        style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 20 }}
      >
        <select className="input" style={selStyle} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}>
          <option value="">All hypotheses</option>
          {graph.hypotheses.map((h) => (
            <option key={h.id} value={h.id}>{h.code} · {h.statement.slice(0, 60)}</option>
          ))}
        </select>
        <select className="input" style={selStyle} value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
          <option value="any">Any evidence</option>
          <option value="supports">Has supporting</option>
          <option value="contradicts">Has contradicting</option>
          <option value="mixed">Mixed</option>
          <option value="none">Unattached</option>
        </select>
        <select className="input" style={selStyle} value={minPrior} onChange={(e) => setMinPrior(Number(e.target.value))}>
          <option value={0}>Any reliability</option>
          <option value={50}>Prior ≥ 50</option>
          <option value={70}>Prior ≥ 70</option>
          <option value={85}>Prior ≥ 85</option>
        </select>
        <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--dim)' }}>
          <input type="checkbox" checked={hasDossier} onChange={(e) => setHasDossier(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          Has dossier
        </label>
        <input
          className="input"
          style={{ flex: 1, minWidth: 140, padding: '6px 10px', fontSize: 12.5 }}
          placeholder="Search title / outlet / author…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {tab === 'map' ? (
        <SourceEvidenceMap sources={mapSources} hypotheses={mapHypotheses} edges={mapEdges} />
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>No sources match these filters.</p>
      ) : (
        <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
          {filtered.map((s) => {
            const rec = perSource.get(s.id);
            return (
              <li
                key={s.id}
                className="rounded-[var(--radius)] border p-4"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 sm:flex-wrap">
                  <div className="min-w-0 flex-1">
                    <Link href={`/source/${s.id}`} className="text-sm font-medium hover:underline" style={{ color: 'var(--ink)' }}>
                      {s.title || 'Untitled source'}
                    </Link>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--faint-ink)' }}>
                      {[s.outlet, s.author].filter(Boolean).join(' · ') || '–'} · added {timeAgo(s.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-[11px]" style={{ color: 'var(--faint-ink)' }}>
                    {s.dossier && <span style={{ color: 'var(--supports)' }}>✦ dossier</span>}
                    {s.reliability_prior != null && (
                      <span className="flex items-center gap-1.5">
                        <span style={{ display: 'inline-block', width: 40, height: 4, background: 'var(--line)', borderRadius: 2 }}>
                          <span style={{ display: 'block', width: `${s.reliability_prior}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                        </span>
                        {s.reliability_prior}
                      </span>
                    )}
                    <span>
                      {s.evidence_count === 0
                        ? 'unattached'
                        : `${s.evidence_count} evidence · `}
                      {s.evidence_count > 0 && rec && (
                        <>
                          <span style={{ color: 'var(--supports)' }}>{rec.supports}↑</span>{' '}
                          <span style={{ color: 'var(--contradicts)' }}>{rec.contradicts}↓</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
                {s.dossier && (
                  <details className="mt-2">
                    <summary className="lbl cursor-pointer" style={{ fontSize: 9.5 }}>Dossier</summary>
                    <div className="mt-2 text-[13px]" style={{ color: 'var(--dim)', lineHeight: 1.55 }}>
                      {s.dossier.document_internal?.thesis && (
                        <p style={{ margin: '0 0 6px' }}><span style={{ color: 'var(--faint-ink)' }}>Thesis: </span>{s.dossier.document_internal.thesis}</p>
                      )}
                      {s.dossier.for_the_analyst?.bias_to_model && (
                        <p style={{ margin: 0 }}><span style={{ color: 'var(--faint-ink)' }}>Bias to model: </span>{s.dossier.for_the_analyst.bias_to_model}</p>
                      )}
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
