'use client';

import { useMemo, useState } from 'react';
import type { PipelineAnalytics, RunTriageBreakdown, SignalLens, ViewDataset } from '@/lib/types';
import { SIGNAL_LENS_SLUGS, SIGNAL_LENS_LABEL, signalLensColor, dateLabel } from '@/lib/format';
import ViewData from '@/components/ViewData';
import {
  CAND_COLOR, PUB_COLOR, FUNNEL_LEGEND, pct, fmtPct, funnelSegments,
  RateCard, ActivityChart, StackedBar, FunnelRow, Legend, ConcentrationFunnel, LensRadar, ImpactBars, RateBar,
} from './pipeline-charts';

// Section 2 — the pipeline operations view. All data is precomputed server-side
// (getPipelineAnalytics); this component only arranges and draws. Charts are hand-rolled
// SVG/CSS (no chart dep), following the Sparkline + stacked-bar patterns used elsewhere.
//
// DEFERRED: per-batch discovery granularity, triage/analysis wall-clock timing, and model
// token cost are not instrumented today. They'd need new columns on pipeline_runs /
// signal_candidates (e.g. batch_index, *_started_at/_ended_at, tokens_in/out). Analysis
// success/failure IS captured (migration 0007: analysis_status), so analysis health below
// is real, not inferred.

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

