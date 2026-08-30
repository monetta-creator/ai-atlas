import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth';
import {
  getScanTopics, getScanRuns, getScanPrefs, getScanHealth, getPublishedSignalCount,
  getEnrichModelStats,
} from '@/lib/data';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import { getDataset } from '@/lib/datasets/registry';
import { checkScanBudget } from '@/lib/scan/budget';
import { buildScanHandoff, buildSignalsExportHandoff, cronLabel } from '@/lib/scan/handoff';
import { getEditContext } from '@/lib/content';
import vercelConfig from '@/vercel.json';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ScanConsole from '@/components/scan/ScanConsole';
import TopicToggle from '@/components/scan/TopicToggle';
import ScanEnabledToggle from '@/components/scan/ScanEnabledToggle';
import CopyHandoff from '@/components/scan/CopyHandoff';
import EnrichModelPicker from '@/components/scan/EnrichModelPicker';
import ScanCalendar from '@/components/scan/ScanCalendar';
import type { ScanCalDay } from '@/components/scan/ScanCalendar';

export const dynamic = 'force-dynamic';
// Hosts the scan tick action (at most one bounded work unit per call).
export const maxDuration = 60;
export const metadata = { title: 'External scan · The AI Atlas' };

const DATASET_SLUG = 'external-scan';
const chip = { fontSize: 12, padding: '5px 13px' } as const;
const panel = {
  background: 'var(--surface)', borderColor: 'var(--line)',
} as const;

// The External Scan console (admin): the daily JSON hand-off, schedule and
// config, manual run/resume, the topic registry, and the full import contract
// rendered from the live dataset registry (so it can never drift). The
// scheduled driver is the /api/cron/scan pair; the public egress is the
// key-gated external-scan dataset.
export default async function ScanPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();
  const [topics, runs, prefs, budget, health, signalCount, modelStats, h] = await Promise.all([
    getScanTopics(), getScanRuns(130), getScanPrefs(), checkScanBudget(), getScanHealth(30),
    getPublishedSignalCount(), getEnrichModelStats(30), headers(),
  ]);
  const tavily = Boolean(process.env.TAVILY_API_KEY);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const modelLabel = new Map(SCAN_ENRICH_MODELS.map((m) => [m.id, m.label]));
  const def = getDataset('external-scan');
  const signalsDef = getDataset('signals-export');
  const hostName = h.get('host') ?? 'localhost:3000';
  const host = `${hostName.startsWith('localhost') ? 'http' : 'https'}://${hostName}`;
  const crons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const latestDay = runs.find((r) => r.status === 'completed')?.day ?? null;
  const searchable = topics.filter((t) => t.active && t.search_queries.length > 0).length;
  const feedCount = topics.reduce((n, t) => n + (t.active ? t.feed_urls.length : 0), 0);
  const activeTopics = topics.filter((t) => t.active);
  const now = new Date();
  const handoff = def
    ? buildScanHandoff({
        def, topics, crons, host,
        generatedOn: now.toISOString().slice(0, 10),
      })
    : '';
  const signalsHandoff = signalsDef
    ? buildSignalsExportHandoff({
        def: signalsDef, host,
        generatedOn: now.toISOString().slice(0, 10),
      })
    : '';

  // The day grid: the trailing 17 weeks, oldest first, one cell per calendar
  // day; completed cells link straight to that day's JSON.
  const GRID_DAYS = 119;
  const nowMs = now.getTime();
  const byDay = new Map(runs.map((r) => [r.day, r]));
  const calDays: ScanCalDay[] = Array.from({ length: GRID_DAYS }, (_, i) => {
    const d = new Date(nowMs - (GRID_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    return {
      day: d,
      status: r ? (r.status as ScanCalDay['status']) : null,
      feed: r?.feed_item_count ?? 0,
      search: r?.search_item_count ?? 0,
      hydrated: r?.hydrated_count ?? 0,
      enriched: r?.enriched_count ?? 0,
      skipped: r?.skipped_count ?? 0,
      cost: typeof r?.cost_usd === 'number' ? r.cost_usd : null,
      downloadHref: r?.status === 'completed'
        ? `/api/datasets/${DATASET_SLUG}?format=json&day=${d}&download=1`
        : null,
    };
  });
  const pct = (num: number, den: number): string => (den > 0 ? `${Math.round((num / den) * 100)}%` : '–');
  const completedRuns = Math.max(1, health.runs.completed);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <Editable
            as="h1"
            style={{ marginBottom: 10 }}
            k="scan.title"
            value={txt('scan.title', 'External scan')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            style={{ marginBottom: 20 }}
            k="scan.lede"
            value={txt(
              'scan.lede',
              'The daily outside-the-firewall sweep: press feeds and topic web searches, hydrated to full text and lightly enriched. The output that matters is one JSON file per day.'
            )}
            editing={editing}
          />
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#json" className="touch-chip" style={chip}>The JSON</a>
            <a href="#signals" className="touch-chip" style={chip}>Signals export</a>
            <a href="#config" className="touch-chip" style={chip}>Schedule &amp; config</a>
            <a href="#run" className="touch-chip" style={chip}>Run</a>
            <a href="#topics" className="touch-chip" style={chip}>Topics</a>
            <a href="#contract" className="touch-chip" style={chip}>Contract</a>
            <a href="#history" className="touch-chip" style={chip}>History &amp; health</a>
          </nav>
        </header>

        <section id="json" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">The daily JSON</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <a className="btn btn--primary" href={`/api/datasets/${DATASET_SLUG}?format=json&download=1`}>
                Download JSON{latestDay ? ` · ${latestDay}` : ''}
              </a>
              <a className="btn" href={`/api/datasets/${DATASET_SLUG}?format=csv`}>CSV</a>
              <Link className="btn" href="/datasets/external-scan">Dataset page</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
              Serves the latest completed day; add ?day=YYYY-MM-DD for a specific one. From a
              browser without the portal cookie (a work machine), unlock first:{' '}
              <code>{host}/datasets/enter?k=&lt;PORTAL_KEY&gt;</code>, then download the same URL.
            </p>
          </div>
        </section>

        {signalsDef && (
          <section id="signals" style={{ marginTop: 24, scrollMarginTop: 80 }}>
            <div className="section-label">Firewall export · published signals</div>
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
              <div className="flex items-center gap-3 flex-wrap">
                <a className="btn btn--primary" href={`/api/datasets/signals-export?format=json&download=1`}>
                  Download JSON · {signalCount} signal{signalCount === 1 ? '' : 's'}
                </a>
                <a className="btn" href={`/api/datasets/signals-export?format=csv`}>CSV</a>
                <Link className="btn" href="/datasets/signals-export">Dataset page</Link>
              </div>
              <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
                Every published signal in the SAME row shape as the daily scan file (the intake
                ingests both unchanged), with the signal-native columns appended and the full
                writeup composed into full_text. Full corpus every download; the importer upserts
                on item_id. Key-gated like the daily file.
              </p>
              <div style={{ marginTop: 12 }}>
                <CopyHandoff text={signalsHandoff} label="Copy signals-export handoff" />
              </div>
            </div>
          </section>
        )}

        <section id="config" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Schedule &amp; config</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <ScanEnabledToggle enabled={prefs.enabled} />
              <span className="text-xs" style={{ color: 'var(--dim)' }}>
                {crons.map((c) => `${cronLabel(c.schedule)} (${c.path})`).join(' · ')}
              </span>
            </div>
            <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 12, display: 'grid', gap: 4 }}>
              <span>
                Budget: ${budget.spentUsd.toFixed(2)} of ${budget.capUsd.toFixed(2)} spent today
                (SCAN_DAILY_BUDGET_USD; feeds are free and always run)
              </span>
              <span>
                CRON_SECRET: {process.env.CRON_SECRET ? 'set' : 'MISSING, the cron route refuses everything'} ·
                {' '}JINA_API_KEY: {process.env.JINA_API_KEY ? 'set' : 'unset (keyless reader fallback, rate-limited)'} ·
                {' '}TAVILY_API_KEY: {tavily ? 'set' : 'unset'} ·
                {' '}OPENROUTER_API_KEY: {openrouter ? 'set' : 'unset'}
              </span>
              <span>
                Search: {tavily
                  ? 'Tavily news search (LLM-free, free tier)'
                  : 'claude-sonnet-4-6 + web_search (set TAVILY_API_KEY to switch to the free leg)'}
                {' '}· Enrichment: {prefs.enrich_models.length
                  ? prefs.enrich_models.map((id) => modelLabel.get(id) ?? id).join(' / ') + ' via OpenRouter'
                  : 'claude-haiku-4-5 (fallback; pick models below)'}
              </span>
              <span>
                Cron SCHEDULES are deploy-time config (vercel.json, shown live above): changing the times is a
                one-line edit plus a push. The toggle here pauses or resumes what the crons actually do.
              </span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Enrichment model{prefs.enrich_models.length > 1 ? 's' : ''} · picking two or more splits items
                across them for the A/B table below{openrouter ? '' : '. OPENROUTER_API_KEY is unset, so non-Claude picks will error until it is added'}
              </div>
              <EnrichModelPicker selected={prefs.enrich_models} />
            </div>
          </div>
        </section>

        <section id="run" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Manual run</div>
          <div style={{ marginTop: 14 }}>
            <ScanConsole />
          </div>
        </section>

        <section id="topics" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">
            Topics · {searchable} searched daily · {feedCount} feeds
          </div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
            Topics are DB rows seeded from private/scan-topics.json (npm run db:seed:scan; the real
            set never enters the public repo). A topic with no search queries is feeds-only; that
            list is the cost knob. Inactive topics leave discovery AND the enrichment tag list.
          </p>
          <div className="flex flex-col gap-1" style={{ marginTop: 14 }}>
            {topics.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                No topics yet. Seed them with npm run db:seed:scan.
              </p>
            )}
            {topics.map((t) => (
              <details
                key={t.slug}
                className="rounded-[var(--radius)] border"
                style={{ ...panel, opacity: t.active ? 1 : 0.55 }}
              >
                <summary
                  className="flex items-center flex-wrap gap-3 text-xs p-2.5"
                  style={{ color: 'var(--dim)', cursor: 'pointer', listStyle: 'none' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', minWidth: 34 }}>
                    {t.taxonomy_code}
                  </span>
                  <span style={{ color: 'var(--ink)' }}>{t.name}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--faint-ink)' }}>
                    {t.search_queries.length > 0 ? `${t.search_queries.length} quer${t.search_queries.length === 1 ? 'y' : 'ies'}` : 'feeds only'}
                    {t.feed_urls.length > 0 ? ` · ${t.feed_urls.length} feed${t.feed_urls.length === 1 ? '' : 's'}` : ''}
                  </span>
                  <TopicToggle slug={t.slug} active={t.active} />
                </summary>
                <div className="text-xs p-2.5 pt-0" style={{ color: 'var(--faint-ink)' }}>
                  {t.description && <p style={{ marginBottom: 6 }}>{t.description}</p>}
                  {t.search_queries.length > 0 && (
                    <div style={{ fontFamily: 'var(--font-mono)', display: 'grid', gap: 2 }}>
                      {t.search_queries.map((q) => <span key={q}>search: {q}</span>)}
                    </div>
                  )}
                  {t.feed_urls.length > 0 && (
                    <div style={{ fontFamily: 'var(--font-mono)', display: 'grid', gap: 2, marginTop: 4 }}>
                      {t.feed_urls.map((u) => <span key={u}>feed: {u}</span>)}
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>

        {def && (
          <section id="contract" style={{ marginTop: 24, scrollMarginTop: 80 }}>
            <div className="section-label">The import contract</div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
              Rendered from the live dataset registry, so this never drifts from what the download
              actually serves. The copy button bundles all of it (plus access URLs, schedule,
              status semantics, taxonomy codes, and an example row) as one markdown handoff for
              the importer-side assistant.
            </p>
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
              <CopyHandoff text={handoff} />
            </div>
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                    <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>key</th>
                    <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>type</th>
                    <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>definition</th>
                  </tr>
                </thead>
                <tbody>
                  {def.columns.map((c) => (
                    <tr key={c.key} style={{ color: 'var(--dim)' }}>
                      <td style={{ padding: '5px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>{c.key}</td>
                      <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>{c.type}</td>
                      <td style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>{c.def}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 12, display: 'grid', gap: 4 }}>
              <span>Envelope: {'{ dataset: { …schema, day, row_count, columns }, rows: […] }'} · dataset.day is null on the latest-completed default; read per-row run_day.</span>
              <span>Taxonomy codes in use: {activeTopics.map((t) => t.taxonomy_code).join(', ')}</span>
              <span>Full write-up: docs/external-scan.md in the repo.</span>
            </div>
          </section>
        )}

        <section id="history" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">History &amp; health</div>

          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <ScanCalendar days={calDays} />
          </div>

          <div
            style={{
              marginTop: 14, display: 'grid', gap: 'var(--gap, 10px)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            {[
              {
                label: `Runs · ${health.days}d`,
                value: `${health.runs.completed} ok`,
                sub: `${health.runs.failed} failed · ${health.runs.missedDays} missed day${health.runs.missedDays === 1 ? '' : 's'}`,
                warn: health.runs.failed > 0 || health.runs.missedDays > 0,
              },
              {
                label: 'Items / day',
                value: `${Math.round(health.items.total / completedRuns)}`,
                sub: `${health.items.total} total · ${health.items.domains} domains`,
                warn: false,
              },
              {
                label: 'Fetch success',
                value: pct(health.items.fetchDone, health.items.fetchDone + health.items.fetchFailed),
                sub: `${health.items.fetchFailed} failed`,
                warn: health.items.fetchFailed > health.items.fetchDone / 4,
              },
              {
                label: 'Enrichment',
                value: pct(health.items.enrichDone, health.items.enrichDone + health.items.enrichSkipped + health.items.enrichError),
                sub: `${health.items.enrichSkipped} skipped · ${health.items.enrichError} errors`,
                warn: health.items.enrichError > 0,
              },
              {
                label: 'Relevance',
                value: health.items.avgRelevance === null ? '–' : health.items.avgRelevance.toFixed(2),
                sub: `${health.items.highRelevance} at 0.7 or higher`,
                warn: false,
              },
              {
                label: 'Spend',
                value: `$${health.spendUsd.toFixed(2)}`,
                sub: `$${(health.spendUsd / completedRuns).toFixed(2)} / run`,
                warn: false,
              },
            ].map((t) => (
              <div key={t.label} className="rounded-[var(--radius)] border p-3" style={panel}>
                <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>{t.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: t.warn ? 'var(--heat-4)' : 'var(--ink)', marginTop: 2 }}>
                  {t.value}
                </div>
                <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 2 }}>{t.sub}</div>
              </div>
            ))}
          </div>

          {modelStats.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Model A/B · last {health.days} days · quality is yours to judge from the summaries; these are the measurable halves
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>model</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>items</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>errors</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg relevance</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg tags</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>summary chars</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg ms</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>$/item</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>total $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelStats.map((m) => (
                      <tr key={m.model} style={{ color: 'var(--dim)' }}>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                          {modelLabel.get(m.model) ?? m.model}
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.items}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)', color: m.errors > 0 ? 'var(--heat-4)' : undefined }}>{m.errors}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgRelevance === null ? '–' : m.avgRelevance.toFixed(2)}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgTags === null ? '–' : m.avgTags.toFixed(1)}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgSummaryChars === null ? '–' : m.avgSummaryChars}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgWallMs ?? '–'}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.costPerItem === null ? '–' : `$${m.costPerItem.toFixed(4)}`}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>${m.costUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <details style={{ marginTop: 14 }}>
            <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
              Topic yield · last {health.days} days
              {(() => {
                const dry = health.topicYield.filter((t) => t.searchable && t.items === 0).length;
                return dry > 0 ? ` · ${dry} searched topic${dry === 1 ? '' : 's'} dry` : '';
              })()}
            </summary>
            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>code</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>topic</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>mode</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>items</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>last item</th>
                  </tr>
                </thead>
                <tbody>
                  {health.topicYield.map((t) => {
                    const dry = t.searchable && t.items === 0;
                    return (
                      <tr key={t.slug} style={{ color: 'var(--dim)', opacity: t.active ? 1 : 0.5 }}>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>{t.taxonomy_code}</td>
                        <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{t.name}</td>
                        <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>
                          {!t.active ? 'inactive'
                            : t.searchable && t.hasFeeds ? 'searched + feeds'
                            : t.searchable ? 'searched'
                            : t.hasFeeds ? 'feeds only'
                            : 'dormant (tag only)'}
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)', color: dry ? 'var(--heat-4)' : undefined }}>
                          {t.items}{dry ? ' · dry' : ''}
                        </td>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>{t.lastItem ?? '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          {health.issues.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="text-xs" style={{ color: 'var(--faint-ink)', cursor: 'pointer' }}>
                Recent issues · {health.issues.length}
              </summary>
              <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 10, display: 'grid', gap: 3 }}>
                {health.issues.map((iss, i) => (
                  <div key={i}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{iss.day}</span>
                    {' '}{iss.note}
                  </div>
                ))}
              </div>
            </details>
          )}

          {runs.length > 0 && (
            <div className="flex flex-col gap-1" style={{ marginTop: 14 }}>
              {runs.slice(0, 14).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ ...panel, color: 'var(--dim)' }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{r.day}</span>
                  <span
                    style={{
                      color:
                        r.status === 'failed' ? 'var(--heat-4)'
                        : r.status === 'completed' ? 'var(--supports)'
                        : 'var(--dim)',
                    }}
                  >
                    · {r.status} ({r.step})
                  </span>
                  <span style={{ marginLeft: 'auto' }}>
                    feeds {r.feed_item_count} · search {r.search_item_count} · hydrated {r.hydrated_count} ·
                    enriched {r.enriched_count} · skipped {r.skipped_count}
                    {typeof r.cost_usd === 'number' ? ` · $${r.cost_usd.toFixed(2)}` : ''}
                  </span>
                  {r.status === 'completed' && (
                    <span className="flex items-center gap-2">
                      <a className="touch-chip" style={{ fontSize: 11, padding: '2px 9px' }}
                         href={`/api/datasets/${DATASET_SLUG}?format=json&day=${r.day}&download=1`}>
                        JSON
                      </a>
                      <a className="touch-chip" style={{ fontSize: 11, padding: '2px 9px' }}
                         href={`/api/datasets/${DATASET_SLUG}?format=csv&day=${r.day}`}>
                        CSV
                      </a>
                    </span>
                  )}
                  {r.error && <span style={{ color: 'var(--heat-4)', width: '100%' }}>{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </>
  );
}
