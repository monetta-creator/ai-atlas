'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CalibrationData, ConfidenceLabel } from '@/lib/types';
import { heatVar, confidenceBand } from '@/lib/format';

// Warm→cool order so the stacked bar reads settled (committed) → thin (unsure).
const BANDS: { key: 'settled' | 'leaning' | 'contested' | 'thin'; label: ConfidenceLabel }[] = [
  { key: 'settled', label: 'settled' },
  { key: 'leaning', label: 'leaning' },
  { key: 'contested', label: 'contested' },
  { key: 'thin', label: 'thin' },
];

// A tiny confidence-over-time line (no chart dep — hand-rolled SVG like QuestionMap).
function Sparkline({ points }: { points: { confidence: number }[] }) {
  const w = 132, h = 30, pad = 4;
  const n = points.length;
  const x = (i: number) => pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - 2 * pad));
  const y = (c: number) => pad + (1 - c) * (h - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.confidence).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="confidence over time" style={{ flexShrink: 0 }}>
      <line x1={pad} y1={y(0.5)} x2={w - pad} y2={y(0.5)} stroke="var(--line)" strokeDasharray="2 3" />
      {n > 1 && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.confidence)} r={2.6} fill={heatVar(confidenceBand(p.confidence))} />
      ))}
    </svg>
  );
}

export default function CalibrationView({ data }: { data: CalibrationData }) {
  const { snapshots, trajectories, moves, totals } = data;
  const last = Math.max(0, snapshots.length - 1);
  const [sel, setSel] = useState(last);
  const idx = Math.min(sel, last);
  const cur = snapshots[idx];

  return (
    <div className="flex flex-col gap-2">
      <div className="coordbar" style={{ marginTop: 0 }}>
        <span>{totals.snapshots} snapshots · {totals.moves} moves · {totals.nodesMoved} nodes moved</span>
        {totals.firstAt && (<><span>·</span><span>{totals.firstAt} → {totals.lastAt}</span></>)}
      </div>

      {/* distribution over time — scrub the slider or click a row */}
      <section>
        <div className="section-label">Confidence distribution over time</div>
        {snapshots.length === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
            No snapshots yet. Capture one above, or make a confidence move. Each writes one.
          </p>
        ) : (
          <>
            {cur && (
              <div className="flex items-center flex-wrap gap-2 mb-3 text-xs">
                <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {cur.at} · {cur.total} node{cur.total === 1 ? '' : 's'}
                </span>
                {BANDS.map((b) => cur.bands[b.key] > 0 && (
                  <span key={b.key} style={{ color: heatVar(b.label) }}>· {cur.bands[b.key]} {b.key}</span>
                ))}
              </div>
            )}
            {snapshots.length > 1 && (
              <input
                type="range" min={0} max={last} value={idx}
                onChange={(e) => setSel(Number(e.target.value))}
                className="w-full" style={{ accentColor: 'var(--accent)' }}
                aria-label="Scrub through snapshots"
              />
            )}
            <div className="flex flex-col gap-1.5 mt-3">
              {snapshots.map((s, i) => {
                const total = s.total || 1;
                return (
                  <button
                    key={i} type="button" onClick={() => setSel(i)}
                    className="flex items-center gap-2 text-left"
                    style={{ opacity: i === idx ? 1 : 0.55, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                  >
                    <span style={{ width: 120, fontSize: 10.5, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                      {s.at}
                    </span>
                    <span className="flex flex-1 overflow-hidden" style={{ height: 14, borderRadius: 3, background: 'var(--line)' }}>
                      {BANDS.map((b) => s.bands[b.key] > 0 && (
                        <span key={b.key} style={{ width: `${(s.bands[b.key] / total) * 100}%`, background: heatVar(b.label) }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* per-node trajectories — only things that actually moved */}
      <section>
        <div className="section-label">Confidence trajectories · {trajectories.length} moved</div>
        {trajectories.length === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
            Nothing has moved across snapshots yet. As you commit confidence moves, each node’s path charts here.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {trajectories.map((t) => (
              <div
                key={t.id}
                className="rounded-[var(--radius)] border p-3 flex items-center gap-3 flex-wrap"
                style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
              >
                <Sparkline points={t.points} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Link href={t.href} className="text-sm" style={{ color: 'var(--ink)', fontWeight: 500 }}>
                    {t.code && (
                      <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginRight: 6 }}>{t.code}</span>
                    )}
                    {t.label.length > 90 ? t.label.slice(0, 89) + '…' : t.label}
                  </Link>
                </div>
                <div className="text-xs flex items-center gap-2" style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ color: heatVar(confidenceBand(t.first)) }}>{t.first.toFixed(2)}</span>
                  <span style={{ color: 'var(--faint-ink)' }}>→</span>
                  <span style={{ color: heatVar(confidenceBand(t.current)) }}>{t.current.toFixed(2)}</span>
                  <span style={{ color: 'var(--faint-ink)' }}>· {t.moves} move{t.moves === 1 ? '' : 's'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* movement log — the rationale behind every move */}
      <section>
        <div className="section-label">Movement log</div>
        {moves.length === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 14 }}>
            No confidence moves recorded yet. Every move you commit (with its required rationale) lands here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {moves.map((mv) => (
              <div key={mv.id} className="rationale">
                <div className="flex items-center gap-2 flex-wrap text-xs" style={{ marginBottom: 4 }}>
                  {mv.href ? (
                    <Link href={mv.href} style={{ color: 'var(--accent)' }}>{mv.code ?? mv.label.slice(0, 44)}</Link>
                  ) : (
                    <span>{mv.label.slice(0, 44)}</span>
                  )}
                  <span className="delta">
                    {mv.old_confidence?.toFixed(2) ?? '–'} → {mv.new_confidence?.toFixed(2) ?? '–'}
                  </span>
                  <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>· {mv.at}</span>
                </div>
                <p>{mv.reason}</p>
                {(mv.evidence_excerpt || mv.evidence_source) && (
                  <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 4 }}>
                    cites {mv.evidence_direction ?? ''} evidence
                    {mv.evidence_source ? ` · ${mv.evidence_source}` : ''}
                    {mv.evidence_excerpt ? ` · ${mv.evidence_excerpt}` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
