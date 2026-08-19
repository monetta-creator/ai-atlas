'use client';

import { Fragment, useMemo, useState } from 'react';
import type { PipelineAnalytics, PipelineImpact, RunTriageBreakdown, SignalLens, ViewDataset } from '@/lib/types';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL, signalLensColor, dateLabel, touchHref } from '@/lib/format';
import ViewData from '@/components/ViewData';

// Section 2 — the pipeline operations view. All data is precomputed server-side
// (getPipelineAnalytics); this component only arranges and draws. Charts are hand-rolled
// SVG/CSS (no chart dep), following the Sparkline + stacked-bar patterns used elsewhere.
//
// DEFERRED: per-batch discovery granularity, triage/analysis wall-clock timing, and model
// token cost are not instrumented today. They'd need new columns on pipeline_runs /
// signal_candidates (e.g. batch_index, *_started_at/_ended_at, tokens_in/out). Analysis
// success/failure IS captured (migration 0007: analysis_status), so analysis health below
// is real, not inferred.

// Broadsheet ink-first palette: candidates are the ground (faint ink), published
// signals are the yield (the one accent). Semantic colors (supports/contradicts)
// keep their meaning in the composition charts below.
const CAND_COLOR = 'var(--faint-ink)';
const PUB_COLOR = 'var(--accent)';

function pct(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}
function fmtPct(v: number | null): string {
  return v == null ? '–' : `${Math.round(v * 100)}%`;
}

// A tiny 0..1 trend line (rates over runs). Broadsheet treatment: single ink
// stroke, one accent dot on the latest point (the endpoint is the news).
function MiniSpark({ values }: { values: (number | null)[] }) {
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

function RateCard({
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
function ActivityChart({
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
function StackedBar({ segments, total }: { segments: { v: number; color: string; title?: string }[]; total: number }) {
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
const FUNNEL_LEGEND = [
  { label: 'Published', color: 'var(--supports)' },
  { label: 'Approved · awaiting publish', color: 'var(--accent)' },
  { label: 'Pending review', color: 'var(--ink-faint)' },
  { label: 'Duplicate', color: 'var(--heat-2)' },
  { label: 'Rejected', color: 'var(--contradicts)' },
  { label: 'Archived', color: 'var(--heat-against)' },
];
function funnelSegments(x: { candidates: number; approved: number; pending: number; duplicate: number; publishedC: number; archived: number }) {
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
function FunnelRow({
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

function Legend({ items }: { items: { label: string; color: string }[] }) {
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
function ConcentrationFunnel({ stages }: { stages: { label: string; count: number; color: string }[] }) {
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
function LensRadar({ series }: { series: { lens: SignalLens; published: number; candidates: number }[] }) {
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
function ImpactBars({ impact, publishedSignals }: { impact: PipelineImpact[]; publishedSignals: number }) {
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

export default function PipelineAnalyticsView({ data }: { data: PipelineAnalytics }) {
  const [active, setActive] = useState<SignalLens[]>([]);
  const toggle = (l: SignalLens) =>
    setActive((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  const lensByRun = useMemo(() => {
    const m = new Map<string, { candidates: number; published: number }>();
    for (const r of data.perRunLens) m.set(`${r.run_id}|${r.lens}`, { candidates: r.candidates, published: r.published });
    return m;
  }, [data.perRunLens]);

  const triageByRun = useMemo(() => {
    const m = new Map<string, RunTriageBreakdown>();
    for (const t of data.triage) m.set(t.run_id, t);
    return m;
  }, [data.triage]);

  if (data.runs.length === 0) {
    return (
      <div className="ls-card">
        <p className="ls-empty" style={{ margin: 0 }}>
          No pipeline runs yet. Start one on the <a href="/pipeline" style={{ color: 'var(--accent)' }}>Pipeline</a> page.
          This view fills in as runs complete.
        </p>
      </div>
    );
  }

  // Series for the activity chart (respecting the lens filter).
  const candidates = data.runs.map((r) =>
    active.length ? active.reduce((s, l) => s + (lensByRun.get(`${r.id}|${l}`)?.candidates ?? 0), 0) : r.candidate_count
  );
  const published = data.runs.map((r) =>
    active.length ? active.reduce((s, l) => s + (lensByRun.get(`${r.id}|${l}`)?.published ?? 0), 0) : r.published_count
  );

  // Aggregate conversion rates + per-run trends.
  const sumT = data.triage.reduce(
    (a, t) => ({
      pending: a.pending + t.pending, approved: a.approved + t.approved,
      rejected: a.rejected + t.rejected, duplicate: a.duplicate + t.duplicate, discarded: a.discarded + t.discarded,
    }),
    { pending: 0, approved: 0, rejected: 0, duplicate: 0, discarded: 0 }
  );
  const passedTriage = sumT.approved + sumT.discarded; // discards passed triage, then failed analysis
  const decided = passedTriage + sumT.rejected + sumT.duplicate;
  const completed = data.runs.filter((r) => r.status === 'completed');
  const draftedC = completed.reduce((a, r) => a + r.drafted, 0);
  const discardedC = completed.reduce((a, r) => a + r.discarded, 0);

  const discoveryTrend = data.runs.map((r) => pct(r.published_count, r.candidate_count));
  const triageTrend = data.runs.map((r) => {
    const t = triageByRun.get(r.id);
    if (!t) return null;
    const passed = t.approved + t.discarded;
    const dec = passed + t.rejected + t.duplicate;
    return pct(passed, dec);
  });
  const analysisTrend = data.runs.map((r) =>
    r.status === 'completed' ? pct(r.drafted, r.drafted + r.discarded) : null
  );
  const publishTrend = data.runs.map((r) => pct(r.published_count, r.signal_count));

  // Aggregate the lens partition once. triage_status is mutually exclusive, so these counts are
  // exact and consistent with the funnel-composition card (no double-counting of dedupe-discards,
  // which carry triage_status='rejected' and so are NOT counted as approved).
  const lensAgg = data.lensPerformance.reduce(
    (a, p) => ({
      candidates: a.candidates + p.candidates,
      pending: a.pending + p.pending,
      approved: a.approved + p.approved,
      duplicate: a.duplicate + p.duplicate,
      publishedC: a.publishedC + p.published_candidates,
      archived: a.archived + p.archived,
    }),
    { candidates: 0, pending: 0, approved: 0, duplicate: 0, publishedC: 0, archived: 0 }
  );
  // Concentration funnel — discovered → approved at triage → published. Analysis drafting sits
  // between approval and publish, but every approved candidate currently drafts, so we keep the
  // funnel to the three decision points (and let "Analysis health · by run" cover drafting).
  // Broadsheet ink bars: the firehose is ink, the terminal published stage is the accent.
  const funnelStages = [
    { label: 'Discovered', count: lensAgg.candidates, color: 'var(--ink)' },
    { label: 'Passed triage', count: lensAgg.approved, color: 'var(--ink)' },
    { label: 'Published', count: lensAgg.publishedC, color: 'var(--accent)' },
  ];
  // Lens coverage radar series — published vs discovered, by audience lens.
  const radarSeries = SIGNAL_LENS_SLUGS.map((l) => {
    const p = data.lensPerformance.find((x) => x.lens === l);
    return { lens: l, published: p?.published_candidates ?? 0, candidates: p?.candidates ?? 0 };
  });

  // ---- "View data" datasets — each mirrors EXACTLY what its chart renders (built only from the
  // already-server-stripped props; pipeline analytics are public aggregates, no personal layer). ----
  const pctS = (n: number, d: number) => fmtPct(pct(n, d));
  const SRC = 'AI Atlas discovery pipeline · all runs';
  const compRow = (label: string, x: { candidates: number; approved: number; pending: number; duplicate: number; publishedC: number; archived: number }) => {
    const seg = new Map(funnelSegments(x).map((s) => [s.label, s.v] as const));
    const g = (k: string) => seg.get(k) ?? 0;
    return {
      lens: label, candidates: x.candidates, published: g('Published'),
      approvedAwaiting: g('Approved · awaiting publish'), pending: g('Pending review'),
      duplicate: g('Duplicate'), rejected: g('Rejected'), archived: g('Archived'),
      publishedPct: pctS(g('Published'), x.candidates),
    };
  };
  const dsFunnelComposition: ViewDataset = {
    title: 'Pipeline funnel composition · by lens',
    methodology: "Every discovered candidate, by where it landed. Each lens's six segments sum to its Candidates (a 100% bar). Archived items are set aside and excluded from the other buckets.",
    source: SRC,
    columns: [
      { key: 'lens', label: 'Lens' },
      { key: 'candidates', label: 'Candidates', def: 'All discovered for this lens (incl. archived): the bar denominator.' },
      { key: 'published', label: 'Published', def: 'Approved candidates whose signal is live on the Signal Board.' },
      { key: 'approvedAwaiting', label: 'Approved · awaiting publish', def: 'Approved & drafted, not yet published.' },
      { key: 'pending', label: 'Pending review', def: 'Discovered but not yet triaged.' },
      { key: 'duplicate', label: 'Duplicate', def: 'Flagged as a duplicate of something already tracked.' },
      { key: 'rejected', label: 'Rejected', def: 'Filtered out at triage (incl. dedupe-discards).' },
      { key: 'archived', label: 'Archived', def: 'Set aside out of the active queue (recoverable).' },
      { key: 'publishedPct', label: 'Published %', def: 'Published ÷ Candidates.' },
    ],
    rows: [
      ...SIGNAL_LENS_SLUGS.map((l) => {
        const p = data.lensPerformance.find((x) => x.lens === l);
        return compRow(SIGNAL_LENS_LABEL[l], {
          candidates: p?.candidates ?? 0, approved: p?.approved ?? 0, pending: p?.pending ?? 0,
          duplicate: p?.duplicate ?? 0, publishedC: p?.published_candidates ?? 0, archived: p?.archived ?? 0,
        });
      }),
      compRow('All lenses', lensAgg),
    ],
  };
  const top0 = funnelStages[0]?.count || 0;
  const dsConcentration: ViewDataset = {
    title: 'Concentration funnel · all runs',
    methodology: 'Absolute volume collapsing across pipeline stages: discovered → passed triage → published. "% of discovered" is each stage ÷ the first; "Step pass-through" is each stage ÷ the previous.',
    source: SRC,
    columns: [
      { key: 'stage', label: 'Stage' },
      { key: 'count', label: 'Count' },
      { key: 'ofDiscovered', label: '% of discovered' },
      { key: 'step', label: 'Step pass-through %', def: 'This stage ÷ the previous stage.' },
    ],
    rows: funnelStages.map((s, i) => ({
      stage: s.label, count: s.count, ofDiscovered: pctS(s.count, top0),
      step: i > 0 ? pctS(s.count, funnelStages[i - 1].count) : '–',
    })),
  };
  const radPub = radarSeries.reduce((a, s) => a + s.published, 0);
  const radCand = radarSeries.reduce((a, s) => a + s.candidates, 0);
  const dsRadar: ViewDataset = {
    title: 'Coverage by lens · published vs discovered',
    methodology: 'Distribution of published signals (where the pipeline commits) vs discovered candidates (where it looks) across the six audience lenses, each as a share of its total.',
    source: SRC,
    columns: [
      { key: 'lens', label: 'Lens' },
      { key: 'published', label: 'Published' },
      { key: 'pubShare', label: 'Published share %', def: 'This lens ÷ all published.' },
      { key: 'discovered', label: 'Discovered', def: 'Candidates discovered for this lens.' },
      { key: 'candShare', label: 'Discovered share %', def: 'This lens ÷ all discovered.' },
    ],
    rows: [
      ...radarSeries.map((s) => ({
        lens: SIGNAL_LENS_LABEL[s.lens], published: s.published, pubShare: pctS(s.published, radPub),
        discovered: s.candidates, candShare: pctS(s.candidates, radCand),
      })),
      { lens: 'All lenses', published: radPub, pubShare: '100%', discovered: radCand, candShare: '100%' },
    ],
  };
  const dsImpact: ViewDataset = {
    title: 'From feed to map · most-touched',
    methodology: 'Every argument-map claim/bridge touched by published-signal evidence (the chart shows the top 10), split by direction. One evidence row per signal × target, so the direction counts sum to Signals.',
    source: 'AI Atlas · published signals → evidence',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'target', label: 'Target' },
      { key: 'type', label: 'Type' },
      { key: 'signals', label: 'Signals', def: 'Distinct published signals touching this target.' },
      { key: 'supports', label: 'Supports' },
      { key: 'contradicts', label: 'Contradicts' },
      { key: 'neutral', label: 'Neutral' },
    ],
    rows: data.impact.map((it) => ({
      code: it.code ?? '–', target: it.label, type: it.target_type === 'bridge_claim' ? 'bridge' : 'claim',
      signals: it.signals, supports: it.supports, contradicts: it.contradicts, neutral: it.neutral,
    })),
  };
  const dsLensPerf: ViewDataset = {
    title: 'Lens performance · all runs',
    methodology: "Per-lens rates over all discovered candidates: approval, publish, and rejection. These are independent ratios over the same denominator (they don't sum to 100%). Archived excluded.",
    source: SRC,
    columns: [
      { key: 'lens', label: 'Lens' },
      { key: 'candidates', label: 'Candidates' },
      { key: 'approval', label: 'Approval %', def: 'Approved ÷ candidates.' },
      { key: 'publish', label: 'Publish %', def: 'Published signals ÷ candidates.' },
      { key: 'reject', label: 'Rejection %', def: 'Triage rejects ÷ candidates.' },
    ],
    rows: SIGNAL_LENS_SLUGS.map((l) => {
      const p = data.lensPerformance.find((x) => x.lens === l);
      const cand = p?.candidates ?? 0;
      return {
        lens: SIGNAL_LENS_LABEL[l], candidates: cand,
        approval: pctS(p?.approved ?? 0, cand), publish: pctS(p?.published ?? 0, cand), reject: pctS(p?.rejected ?? 0, cand),
      };
    }),
  };
  const dsTriage: ViewDataset = {
    title: 'Triage funnel · by run',
    methodology: 'Per-run triage outcome. Approved includes candidates approved at triage (incl. those later discarded in analysis). Newest run first. Archived excluded.',
    source: SRC,
    columns: [
      { key: 'run', label: 'Run' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' },
      { key: 'duplicate', label: 'Duplicate' }, { key: 'pending', label: 'Pending' }, { key: 'total', label: 'Total' },
    ],
    rows: data.runs.slice().reverse().map((r) => {
      const t = triageByRun.get(r.id);
      const approved = (t?.approved ?? 0) + (t?.discarded ?? 0);
      const rejected = t?.rejected ?? 0, duplicate = t?.duplicate ?? 0, pending = t?.pending ?? 0;
      return { run: dateLabel(r.triggered_at) ?? '–', approved, rejected, duplicate, pending, total: approved + rejected + duplicate + pending };
    }),
  };
  const dsAnalysis: ViewDataset = {
    title: 'Analysis health · by run',
    methodology: 'Per-run analysis outcome for candidates that passed triage: drafted (a signal was created), discarded (analysis gave up), or in-flight (not yet analyzed). Newest run first.',
    source: SRC,
    columns: [
      { key: 'run', label: 'Run' }, { key: 'drafted', label: 'Drafted' }, { key: 'discarded', label: 'Discarded' },
      { key: 'inflight', label: 'In-flight' }, { key: 'total', label: 'Total' },
    ],
    rows: data.runs.slice().reverse().map((r) => {
      const t = triageByRun.get(r.id);
      const passed = (t?.approved ?? 0) + (t?.discarded ?? 0);
      const inflight = Math.max(0, passed - r.drafted - r.discarded);
      return { run: dateLabel(r.triggered_at) ?? '–', drafted: r.drafted, discarded: r.discarded, inflight, total: r.drafted + r.discarded + inflight };
    }),
  };
  const dsActivity: ViewDataset = {
    title: 'Activity over time',
    methodology: active.length
      ? `Candidates found vs signals published per run, for the selected lens(es): ${active.map((l) => SIGNAL_LENS_LABEL[l]).join(', ')}.`
      : 'Candidates found vs signals published per run, across all lenses.',
    source: SRC,
    columns: [
      { key: 'run', label: 'Run' }, { key: 'candidates', label: 'Candidates' }, { key: 'published', label: 'Published' },
    ],
    rows: data.runs.map((r, i) => ({ run: dateLabel(r.triggered_at) ?? '–', candidates: candidates[i], published: published[i] })),
  };
  const dsConversion: ViewDataset = {
    title: 'Conversion rates · all runs',
    methodology: 'Top-line pipeline conversion rates. Triage pass rate is over decided candidates; analysis conversion is over attempted candidates on completed runs only.',
    source: SRC,
    columns: [
      { key: 'metric', label: 'Metric' }, { key: 'rate', label: 'Rate' }, { key: 'counts', label: 'Counts' },
    ],
    rows: [
      { metric: 'Discovery → Signal', rate: pctS(data.totals.published, data.totals.candidates), counts: `${data.totals.published} of ${data.totals.candidates} discovered` },
      { metric: 'Triage pass rate', rate: pctS(passedTriage, decided), counts: `${passedTriage} of ${decided} decided` },
      { metric: 'Analysis conversion', rate: pctS(draftedC, draftedC + discardedC), counts: `${draftedC} of ${draftedC + discardedC} attempted (completed runs)` },
      { metric: 'Draft → Published', rate: pctS(data.totals.published, data.totals.drafted), counts: `${data.totals.published} of ${data.totals.drafted} drafted` },
    ],
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {/* Conversion rates */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="section-label" style={{ margin: 0 }}>Conversion rates · all runs</div>
        <ViewData dataset={dsConversion} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--gap)' }}>
        <RateCard
          label="Discovery → Signal"
          value={fmtPct(pct(data.totals.published, data.totals.candidates))}
          sub={`${data.totals.published} published of ${data.totals.candidates} discovered`}
          trend={discoveryTrend}
        />
        <RateCard
          label="Triage pass rate"
          value={fmtPct(pct(passedTriage, decided))}
          sub={`${passedTriage} approved of ${decided} decided`}
          trend={triageTrend}
        />
        <RateCard
          label="Analysis conversion"
          value={fmtPct(pct(draftedC, draftedC + discardedC))}
          sub={`${draftedC} drafted of ${draftedC + discardedC} attempted · completed runs`}
          trend={analysisTrend}
        />
        <RateCard
          label="Draft → Published"
          value={fmtPct(pct(data.totals.published, data.totals.drafted))}
          sub={`${data.totals.published} published of ${data.totals.drafted} drafted`}
          trend={publishTrend}
        />
      </div>

      {/* Idea 1 — concentration funnel: the firehose collapsing to a few published signals. */}
      <div className="ls-card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="section-label" style={{ marginTop: 0 }}>Concentration funnel · all runs</div>
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>
              <strong style={{ color: 'var(--supports)', fontFamily: 'var(--font-mono)' }}>{fmtPct(pct(lensAgg.publishedC, lensAgg.candidates))}</strong>
              {' '}surfaced · {lensAgg.candidates - lensAgg.publishedC} filtered · 100% human-gated
            </span>
            <ViewData dataset={dsConcentration} />
          </div>
        </div>
        <div className="bs-chart-title">The Firehose, Filtered</div>
        <div className="bs-chart-sub">
          [ {lensAgg.candidates} candidates discovered → {lensAgg.publishedC} signals published · bar width is share of all discovered ]
        </div>
        <ConcentrationFunnel stages={funnelStages} />
      </div>

      {/* Activity over time */}
      <div className="ls-card">
        <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 10 }}>
          <div className="section-label" style={{ margin: 0 }}>Activity over time</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Legend items={[{ label: 'Candidates found', color: CAND_COLOR }, { label: 'Signals published', color: PUB_COLOR }]} />
            <ViewData dataset={dsActivity} />
          </div>
        </div>
        <div className="lens-chip-row" style={{ marginBottom: 12 }}>
          {SIGNAL_LENS_SLUGS.map((l) => {
            const on = active.includes(l);
            const color = signalLensColor(l);
            return (
              <button
                key={l}
                type="button"
                className="lenschip"
                data-on={on ? '' : undefined}
                onClick={() => toggle(l)}
                style={on ? { color, borderColor: `color-mix(in oklab, ${color} 45%, var(--line))`, background: `color-mix(in oklab, ${color} 12%, var(--surface))` } : undefined}
              >
                {SIGNAL_LENS_LABEL[l]}
              </button>
            );
          })}
          {active.length > 0 && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setActive([])}>All lenses</button>
          )}
        </div>
        <ActivityChart runs={data.runs} candidates={candidates} published={published} />
      </div>

      {/* Triage funnel + Analysis health side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--gap)' }}>
        <div className="ls-card">
          <div className="flex items-center justify-between gap-2">
            <div className="section-label" style={{ marginTop: 0 }}>Triage funnel · by run</div>
            <ViewData dataset={dsTriage} />
          </div>
          <Legend items={[
            { label: 'Approved', color: 'var(--supports)' },
            { label: 'Rejected', color: 'var(--contradicts)' },
            { label: 'Duplicate', color: 'var(--heat-2)' },
            { label: 'Pending', color: 'var(--line)' },
          ]} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {data.runs.slice().reverse().map((r) => {
              const t = triageByRun.get(r.id);
              const approved = (t?.approved ?? 0) + (t?.discarded ?? 0);
              const rejected = t?.rejected ?? 0;
              const duplicate = t?.duplicate ?? 0;
              const pending = t?.pending ?? 0;
              const total = approved + rejected + duplicate + pending;
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span style={{ width: 86, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', flexShrink: 0 }}>
                    {dateLabel(r.triggered_at)}
                  </span>
                  <StackedBar
                    total={total}
                    segments={[
                      { v: approved, color: 'var(--supports)' },
                      { v: rejected, color: 'var(--contradicts)' },
                      { v: duplicate, color: 'var(--heat-2)' },
                      { v: pending, color: 'var(--line)' },
                    ]}
                  />
                  <span style={{ width: 30, textAlign: 'right', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{total}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ls-card">
          <div className="flex items-center justify-between gap-2">
            <div className="section-label" style={{ marginTop: 0 }}>Analysis health · by run</div>
            <ViewData dataset={dsAnalysis} />
          </div>
          <Legend items={[
            { label: 'Drafted', color: 'var(--supports)' },
            { label: 'Discarded', color: 'var(--heat-against)' },
            { label: 'In-flight', color: 'var(--line)' },
          ]} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {data.runs.slice().reverse().map((r) => {
              const t = triageByRun.get(r.id);
              const passed = (t?.approved ?? 0) + (t?.discarded ?? 0);
              const drafted = r.drafted;
              const discarded = r.discarded;
              const inflight = Math.max(0, passed - drafted - discarded);
              const total = drafted + discarded + inflight;
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span style={{ width: 86, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', flexShrink: 0 }}>
                    {dateLabel(r.triggered_at)}
                  </span>
                  <StackedBar
                    total={total}
                    segments={[
                      { v: drafted, color: 'var(--supports)' },
                      { v: discarded, color: 'var(--heat-against)' },
                      { v: inflight, color: 'var(--line)' },
                    ]}
                  />
                  <span style={{ width: 30, textAlign: 'right', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{total}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Funnel composition — every candidate partitioned into where it landed (sums to 100%). */}
      <div className="ls-card">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="section-label" style={{ marginTop: 0 }}>Pipeline funnel composition · by lens</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Legend items={FUNNEL_LEGEND} />
            <ViewData dataset={dsFunnelComposition} />
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--dim)', margin: '4px 0 6px' }}>
          Every discovered candidate, by where it landed. Each bar is 100% of that lens&apos;s candidates: input
          (<span style={{ fontFamily: 'var(--font-mono)' }}>Cand.</span>) on the left, published yield on the right.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
          <div className="flex items-center gap-2" style={{ fontSize: 10, color: 'var(--faint-ink)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0 2px' }}>
            <span style={{ width: 150, flexShrink: 0 }}>Lens</span>
            <span style={{ width: 44, textAlign: 'right', flexShrink: 0 }}>Cand.</span>
            <span style={{ flex: 1 }}>Composition</span>
            <span style={{ width: 70, textAlign: 'right', flexShrink: 0 }}>Published</span>
          </div>
          {SIGNAL_LENS_SLUGS.map((l) => {
            const p = data.lensPerformance.find((x) => x.lens === l);
            const cand = p?.candidates ?? 0;
            const publishedC = p?.published_candidates ?? 0;
            const segs = funnelSegments({
              candidates: cand, approved: p?.approved ?? 0, pending: p?.pending ?? 0,
              duplicate: p?.duplicate ?? 0, publishedC, archived: p?.archived ?? 0,
            });
            return (
              <FunnelRow
                key={l}
                label={SIGNAL_LENS_LABEL[l]}
                color={signalLensColor(l)}
                candidates={cand}
                segments={segs}
                publishedC={publishedC}
              />
            );
          })}
          <FunnelRow
            label="All lenses"
            candidates={lensAgg.candidates}
            segments={funnelSegments(lensAgg)}
            publishedC={lensAgg.publishedC}
            emphasis
          />
        </div>
      </div>

      {/* Lens performance */}
      <div className="ls-card">
        <div className="flex items-center justify-between gap-2">
          <div className="section-label" style={{ marginTop: 0 }}>Lens performance · all runs</div>
          <ViewData dataset={dsLensPerf} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          <div className="flex items-center gap-2" style={{ fontSize: 10, color: 'var(--faint-ink)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0 0 6px' }}>
            <span style={{ width: 150, flexShrink: 0 }}>Lens</span>
            <span style={{ width: 56, textAlign: 'right', flexShrink: 0 }}>Cand.</span>
            <span style={{ flex: 1 }}>Approval · publish · rejection rate</span>
          </div>
          {SIGNAL_LENS_SLUGS.map((l) => {
            const p = data.lensPerformance.find((x) => x.lens === l);
            const cand = p?.candidates ?? 0;
            const approval = pct(p?.approved ?? 0, cand) ?? 0;
            const publish = pct(p?.published ?? 0, cand) ?? 0;
            const reject = pct(p?.rejected ?? 0, cand) ?? 0;
            const color = signalLensColor(l);
            return (
              <div key={l} className="flex items-center gap-2" style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                <span className="flex items-center gap-2" style={{ width: 150, flexShrink: 0, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                  {SIGNAL_LENS_LABEL[l]}
                </span>
                <span style={{ width: 56, textAlign: 'right', flexShrink: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: cand ? 'var(--ink)' : 'var(--faint-ink)' }}>{cand}</span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <RateBar value={approval} color={color} title={`Approval ${fmtPct(approval)}`} />
                  <RateBar value={publish} color="var(--supports)" title={`Published ${fmtPct(publish)}`} />
                  <RateBar value={reject} color="var(--contradicts)" title={`Rejection ${fmtPct(reject)}`} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* The value pair: breadth of coverage (radar) + downstream map impact (ranked). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--gap)' }}>
        {/* Bonus — lens coverage radar */}
        <div className="ls-card">
          <div className="flex items-center justify-between gap-2">
            <div className="section-label" style={{ marginTop: 0 }}>Coverage by lens · published vs discovered</div>
            <ViewData dataset={dsRadar} />
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--dim)', margin: '4px 0 2px' }}>
            Where the pipeline commits (published share, filled) against where it looks (discovered share, dashed):
            balanced coverage across the whole debate, not just markets.
          </p>
          <LensRadar series={radarSeries} />
          <div style={{ marginTop: 6 }}>
            <Legend items={[{ label: 'Published share', color: 'var(--supports)' }, { label: 'Discovered share', color: 'var(--accent)' }]} />
          </div>
        </div>

        {/* Idea 2 — from feed to map */}
        <div className="ls-card">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="section-label" style={{ marginTop: 0 }}>From feed to map · most-touched</div>
            <div className="flex items-center gap-3 flex-wrap">
              <Legend items={[
                { label: 'Supports', color: 'var(--supports)' },
                { label: 'Contradicts', color: 'var(--contradicts)' },
                { label: 'Neutral', color: 'var(--heat-against)' },
              ]} />
              <ViewData dataset={dsImpact} />
            </div>
          </div>
          <ImpactBars impact={data.impact} publishedSignals={data.totals.published} />
        </div>
      </div>
    </div>
  );
}

function RateBar({ value, color, title }: { value: number; color: string; title: string }) {
  return (
    <span title={title} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.round(Math.min(1, value) * 100)}%`, background: color }} />
      </span>
      <span style={{ width: 34, textAlign: 'right', fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--dim)' }}>{fmtPct(value)}</span>
    </span>
  );
}
