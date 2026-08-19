'use client';

import { Fragment } from 'react';
import type { PipelineImpact, SignalLens } from '@/lib/types';
import { signalLensColor, dateLabel, touchHref } from '@/lib/format';

// The pipeline dashboard's hand-rolled chart primitives (no chart dep), split out
// of PipelineAnalytics.tsx so the view file holds only arrangement. Palette rule:
// candidates are the ground (faint ink), published signals are the yield (accent);
// semantic colors (supports/contradicts) keep their meaning in compositions.
export const CAND_COLOR = 'var(--faint-ink)';
export const PUB_COLOR = 'var(--accent)';

export function pct(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
export function fmtPct(v: number | null): string {
  return v == null ? '–' : `${Math.round(v * 100)}%`;
}

// A tiny 0..1 trend line (rates over runs). Broadsheet treatment: single ink
// stroke, one accent dot on the latest point (the endpoint is the news).
export function MiniSpark({ values }: { values: (number | null)[] }) {
  const pts = values.filter((v): v is number => v != null);
  const w = 96, h = 26, pad = 3;
  const n = pts.length;
  if (n === 0) return <svg width={w} height={h} aria-hidden="true" />;
  const x = (i: number) => pad + (n <= 1 ? (w - 2 * pad) / 2 : (i / (n - 1)) * (w - 2 * pad));
  const y = (v: number) => pad + (1 - v) * (h - 2 * pad);
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label="trend" style={{ flexShrink: 0 }}>
      <line x1={pad} y1={y(0.5)} x2={w - pad} y2={y(0.5)} stroke="var(--line)" strokeDasharray="2 3" />
      {n > 1 && <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.4} opacity={0.72} strokeLinejoin="round" />}
      <circle cx={x(n - 1)} cy={y(pts[n - 1])} r={2.6} fill="var(--accent)" />
    </svg>
  );
}

export function RateCard({
  label, value, sub, trend,
}: { label: string; value: string; sub: string; trend: (number | null)[] }) {
  return (
    <div className="ls-card" style={{ padding: '15px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10.5, color: 'var(--faint-ink)', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: 'var(--font-mono)' }}>{label}</div>
      <div className="flex items-end justify-between gap-2">
        <span className="bs-pct">{value}</span>
        <MiniSpark values={trend} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--dim)' }}>{sub}</div>
    </div>
  );
}

// The multi-series activity chart: candidates vs published per run, over time.
export function ActivityChart({
  runs, candidates, published,
}: { runs: { id: string; triggered_at: string }[]; candidates: number[]; published: number[] }) {
  const W = 720, H = 200, padL = 30, padR = 12, padT = 14, padB = 26;
  const n = runs.length;
  const max = Math.max(1, ...candidates, ...published);
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  // Sparse x labels: first, middle, last.
  const labelIdx = n <= 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="candidates vs published per run" style={{ display: 'block' }}>
      {/* y gridlines at 0, max/2, max */}
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} y1={y(max * f)} x2={W - padR} y2={y(max * f)} stroke="var(--line)" strokeDasharray={f === 0 ? undefined : '2 3'} />
          <text x={padL - 5} y={y(max * f) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {n > 1 && <path d={path(candidates)} fill="none" stroke={CAND_COLOR} strokeWidth={2} strokeLinejoin="round" />}
      {n > 1 && <path d={path(published)} fill="none" stroke={PUB_COLOR} strokeWidth={2} strokeLinejoin="round" />}
      {candidates.map((v, i) => <circle key={`c${i}`} cx={x(i)} cy={y(v)} r={2.6} fill={CAND_COLOR} />)}
      {published.map((v, i) => <circle key={`p${i}`} cx={x(i)} cy={y(v)} r={2.6} fill={PUB_COLOR} />)}
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">
          {dateLabel(runs[i].triggered_at)}
        </text>
      ))}
    </svg>
  );
}

// One horizontal stacked bar: segments are [value, color] pairs (optional hover title).
export function StackedBar({ segments, total }: { segments: { v: number; color: string; title?: string }[]; total: number }) {
  const t = total || 1;
  return (
    <span style={{ display: 'flex', flex: 1, height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--line)', minWidth: 80 }}>
      {segments.map((s, i) => s.v > 0 && (
        <span key={i} title={s.title} style={{ width: `${(s.v / t) * 100}%`, background: s.color }} />
      ))}
    </span>
  );
}

// The deck-ready funnel composition: every candidate partitioned into where it landed.
// triage_status is mutually exclusive (pending+approved+rejected+duplicate = candidates),
// and 'approved' is sub-split into published vs awaiting-publish — so the segments sum to
// candidates EXACTLY (each bar is a true 100% of that lens's discovered candidates).
export const FUNNEL_LEGEND = [
  { label: 'Published', color: 'var(--supports)' },
  { label: 'Approved · awaiting publish', color: 'var(--accent)' },
  { label: 'Pending review', color: 'var(--ink-faint)' },
  { label: 'Duplicate', color: 'var(--heat-2)' },
  { label: 'Rejected', color: 'var(--contradicts)' },
  { label: 'Archived', color: 'var(--heat-against)' },
];
export function funnelSegments(x: { candidates: number; approved: number; pending: number; duplicate: number; publishedC: number; archived: number }) {
  const published = Math.min(x.publishedC, x.approved);
  const approvedActive = Math.max(0, x.approved - published); // approved → drafted, not yet published
  // Rejected = residual. The query's pending/approved/duplicate/archived all EXCLUDE archived
  // candidates, and candidates includes them, so this residual resolves to triage-rejected (incl.
  // dedupe-discards) minus archived — and the six segments sum to candidates EXACTLY:
  // published + approvedActive + pending + duplicate + rejected + archived = candidates.
  const rejected = Math.max(0, x.candidates - x.pending - x.approved - x.duplicate - x.archived);
  return [
    { v: published, color: 'var(--supports)', label: 'Published' },
    { v: approvedActive, color: 'var(--accent)', label: 'Approved · awaiting publish' },
    { v: x.pending, color: 'var(--ink-faint)', label: 'Pending review' },
    { v: x.duplicate, color: 'var(--heat-2)', label: 'Duplicate' },
    { v: rejected, color: 'var(--contradicts)', label: 'Rejected' },
    { v: x.archived, color: 'var(--heat-against)', label: 'Archived' },
  ];
}
// One composition row: label + candidate count + 100% stacked bar + published yield.
export function FunnelRow({
  label, color, candidates, segments, publishedC, emphasis,
}: {
  label: string; color?: string; candidates: number;
  segments: { v: number; color: string; label: string }[]; publishedC: number; emphasis?: boolean;
}) {
  const rowStyle = emphasis
    ? { borderTop: '2px solid var(--ink-faint)', padding: '9px 0 2px', marginTop: 2 }
    : { borderTop: '1px solid var(--line)', padding: '8px 0' };
  const weight = emphasis ? 600 : 400;
  return (
    <div className="flex items-center gap-2" style={rowStyle}>
      <span className="flex items-center gap-2" style={{ width: 150, flexShrink: 0, fontSize: 12.5, fontWeight: weight }}>
        {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />}
        {label}
      </span>
      <span style={{ width: 44, textAlign: 'right', flexShrink: 0, fontSize: 12, fontWeight: weight, fontFamily: 'var(--font-mono)', color: candidates ? 'var(--ink)' : 'var(--faint-ink)' }}>{candidates}</span>
      <StackedBar total={candidates} segments={segments.map((s) => ({ v: s.v, color: s.color, title: `${s.label} · ${s.v} (${fmtPct(pct(s.v, candidates))})` }))} />
      <span style={{ width: 70, textAlign: 'right', flexShrink: 0, fontSize: 12, fontWeight: weight, fontFamily: 'var(--font-mono)' }}>
        <span style={{ color: 'var(--supports)' }}>{publishedC}</span>
        <span style={{ color: 'var(--faint-ink)' }}> · {fmtPct(pct(publishedC, candidates))}</span>
      </span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-3 flex-wrap" style={{ fontSize: 11, color: 'var(--dim)' }}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 2, background: it.color, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Idea 1 — the concentration funnel: absolute volume collapsing across pipeline stages.
// Centered, tapering bars make the "firehose → a few published" selectivity legible at a glance.
export function ConcentrationFunnel({ stages }: { stages: { label: string; count: number; color: string }[] }) {
  const top = stages[0]?.count || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 12 }}>
      {stages.map((s, i) => {
        const widthPct = Math.max(3, (s.count / top) * 100);
        const stepPct = i > 0 ? pct(s.count, stages[i - 1].count) : null;
        return (
          <Fragment key={s.label}>
            {i > 0 && (
              <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', padding: '3px 0' }}>
                ↓ {fmtPct(stepPct)}
              </div>
            )}
            <div className="flex items-center gap-2">
              <span style={{ width: 110, flexShrink: 0, textAlign: 'right', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--dim)' }}>{s.label}</span>
              <span style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                <span style={{ width: `${widthPct}%`, minWidth: 46, height: 30, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg)', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>
                  {s.count}
                </span>
              </span>
              <span style={{ width: 48, flexShrink: 0, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{fmtPct(pct(s.count, top))}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

const LENS_SHORT: Record<SignalLens, string> = {
  market: 'Market', labor: 'Labor', geopolitics: 'Geopolitics',
  regulatory: 'Regulatory', capability: 'Capability', society: 'Society',
};

// Bonus — lens coverage radar: published-signal distribution across the six audience lenses
// (filled), with discovered-candidate distribution overlaid (dashed outline). Both plotted as
// share-of-total, so "where it commits" vs "where it looks" sit on a comparable scale.
export function LensRadar({ series }: { series: { lens: SignalLens; published: number; candidates: number }[] }) {
  const N = series.length;
  const S = 300, cx = S / 2, cy = S / 2, R = 90;
  const pubTotal = series.reduce((a, s) => a + s.published, 0) || 1;
  const candTotal = series.reduce((a, s) => a + s.candidates, 0) || 1;
  const shares = series.map((s) => ({ pub: s.published / pubTotal, cand: s.candidates / candTotal }));
  const maxShare = Math.max(0.0001, ...shares.flatMap((s) => [s.pub, s.cand]));
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const xy = (i: number, r: number): [number, number] => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const ring = (frac: number) =>
    series.map((_, i) => { const [x, y] = xy(i, R * frac); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ') + 'Z';
  const poly = (key: 'pub' | 'cand') =>
    shares.map((sh, i) => { const [x, y] = xy(i, R * (sh[key] / maxShare)); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ') + 'Z';

  return (
    <svg viewBox={`0 0 ${S} ${S}`} width="100%" style={{ maxWidth: 300, display: 'block', margin: '4px auto 0', overflow: 'visible' }} role="img" aria-label="published vs discovered signal distribution by lens">
      {[0.25, 0.5, 0.75, 1].map((f) => <path key={f} d={ring(f)} fill="none" stroke="var(--line)" />)}
      {series.map((_, i) => { const [x, y] = xy(i, R); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" />; })}
      <path d={poly('cand')} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 3" opacity={0.75} />
      <path d={poly('pub')} fill="var(--supports)" fillOpacity={0.16} stroke="var(--supports)" strokeWidth={2} strokeLinejoin="round" />
      {shares.map((sh, i) => { const [x, y] = xy(i, R * (sh.pub / maxShare)); return <circle key={i} cx={x} cy={y} r={2.6} fill="var(--supports)" />; })}
      {series.map((s, i) => {
        const [lx, ly] = xy(i, R + 16);
        const anchor = lx > cx + 4 ? 'start' : lx < cx - 4 ? 'end' : 'middle';
        return (
          <g key={`l${i}`}>
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize="10.5" fontWeight={600} fill={signalLensColor(s.lens)}>{LENS_SHORT[s.lens] ?? s.lens}</text>
            <text x={lx} y={ly + 12} textAnchor={anchor} dominantBaseline="middle" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--faint-ink)">{s.published}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Idea 2 — from feed to map: which argument-map targets the published signals actually
// touched, ranked, each split by direction. Bar length = signals touching; color = supports
// (green) / contradicts (red) / neutral (gray). This is the pipeline's downstream payoff.
export function ImpactBars({ impact, publishedSignals }: { impact: PipelineImpact[]; publishedSignals: number }) {
  if (impact.length === 0) {
    return <p className="ls-empty" style={{ margin: '8px 0 0' }}>No published signals have touched the map yet.</p>;
  }
  const top = impact.slice(0, 10);
  const maxSignals = Math.max(1, ...impact.map((i) => i.signals));
  const contested = impact.filter((i) => i.supports > 0 && i.contradicts > 0).length;
  return (
    <div>
      <p style={{ fontSize: 11.5, color: 'var(--dim)', margin: '4px 0 10px' }}>
        {publishedSignals} published signals have kept <strong>{impact.length}</strong> claims &amp; bridges current
        {contested > 0 ? <>: <strong>{contested}</strong> now carry evidence on both sides (supporting and contradicting)</> : null}.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {top.map((it) => {
          const total = it.signals || 1;
          const lenPct = (it.signals / maxSignals) * 100;
          const seg = (v: number) => `${(v / total) * 100}%`;
          const row = (
            <div className="flex items-center gap-2" style={{ borderTop: '1px solid var(--line)', padding: '7px 0' }}>
              <span style={{ width: 48, flexShrink: 0, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{it.code || '–'}</span>
              <span style={{ flex: '2 1 0', minWidth: 0, fontSize: 12, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={it.label}>{it.label}</span>
              <span style={{ flex: '1.3 1 0', display: 'flex', alignItems: 'center', gap: 8, minWidth: 96 }}>
                <span style={{ flex: 1, height: 12, background: 'var(--line)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                  <span style={{ width: `${lenPct}%`, height: '100%', display: 'flex', minWidth: 3 }}>
                    {it.supports > 0 && <span style={{ width: seg(it.supports), background: 'var(--supports)' }} title={`${it.supports} supporting`} />}
                    {it.contradicts > 0 && <span style={{ width: seg(it.contradicts), background: 'var(--contradicts)' }} title={`${it.contradicts} contradicting`} />}
                    {it.neutral > 0 && <span style={{ width: seg(it.neutral), background: 'var(--heat-against)' }} title={`${it.neutral} neutral`} />}
                  </span>
                </span>
                <span style={{ width: 20, textAlign: 'right', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{it.signals}</span>
              </span>
            </div>
          );
          return it.code
            ? <a key={it.target_id} href={touchHref(it.code)} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>{row}</a>
            : <div key={it.target_id}>{row}</div>;
        })}
      </div>
      {impact.length > top.length && (
        <p style={{ fontSize: 10.5, color: 'var(--faint-ink)', margin: '8px 0 0', fontFamily: 'var(--font-mono)' }}>+{impact.length - top.length} more touched</p>
      )}
    </div>
  );
}

export function RateBar({ value, color, title }: { value: number; color: string; title: string }) {
  return (
    <span title={title} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
      </span>
      <span style={{ width: 34, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{fmtPct(value)}</span>
    </span>
  );
}
