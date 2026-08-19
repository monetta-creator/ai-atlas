'use client';

import { useState } from 'react';
import type { CostDashboard, DailyCostPoint, ViewDataset } from '@/lib/types';
import { featureLabel, dateLabel } from '@/lib/format';
import ViewData from '@/components/ViewData';
import RateCardForm, { type RateCardDefaults } from '@/components/RateCardForm';

// The AI cost console (/costs, admin-only). All figures arrive precomputed from
// getCostDashboard(); this only arranges and draws. Costs are FROZEN at call time (read off
// cost_usd), never recomputed. Hand-rolled SVG/CSS, no chart dependency — matching the
// PipelineAnalytics + Landscape dashboards. The cost numbers below are token-priced from the
// active rate card (web-search request fees aren't in the rate card, so they're not included).

// Adaptive USD formatting: thousands-separated dollars; more decimals as values shrink to
// the sub-cent per-call range.
function usd(n: number): string {
  const a = Math.abs(n);
  if (a === 0) return '$0';
  if (a >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 0.01) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}
function compact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}
const pct1 = (n: number | null): string => (n == null ? '–' : `${n.toFixed(1)}%`);
function wall(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Format a Postgres timestamptz::text ("YYYY-MM-DD HH:MM:SS+00") deterministically (UTC) —
// no Date/locale, so server and client render identically (no hydration drift).
function logTime(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso.slice(0, 16);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[4]}:${m[5]}`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="ls-card" style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ fontSize: 10.5, color: 'var(--faint-ink)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
      <span style={{ fontSize: 26, fontWeight: 600, lineHeight: 1, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <div style={{ fontSize: 11, color: 'var(--dim)' }}>{sub}</div>
    </div>
  );
}

// Daily spend, last 30 days: bars (daily cost, incl. zero days) + the 7- and 30-day trailing
// rolling means as overlaid lines.
function DailyChart({ daily }: { daily: DailyCostPoint[] }) {
  const W = 760, H = 210, padL = 46, padR = 12, padT = 12, padB = 28;
  const n = daily.length;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1e-9, ...daily.map((d) => d.cost), ...daily.map((d) => d.avg7), ...daily.map((d) => d.avg30));
  const slot = n > 0 ? innerW / n : innerW;
  const bw = Math.max(2, slot * 0.66);
  const xc = (i: number) => padL + (i + 0.5) * slot;
  const y = (v: number) => padT + (1 - v / max) * innerH;
  const linePath = (key: 'avg7' | 'avg30') =>
    daily.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xc(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join(' ');
  const labelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="daily AI spend, last 30 days" style={{ display: 'block' }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} y1={y(max * f)} x2={W - padR} y2={y(max * f)} stroke="var(--line)" strokeDasharray={f === 0 ? undefined : '2 3'} />
          <text x={padL - 6} y={y(max * f) + 3} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">{usd(max * f)}</text>
        </g>
      ))}
      {daily.map((d, i) => (
        <rect key={d.day} x={xc(i) - bw / 2} y={y(d.cost)} width={bw} height={Math.max(0, y(0) - y(d.cost))} rx={1} fill="var(--accent)" opacity={0.5}>
          <title>{`${d.day}: ${usd(d.cost)} · ${d.calls} call${d.calls === 1 ? '' : 's'}`}</title>
        </rect>
      ))}
      {n > 1 && <path d={linePath('avg7')} fill="none" stroke="var(--heat-3)" strokeWidth={1.6} strokeLinejoin="round" />}
      {n > 1 && <path d={linePath('avg30')} fill="none" stroke="var(--supports)" strokeWidth={1.6} strokeLinejoin="round" />}
      {labelIdx.map((i) => (
        <text key={i} x={xc(i)} y={H - 9} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--faint-ink)">{daily[i].day.slice(5)}</text>
      ))}
    </svg>
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

export default function CostsDashboard({ data }: { data: CostDashboard }) {
  const [showAll, setShowAll] = useState(false);
  const { summary, daily, features, runs, recent, activeRateCards, rateCardHistory } = data;

  const shown = showAll ? recent : recent.slice(0, 50);
  const SRC = 'AI Atlas · ai_cost_log (cost frozen at call time)';

  const def = activeRateCards.find((c) => c.model === 'claude-sonnet-4-6') ?? activeRateCards[0];
  const formDefaults: RateCardDefaults | undefined = def
    ? {
        model: def.model, input: def.input_per_mtok, output: def.output_per_mtok,
        cacheWrite: def.cache_write_per_mtok, cacheRead: def.cache_read_per_mtok, contextWindow: def.context_window,
      }
    : undefined;

  // ---- "View data" datasets (mirror exactly what each chart/table renders) ----
  const dsDaily: ViewDataset = {
    title: 'Daily AI spend · last 30 days',
    methodology: 'Total spend per calendar day (UTC), zero-filled, with trailing 7- and 30-day rolling mean daily spend.',
    source: SRC,
    columns: [
      { key: 'day', label: 'Day' },
      { key: 'cost', label: 'Spend' },
      { key: 'calls', label: 'Calls' },
      { key: 'avg7', label: '7-day avg', def: 'Trailing 7-day mean daily spend.' },
      { key: 'avg30', label: '30-day avg', def: 'Trailing 30-day mean daily spend.' },
    ],
    rows: daily.map((d) => ({ day: d.day, cost: usd(d.cost), calls: d.calls, avg7: usd(d.avg7), avg30: usd(d.avg30) })),
  };
  const dsFeatures: ViewDataset = {
    title: 'Cost by feature',
    methodology: 'Per-feature rollup over all logged calls. Percentiles are over that feature’s per-call cost; averages are per call.',
    source: SRC,
    columns: [
      { key: 'feature', label: 'Feature' },
      { key: 'calls', label: 'Calls' },
      { key: 'total', label: 'Total cost' },
      { key: 'avgTokens', label: 'Avg tokens', def: 'Mean total tokens (input + output + cache) per call.' },
      { key: 'avgInput', label: 'Avg input' },
      { key: 'avgOutput', label: 'Avg output' },
      { key: 'avgCtx', label: 'Avg ctx %', def: 'Mean context-window utilization.' },
      { key: 'p50', label: 'p50 cost' },
      { key: 'p90', label: 'p90 cost' },
      { key: 'p99', label: 'p99 cost' },
    ],
    rows: features.map((f) => ({
      feature: featureLabel(f.feature), calls: f.calls, total: usd(f.totalCost),
      avgTokens: Math.round(f.avgTokens), avgInput: Math.round(f.avgInput), avgOutput: Math.round(f.avgOutput),
      avgCtx: pct1(f.avgContextPct), p50: usd(f.p50), p90: usd(f.p90), p99: usd(f.p99),
    })),
  };
  const dsRuns: ViewDataset = {
    title: 'Cost by pipeline run · last 20',
    methodology: 'Total spend, calls, and tokens attributed to each discovery run (calls logged with that run’s id). A pre-instrumentation run shows 0.',
    source: SRC,
    columns: [
      { key: 'run', label: 'Run' },
      { key: 'cadence', label: 'Cadence' },
      { key: 'status', label: 'Status' },
      { key: 'calls', label: 'Calls' },
      { key: 'tokens', label: 'Tokens' },
      { key: 'cost', label: 'Cost' },
    ],
    rows: runs.map((r) => ({
      run: dateLabel(r.triggered_at) ?? '–', cadence: r.cadence, status: r.status,
      calls: r.calls, tokens: r.tokens, cost: usd(r.cost),
    })),
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--gap)' }}>
        <StatCard label="Spend · all time" value={usd(summary.total)} sub={`${summary.calls.toLocaleString()} calls`} />
        <StatCard label="Last 30 days" value={usd(summary.d30)} sub={`${summary.calls30.toLocaleString()} calls`} />
        <StatCard label="Last 7 days" value={usd(summary.d7)} sub={`${summary.calls7.toLocaleString()} calls`} />
        <StatCard label="Total calls" value={summary.calls.toLocaleString()} sub="all features" />
        <StatCard label="Avg / call" value={usd(summary.avgCost)} sub="all time" />
      </div>

      {/* Daily spend chart */}
      <div className="ls-card">
        <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 10 }}>
          <div className="section-label" style={{ margin: 0 }}>Daily spend · last 30 days</div>
          <div className="flex items-center gap-3 flex-wrap">
            <Legend items={[
              { label: 'Daily spend', color: 'var(--accent)' },
              { label: '7-day avg', color: 'var(--heat-3)' },
              { label: '30-day avg', color: 'var(--supports)' },
            ]} />
            <ViewData dataset={dsDaily} />
          </div>
        </div>
        {summary.calls === 0 ? (
          <p className="ls-empty" style={{ margin: 0 }}>No API calls logged yet. This fills in as the app makes Anthropic calls.</p>
        ) : (
          <DailyChart daily={daily} />
        )}
      </div>

      {/* Per-feature breakdown */}
      <div className="ls-card">
        <div className="flex items-center justify-between gap-2">
          <div className="section-label" style={{ marginTop: 0 }}>Cost by feature</div>
          <ViewData dataset={dsFeatures} />
        </div>
        {features.length === 0 ? (
          <p className="ls-empty" style={{ margin: '8px 0 0' }}>No calls logged yet.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="viewdata-table">
              <thead>
                <tr>
                  <th>Feature</th><th>Calls</th><th>Total</th><th>Avg tokens</th>
                  <th>Avg ctx %</th><th>p50</th><th>p90</th><th>p99</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.feature}>
                    <td className="vd-label">{featureLabel(f.feature)}</td>
                    <td className="vd-num">{f.calls.toLocaleString()}</td>
                    <td className="vd-num">{usd(f.totalCost)}</td>
                    <td className="vd-num">{compact(f.avgTokens)}</td>
                    <td className="vd-num">{pct1(f.avgContextPct)}</td>
                    <td className="vd-num">{usd(f.p50)}</td>
                    <td className="vd-num">{usd(f.p90)}</td>
                    <td className="vd-num">{usd(f.p99)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-pipeline-run rollup */}
      <div className="ls-card">
        <div className="flex items-center justify-between gap-2">
          <div className="section-label" style={{ marginTop: 0 }}>Cost by pipeline run · last 20</div>
          <ViewData dataset={dsRuns} />
        </div>
        {runs.length === 0 ? (
          <p className="ls-empty" style={{ margin: '8px 0 0' }}>No pipeline runs yet.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="viewdata-table">
              <thead>
                <tr><th>Run</th><th>Cadence</th><th>Status</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="vd-label">{dateLabel(r.triggered_at) ?? '–'}</td>
                    <td className="vd-num">{r.cadence}</td>
                    <td className="vd-num" style={{ color: r.status === 'failed' ? 'var(--heat-4)' : r.status === 'completed' ? 'var(--supports)' : 'var(--dim)' }}>{r.status}</td>
                    <td className="vd-num">{r.calls}</td>
                    <td className="vd-num">{compact(r.tokens)}</td>
                    <td className="vd-num">{usd(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent call log (100 fetched, 50 shown, show-more for the rest) */}
      <div className="ls-card">
        <div className="section-label" style={{ marginTop: 0 }}>Recent calls</div>
        {recent.length === 0 ? (
          <p className="ls-empty" style={{ margin: '8px 0 0' }}>No calls logged yet.</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table className="viewdata-table">
                <thead>
                  <tr>
                    <th>Time (UTC)</th><th>Feature</th><th>In</th><th>Out</th>
                    <th>Cache</th><th>Ctx %</th><th>Wall</th><th>Cost</th><th>Run</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="vd-label" style={{ whiteSpace: 'nowrap' }}>{logTime(r.created_at)}</td>
                      <td className="vd-label">{featureLabel(r.feature)}</td>
                      <td className="vd-num">{compact(r.input_tokens)}</td>
                      <td className="vd-num">{compact(r.output_tokens)}</td>
                      <td className="vd-num">{compact(r.cache_read_tokens + r.cache_write_tokens)}</td>
                      <td className="vd-num">{pct1(r.context_pct)}</td>
                      <td className="vd-num">{wall(r.wall_ms)}</td>
                      <td className="vd-num">{usd(r.cost_usd)}</td>
                      <td className="vd-num" style={{ color: 'var(--faint-ink)' }}>{r.pipeline_run_id ? `#${r.pipeline_run_id.slice(0, 8)}` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3" style={{ marginTop: 12 }}>
              {recent.length > 50 && !showAll && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowAll(true)}>
                  Show {recent.length - 50} more
                </button>
              )}
              {showAll && recent.length > 50 && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowAll(false)}>Show less</button>
              )}
              <span style={{ fontSize: 11, color: 'var(--faint-ink)' }}>
                Showing {shown.length} of {recent.length} most recent (last 100 fetched).
              </span>
            </div>
          </>
        )}
      </div>

      {/* Rate card: current active + add new + history */}
      <div className="ls-card">
        <div className="section-label" style={{ marginTop: 0 }}>Pricing rate card</div>

        {activeRateCards.length === 0 ? (
          <p className="ls-empty" style={{ margin: '4px 0 14px' }}>No rate card yet. Add one below so calls can be priced.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
            {activeRateCards.map((c) => (
              <div key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', background: 'var(--bg)' }}>
                <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)' }}>{c.model}</span>
                  <span className="badge badge--accent">active</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '3px 16px', fontSize: 12, color: 'var(--dim)' }}>
                  <span>Input</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{usd(c.input_per_mtok)}/M</span>
                  <span>Output</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{usd(c.output_per_mtok)}/M</span>
                  <span>Cache write</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{usd(c.cache_write_per_mtok)}/M</span>
                  <span>Cache read</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{usd(c.cache_read_per_mtok)}/M</span>
                  <span>Context</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{compact(c.context_window)}</span>
                  <span>Since</span><span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{c.effective_date}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 12 }}>Add new pricing</div>
          <RateCardForm defaults={formDefaults} />
        </div>

        {rateCardHistory.length > 0 && (
          <div style={{ borderTop: '1px dashed var(--line)', paddingTop: 16, marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>Rate history</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="viewdata-table">
                <thead>
                  <tr>
                    <th>Model</th><th>Effective</th><th>Input</th><th>Output</th>
                    <th>Cache write</th><th>Cache read</th><th>Context</th>
                  </tr>
                </thead>
                <tbody>
                  {rateCardHistory.map((c) => {
                    const isActive = activeRateCards.some((a) => a.id === c.id);
                    return (
                      <tr key={c.id} style={isActive ? undefined : { opacity: 0.6 }}>
                        <td className="vd-label">{c.model}{isActive && <span style={{ color: 'var(--accent)', fontSize: 10.5 }}> · active</span>}</td>
                        <td className="vd-num">{c.effective_date}</td>
                        <td className="vd-num">{usd(c.input_per_mtok)}</td>
                        <td className="vd-num">{usd(c.output_per_mtok)}</td>
                        <td className="vd-num">{usd(c.cache_write_per_mtok)}</td>
                        <td className="vd-num">{usd(c.cache_read_per_mtok)}</td>
                        <td className="vd-num">{compact(c.context_window)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
