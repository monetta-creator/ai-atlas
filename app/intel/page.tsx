import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth';
import {
  getIntelPrefs, getIntelCompanies, getIntelRuns, getIntelHealth, getIntelModelStats,
  getIntelCompanyYield, getTavilyQuota, getIntelMetricsCoverage, getIntelDatasetStats,
} from '@/lib/data';
import { SCAN_ENRICH_MODELS } from '@/lib/scan/models';
import { checkIntelBudget } from '@/lib/intel/budget';
import { cronLabel } from '@/lib/scan/handoff';
import vercelConfig from '@/vercel.json';
import Header from '@/components/Header';
import IntelConsole from '@/components/intel/IntelConsole';
import IntelEnabledToggle from '@/components/intel/IntelEnabledToggle';
import CompanyToggle from '@/components/intel/CompanyToggle';
import SynthesizeButton from '@/components/intel/SynthesizeButton';
import IntelCalendar from '@/components/intel/IntelCalendar';
import type { IntelCalDay } from '@/components/intel/IntelCalendar';
import CopyHandoff from '@/components/scan/CopyHandoff';
import EnrichModelPicker from '@/components/scan/EnrichModelPicker';
import { setIntelEnrichModelsAction } from '@/lib/actions';
import { getDataset } from '@/lib/datasets/registry';
import { buildIntelHandoff } from '@/lib/intel/handoff';
import DatasetPreview from '@/components/datasets/DatasetPreview';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import type { IntelTier } from '@/lib/types';

export const dynamic = 'force-dynamic';
// Hosts the intel tick action (at most one bounded work unit per call).
export const maxDuration = 60;
export const metadata = { title: 'Intel desk · The AI Atlas' };

const DATASET_SLUGS = ['intel-items', 'intel-companies', 'intel-facts', 'intel-metrics'] as const;
const chip = { fontSize: 12, padding: '5px 13px' } as const;
const panel = {
  background: 'var(--surface)', borderColor: 'var(--line)',
} as const;

const TIER_ORDER: IntelTier[] = ['self', 'card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'];
const TIER_LABEL: Record<IntelTier, string> = {
  self: 'Self',
  card_issuer: 'Card issuers',
  consumer_bank: 'Consumer banks',
  fintech: 'Fintech',
  tech_platform: 'Tech platforms',
  wildcard: 'Wildcard',
};

// The Intel Desk console (admin): a company-intelligence registry with a
// daily collection engine (feeds, search, filings, hydrate, enrich), the
// dataset hand-off, schedule and config, manual run/resume, and full history
// and health. Mirrors /scan section for section; the scheduled driver is the
// /api/cron/intel pair, the public egress is the four key-gated intel-*
// datasets.
export default async function IntelPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();
  const [companies, runs, prefs, budget, health, modelStats, companyYield, quota, metricsCoverage, dsStats, h] = await Promise.all([
    getIntelCompanies(), getIntelRuns(130), getIntelPrefs(), checkIntelBudget(), getIntelHealth(30),
    getIntelModelStats(30), getIntelCompanyYield(30), getTavilyQuota(), getIntelMetricsCoverage(),
    getIntelDatasetStats(), headers(),
  ]);
  const tavily = Boolean(process.env.TAVILY_API_KEY);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const modelLabel = new Map(SCAN_ENRICH_MODELS.map((m) => [m.id, m.label]));
  const defs = DATASET_SLUGS.map((slug) => getDataset(slug)).filter((d): d is NonNullable<typeof d> => d !== null);
  const hostName = h.get('host') ?? 'localhost:3000';
  const host = `${hostName.startsWith('localhost') ? 'http' : 'https'}://${hostName}`;
  const allCrons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const crons = allCrons.filter((c) => c.path.startsWith('/api/cron/intel'));
  const latestDay = runs.find((r) => r.status === 'completed')?.day ?? null;

  // At-a-glance lines for the download cards: what each dataset is (the
  // registry description) plus its live size, coverage, and cadence.
  const metricsTotal = metricsCoverage.reduce((s, r) => s + r.rows, 0);
  const metricsOldest = metricsCoverage.map((r) => r.oldest).filter(Boolean).sort()[0] ?? null;
  const metricsNewest = metricsCoverage.map((r) => r.newest).filter(Boolean).sort().at(-1) ?? null;
  const datasetStatsLine: Record<string, string> = {
    'intel-items': `${dsStats.items.latestDayCount} items on ${dsStats.items.latestDay ?? 'n/a'} · ${dsStats.items.total.toLocaleString()} collected all-time · grows every weekday`,
    'intel-companies': `${dsStats.companies.active} active of ${dsStats.companies.total} tracked, in six tiers · changes with the registry`,
    'intel-facts': `${dsStats.facts.total.toLocaleString()} facts across ${dsStats.facts.companies} companies · grows every weekday`,
    'intel-metrics': `${metricsTotal.toLocaleString()} values · ${metricsCoverage.map((r) => `${r.source} ${r.rows.toLocaleString()}`).join(' · ')}${metricsOldest && metricsNewest ? ` · ${metricsOldest.slice(0, 7)} to ${metricsNewest.slice(0, 7)}` : ''} · Mondays + the quarterly Y-9C ingest`,
  };
  const now = new Date();
  const handoff = defs.length === DATASET_SLUGS.length
    ? buildIntelHandoff({
        defs, companies, crons, host,
        generatedOn: now.toISOString().slice(0, 10),
      })
    : '';

  // The day grid: the trailing 17 weeks, oldest first, one cell per calendar
  // day; completed cells link straight to that day's intel-items JSON.
  const GRID_DAYS = 119;
  const nowMs = now.getTime();
  const byDay = new Map(runs.map((r) => [r.day, r]));
  const calDays: IntelCalDay[] = Array.from({ length: GRID_DAYS }, (_, i) => {
    const d = new Date(nowMs - (GRID_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const r = byDay.get(d);
    return {
      day: d,
      status: r ? (r.status as IntelCalDay['status']) : null,
      feed: r?.feed_item_count ?? 0,
      search: r?.search_item_count ?? 0,
      filings: r?.filing_item_count ?? 0,
      hydrated: r?.hydrated_count ?? 0,
      enriched: r?.enriched_count ?? 0,
      facts: r?.fact_count ?? 0,
      cost: typeof r?.cost_usd === 'number' ? r.cost_usd : null,
      downloadHref: r?.status === 'completed'
        ? `/api/datasets/intel-items?format=json&day=${d}&download=1`
        : null,
    };
  });
  const pct = (num: number, den: number): string => (den > 0 ? `${Math.round((num / den) * 100)}%` : '–');
  const completedRuns = Math.max(1, health.runs.completed);
  const byTier = new Map<IntelTier, typeof companies>();
  for (const t of TIER_ORDER) byTier.set(t, []);
  for (const c of companies) byTier.get(c.tier)?.push(c);
  const quotaWarn = quota.pctUsed > 0.85 || quota.projected > quota.cap;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <Editable
            as="h1"
            style={{ marginBottom: 10 }}
            k="intel.title"
            value={txt('intel.title', 'Intel desk')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            style={{ marginBottom: 20 }}
            k="intel.lede"
            value={txt(
              'intel.lede',
              'A daily company-intelligence sweep: press feeds, rotating web search, and EDGAR filings across a curated registry, hydrated to full text and enriched into structured facts and tags. The output that matters is four key-gated datasets.'
            )}
            editing={editing}
          />
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#downloads" className="touch-chip" style={chip}>Downloads</a>
            <a href="#config" className="touch-chip" style={chip}>Schedule &amp; config</a>
            <a href="#quota" className="touch-chip" style={chip}>Tavily quota</a>
            <a href="#run" className="touch-chip" style={chip}>Run</a>
            <a href="#registry" className="touch-chip" style={chip}>Registry</a>
            <a href="#history" className="touch-chip" style={chip}>History &amp; health</a>
          </nav>
        </header>

        <section id="downloads" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">Downloads</div>
          <div className="flex flex-col gap-2" style={{ marginTop: 14 }}>
            {DATASET_SLUGS.map((slug) => {
              const def = defs.find((d) => d.slug === slug);
              return (
                <div key={slug} className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={panel}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <a className="btn btn--primary" href={`/api/datasets/${slug}?format=json&download=1`}>
                      Download {slug} JSON{slug === 'intel-items' && latestDay ? ` · ${latestDay}` : ''}
                    </a>
                    <a className="btn" href={`/api/datasets/${slug}?format=csv`}>CSV</a>
                    <Link className="btn" href={`/datasets/${slug}`}>Dataset page</Link>
                  </div>
                  {def && (
                    <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 10, maxWidth: 760, lineHeight: 1.55 }}>
                      {def.description}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6 }}>
                    {datasetStatsLine[slug]}
                    {slug === 'intel-items' ? ' · add ?day=YYYY-MM-DD for a specific day' : ''}
                    {slug === 'intel-metrics' ? ' · add ?since=YYYY-MM-DD or ?source=<code> for an incremental pull' : ''}
                  </p>
                  {def && (
                    <div style={{ marginTop: 10 }}>
                      <DatasetPreview
                        slug={slug}
                        columns={def.columns}
                        day={slug === 'intel-items' ? latestDay ?? undefined : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
            From a browser without the portal cookie (a work machine), unlock first:{' '}
            <code>{host}/datasets/enter?k=&lt;PORTAL_KEY&gt;</code>, then download the same URLs.
          </p>
          {handoff && (
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 10 }}>
                Rendered from the live dataset registry, so this never drifts from what the
                downloads actually serve: system overview, the formal contract for all four
                files, and intake design guidance, as one hand-off document.
              </div>
              <CopyHandoff text={handoff} label="Copy importer handoff" />
            </div>
          )}
        </section>

        <section id="config" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Schedule &amp; config</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <IntelEnabledToggle enabled={prefs.enabled} />
              <span className="text-xs" style={{ color: 'var(--dim)' }}>
                {crons.map((c) => `${cronLabel(c.schedule)} (${c.path})`).join(' · ')}
              </span>
            </div>
            <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 12, display: 'grid', gap: 4 }}>
              <span>
                Budget: ${budget.spentUsd.toFixed(2)} of ${budget.capUsd.toFixed(2)} spent today
                (INTEL_DAILY_BUDGET_USD; feeds and filings are free and always run)
              </span>
              <span>
                TAVILY_API_KEY: {tavily ? 'set' : 'unset'} ·
                {' '}OPENROUTER_API_KEY: {openrouter ? 'set' : 'unset'} ·
                {' '}CRON_SECRET: {process.env.CRON_SECRET ? 'set' : 'MISSING, the cron route refuses everything'} ·
                {' '}RESEARCH_CONTACT_EMAIL: {process.env.RESEARCH_CONTACT_EMAIL ? 'set' : 'unset (EDGAR falls back to a placeholder contact)'}
              </span>
              <span>
                Search: {tavily
                  ? 'Tavily news search (LLM-free, free tier, shared with the scan)'
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
              <EnrichModelPicker
                selected={prefs.enrich_models}
                saveAction={setIntelEnrichModelsAction}
                fallbackNote="None selected: enrichment falls back to Claude Haiku."
              />
            </div>
          </div>
        </section>

        <section id="quota" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Tavily quota · this month</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 22, fontWeight: 600, color: quotaWarn ? 'var(--heat-4)' : 'var(--ink)' }}>
                {quota.used.toLocaleString()} / {quota.cap.toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                searches used · projected {quota.projected.toLocaleString()} by month end
                ({Math.round(quota.pctUsed * 100)}% used) · shared with the external scan
              </span>
            </div>
            <div
              style={{
                marginTop: 10, height: 8, borderRadius: 4, background: 'var(--bg)',
                border: '1px solid var(--line)', overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%', width: `${Math.min(100, Math.round(quota.pctUsed * 100))}%`,
                  background: quotaWarn ? 'var(--heat-4)' : 'var(--supports)',
                }}
              />
            </div>
            {quota.capHit && (
              <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 10 }}>
                Cap hit this month: upgrade the Tavily plan or wait for reset, then bump
                TAVILY_MONTHLY_CAP.
              </p>
            )}
            {!quota.capHit && quotaWarn && (
              <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 10 }}>
                Trending over the monthly cap at the current pace.
              </p>
            )}
          </div>
        </section>

        <section id="run" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Manual run</div>
          <div style={{ marginTop: 14 }}>
            <IntelConsole />
          </div>
        </section>

        <section id="registry" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Registry · {companies.length} compan{companies.length === 1 ? 'y' : 'ies'}</div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
            Companies are DB rows seeded from private/intel-companies.json (npm run db:seed:intel;
            the real registry never enters the public repo). Inactive companies drop out of feeds,
            search, and filings collection.
          </p>
          <div className="flex flex-col gap-4" style={{ marginTop: 14 }}>
            {companies.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                No companies yet. Seed them with npm run db:seed:intel.
              </p>
            )}
            {TIER_ORDER.filter((t) => (byTier.get(t) ?? []).length > 0).map((tier) => (
              <div key={tier}>
                <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {TIER_LABEL[tier]} · {(byTier.get(tier) ?? []).length}
                </div>
                <div className="flex flex-col gap-1">
                  {(byTier.get(tier) ?? []).map((c) => {
                    const dossierSummary =
                      c.dossier && typeof c.dossier.summary === 'string' && c.dossier.summary.trim()
                        ? c.dossier.summary as string
                        : null;
                    return (
                      <div
                        key={c.slug}
                        className="rounded-[var(--radius)] border p-2.5"
                        style={{ ...panel, opacity: c.active ? 1 : 0.55 }}
                      >
                        <div className="flex items-center flex-wrap gap-3 text-xs" style={{ color: 'var(--dim)' }}>
                          <span style={{ color: 'var(--ink)' }}>{c.name}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>{c.slug}</span>
                          {c.niche && <span style={{ color: 'var(--faint-ink)' }}>{c.niche}</span>}
                          {c.ticker && <span className="touch-chip" style={{ fontSize: 10, padding: '2px 8px' }}>{c.ticker}</span>}
                          {c.cik && <span className="touch-chip" style={{ fontSize: 10, padding: '2px 8px' }}>CIK {c.cik}</span>}
                          {c.fdic_cert && <span className="touch-chip" style={{ fontSize: 10, padding: '2px 8px' }}>FDIC {c.fdic_cert}</span>}
                          <span style={{ marginLeft: 'auto', color: 'var(--faint-ink)' }}>
                            {c.search_queries.length} quer{c.search_queries.length === 1 ? 'y' : 'ies'} ·
                            {' '}{c.feed_urls.length} feed{c.feed_urls.length === 1 ? '' : 's'}
                          </span>
                          <CompanyToggle slug={c.slug} active={c.active} />
                        </div>
                        {dossierSummary && (
                          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
                            {dossierSummary.length > 280 ? `${dossierSummary.slice(0, 280)}…` : dossierSummary}
                          </p>
                        )}
                        <div style={{ marginTop: 8 }}>
                          <SynthesizeButton slug={c.slug} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="history" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">History &amp; health</div>

          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <IntelCalendar days={calDays} />
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
                sub: `${health.items.total} total · ${health.items.feed} feed · ${health.items.search} search · ${health.items.filing} filings`,
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
                label: 'Significance',
                value: health.items.avgSignificance === null ? '–' : health.items.avgSignificance.toFixed(2),
                sub: `avg across enriched items`,
                warn: false,
              },
              {
                label: 'Facts / metrics',
                value: `${health.factsWritten}`,
                sub: `${health.metricsWritten} metrics written`,
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

          {metricsCoverage.length > 0 && (
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Metrics coverage
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>source</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>rows</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>companies</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>oldest → newest</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricsCoverage.map((m) => (
                      <tr key={m.source} style={{ color: 'var(--dim)' }}>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--line)' }}>
                          {m.source}
                        </td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.rows.toLocaleString()}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.companies.toLocaleString()}</td>
                        <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>
                          {m.oldest ?? '–'} → {m.newest ?? '–'}
                        </td>
                        <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)', color: 'var(--heat-4)' }}>
                          {m.stale ? 'stale: update needed' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
                fdic, edgar_xbrl and cfpb refresh on the Monday cron. y9c refreshes by the quarterly ritual:
                download the newest BHCF ZIP from NIC&apos;s Financial Data Download in a browser, then run
                node scripts/backfill-intel-metrics.mjs --y9c-file=&lt;path&gt;.
              </div>
            </div>
          )}

          {modelStats.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Model A/B · last {health.days} days · quality is yours to judge from the facts and
                summaries; these are the measurable halves
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>model</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>items</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>errors</th>
                      <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>avg significance</th>
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
                        <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{m.avgSignificance === null ? '–' : m.avgSignificance.toFixed(2)}</td>
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
              Company yield · last {health.days} days
              {(() => {
                const dry = companyYield.filter((c) => c.active && c.dry).length;
                return dry > 0 ? ` · ${dry} active compan${dry === 1 ? 'y' : 'ies'} dry` : '';
              })()}
            </summary>
            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table className="text-xs" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--faint-ink)' }}>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>company</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>tier</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>feed</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>search</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>edgar</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>facts</th>
                    <th style={{ padding: '5px 10px', borderBottom: '1px solid var(--line)' }}>last item</th>
                  </tr>
                </thead>
                <tbody>
                  {companyYield.map((c) => (
                    <tr key={c.slug} style={{ color: 'var(--dim)', opacity: c.active ? 1 : 0.5 }}>
                      <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{c.name}</td>
                      <td style={{ padding: '4px 10px', borderBottom: '1px solid var(--line)' }}>{TIER_LABEL[c.tier]}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{c.itemsByFeed}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{c.itemsBySearch}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{c.itemsByFiling}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', borderBottom: '1px solid var(--line)', color: c.active && c.dry ? 'var(--heat-4)' : undefined }}>
                        {c.facts}{c.active && c.dry ? ' · dry' : ''}
                      </td>
                      <td style={{ padding: '4px 10px', fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--line)' }}>{c.lastItem ?? '–'}</td>
                    </tr>
                  ))}
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
                    feeds {r.feed_item_count} · search {r.search_item_count} · filings {r.filing_item_count} ·
                    hydrated {r.hydrated_count} · enriched {r.enriched_count} · skipped {r.skipped_count} ·
                    facts {r.fact_count} · metrics {r.metric_count}
                    {typeof r.cost_usd === 'number' ? ` · $${r.cost_usd.toFixed(2)}` : ''}
                  </span>
                  {r.status === 'completed' && (
                    <span className="flex items-center gap-2">
                      <a className="touch-chip" style={{ fontSize: 11, padding: '2px 9px' }}
                         href={`/api/datasets/intel-items?format=json&day=${r.day}&download=1`}>
                        JSON
                      </a>
                      <a className="touch-chip" style={{ fontSize: 11, padding: '2px 9px' }}
                         href={`/api/datasets/intel-items?format=csv&day=${r.day}`}>
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
