import Link from 'next/link';
import { headers } from 'next/headers';
import { adminGate } from '@/lib/admin-gate';
import {
  getToolingPrefs, getToolingCategories, getToolingRuns, getToolingHealth, getToolingModelStats,
  getCurationQueue, getTavilyQuota, getToolingRunByKey, getLatestPullRun, getToolingRun, getNavCounts,
} from '@/lib/data';
import { weekKeyToday } from '@/lib/tooling/engine';
import { DEFAULT_RUBRIC } from '@/lib/tooling/score';
import { checkToolingBudget } from '@/lib/tooling/budget';
import { cronLabel } from '@/lib/scan/handoff';
import vercelConfig from '@/vercel.json';
import PageTop from '@/components/PageTop';
import ToolingConsole from '@/components/tooling/ToolingConsole';
import ToolingPrefsForm from '@/components/tooling/ToolingPrefsForm';
import CategoriesManager from '@/components/tooling/CategoriesManager';
import CurationQueue from '@/components/tooling/CurationQueue';
import ToolingRunsTable from '@/components/tooling/ToolingRunsTable';
import ToolingWeekStrip from '@/components/tooling/ToolingWeekStrip';
import type { ToolingWeekCell } from '@/components/tooling/ToolingWeekStrip';
import ToolingModelAb from '@/components/tooling/ToolingModelAb';
import CopyHandoff from '@/components/scan/CopyHandoff';
import { getDataset } from '@/lib/datasets/registry';
import { buildToolingHandoff } from '@/lib/tooling/handoff';

export const dynamic = 'force-dynamic';
// Hosts the tick action (at most one bounded work unit per call).
export const maxDuration = 60;
export const metadata = { title: 'Tooling console · The AI Atlas' };

const DATASET_SLUGS = ['tooling-products', 'tooling-events', 'tooling-features', 'tooling-catalog'] as const;
const panel = { background: 'var(--surface)', borderColor: 'var(--line)' } as const;
const WEEK_STRIP_LENGTH = 26;

// The AI Tooling Monitor's operating console (admin): engine runs, schedule
// and config, prefs, the curation queue, dataset downloads and the importer
// handoff, run history and health, the category registry, and the
// enrichment model A/B. Mirrors /intel and /scan section for section; the
// scheduled driver is the weekly /api/cron/tooling trio, the public egress
// is three key-gated tooling-* datasets plus the public tooling-catalog.
export default async function ToolingConsolePage() {
  const gate = await adminGate('/tooling/console', 'Tooling console');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;

  const weekDay = weekKeyToday();
  const [prefs, categories, runs, health, modelStats, queue, quota, weeklyRun, pullRunRow, h] = await Promise.all([
    getToolingPrefs(), getToolingCategories(true), getToolingRuns(60), getToolingHealth(8),
    getToolingModelStats(), getCurationQueue(300), getTavilyQuota(),
    getToolingRunByKey('weekly', weekDay), getLatestPullRun(), headers(),
  ]);
  const pullRun = pullRunRow ? await getToolingRun(pullRunRow.id) : null;
  const [weeklyBudget, pullBudget] = await Promise.all([
    weeklyRun ? checkToolingBudget(weeklyRun.id, 'weekly') : Promise.resolve(null),
    pullRun ? checkToolingBudget(pullRun.id, 'pull') : Promise.resolve(null),
  ]);

  const tavily = Boolean(process.env.TAVILY_API_KEY);
  const openrouter = Boolean(process.env.OPENROUTER_API_KEY);
  const producthunt = Boolean(process.env.PRODUCTHUNT_TOKEN);
  const github = Boolean(process.env.GITHUB_TOKEN);
  const cronSecret = Boolean(process.env.CRON_SECRET);

  const defs = DATASET_SLUGS.map((slug) => getDataset(slug)).filter((d): d is NonNullable<typeof d> => d !== null);
  const hostName = h.get('host') ?? 'localhost:3000';
  const host = `${hostName.startsWith('localhost') ? 'http' : 'https'}://${hostName}`;
  const allCrons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const crons = allCrons.filter((c) => c.path.startsWith('/api/cron/tooling'));
  const handoff = defs.length === DATASET_SLUGS.length
    ? buildToolingHandoff({ defs, categories, crons, host, generatedOn: new Date().toISOString().slice(0, 10) })
    : '';

  // The 26-week strip: mapped against the weekly-kind runs already fetched
  // above. A fresh install (the engine only started 2026-09-17) shows a
  // mostly-empty strip; that is the correct picture, not a bug.
  const byWeek = new Map(runs.filter((r) => r.kind === 'weekly').map((r) => [r.day, r]));
  const mondayMs = new Date(`${weekDay}T00:00:00Z`).getTime();
  const weekCells: ToolingWeekCell[] = Array.from({ length: WEEK_STRIP_LENGTH }, (_, i) => {
    const d = new Date(mondayMs - (WEEK_STRIP_LENGTH - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10);
    const r = byWeek.get(d);
    return {
      day: d,
      status: r ? (r.status as ToolingWeekCell['status']) : null,
      inserted: r?.inserted_count ?? 0,
      cataloged: r?.cataloged_count ?? 0,
      deepDived: r?.deep_dived_count ?? 0,
      cost: typeof r?.cost_usd === 'number' ? r.cost_usd : null,
      reportHref: r?.report_id ? `/reports/sheet/${r.report_id}` : null,
    };
  });

  const weeklyCap = Number(process.env.TOOLING_WEEKLY_BUDGET_USD || 4);
  const pullCap = Number(process.env.TOOLING_PULL_BUDGET_USD || 12);
  const quotaWarn = quota.pctUsed > 0.85 || quota.projected > quota.cap;
  const counts = await countsP;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname="/tooling/console"
          label="Tooling console"
          viewer={{ admin, portal: admin }}
          counts={counts}
        >
          Curation queue {queue.length}{runs.length > 0 ? ` · ${runs.length} runs on record` : ''}
        </PageTop>

        <section id="run" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">Run</div>
          <div style={{ marginTop: 14 }}>
            <ToolingConsole
              weeklyRun={weeklyRun} weeklyBudget={weeklyBudget}
              pullRun={pullRun} pullBudget={pullBudget}
            />
          </div>
        </section>

        <section id="config" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Schedule &amp; config</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="text-xs" style={{ color: 'var(--dim)' }}>
              {crons.map((c) => `${cronLabel(c.schedule)} (${c.path})`).join(' · ')}
            </div>
            <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 12, display: 'grid', gap: 4 }}>
              <span>
                Weekly cap: ${weeklyCap.toFixed(2)}
                {weeklyBudget ? ` · $${weeklyBudget.spentUsd.toFixed(2)} spent on this week's run` : ' · no run yet this week'}
                {' '}(TOOLING_WEEKLY_BUDGET_USD)
              </span>
              <span>
                Pull cap: ${pullCap.toFixed(2)}
                {pullBudget ? ` · $${pullBudget.spentUsd.toFixed(2)} spent on the current pull` : ' · no pull in flight'}
                {' '}(TOOLING_PULL_BUDGET_USD)
              </span>
              <span>
                TAVILY_API_KEY: {tavily ? 'set' : 'unset'} ·
                {' '}OPENROUTER_API_KEY: {openrouter ? 'set' : 'unset'} ·
                {' '}PRODUCTHUNT_TOKEN: {producthunt ? 'set' : 'unset (Product Hunt discovery skipped)'} ·
                {' '}GITHUB_TOKEN: {github ? 'set' : 'unset (GitHub search runs unauthenticated, lower rate limit)'} ·
                {' '}CRON_SECRET: {cronSecret ? 'set' : 'MISSING, the cron route refuses everything'}
              </span>
              <span>
                Cron SCHEDULES are deploy-time config (vercel.json, shown live above): changing the times is a
                one-line edit plus a push. The enabled toggle below pauses or resumes only the Monday weekly cron;
                manual runs and the big pull always bypass it.
              </span>
            </div>
          </div>

          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <span style={{ fontSize: 22, fontWeight: 600, color: quotaWarn ? 'var(--heat-4)' : 'var(--ink)' }}>
                {quota.used.toLocaleString()} / {quota.cap.toLocaleString()}
              </span>
              <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                Tavily searches used this month · projected {quota.projected.toLocaleString()} by month end
                ({Math.round(quota.pctUsed * 100)}%) · shared with the scan, pipeline, and intel desk
              </span>
            </div>
            <div style={{ marginTop: 10, height: 8, borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--line)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%', width: `${Math.min(100, Math.round(quota.pctUsed * 100))}%`,
                  background: quotaWarn ? 'var(--heat-4)' : 'var(--supports)',
                }}
              />
            </div>
            {quota.capHit && (
              <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 10 }}>
                Cap hit this month: upgrade the Tavily plan or wait for reset, then bump TAVILY_MONTHLY_CAP.
              </p>
            )}
          </div>
        </section>

        <section id="prefs" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Preferences</div>
          <div style={{ marginTop: 14 }}>
            <ToolingPrefsForm prefs={prefs} defaultRubric={DEFAULT_RUBRIC} />
          </div>
        </section>

        <section id="queue" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Curation queue · {queue.length}</div>
          <div style={{ marginTop: 14 }}>
            <CurationQueue products={queue} />
          </div>
        </section>

        <section id="downloads" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Downloads</div>
          <div className="flex flex-col gap-2" style={{ marginTop: 14 }}>
            {DATASET_SLUGS.map((slug) => {
              const def = defs.find((d) => d.slug === slug);
              return (
                <div key={slug} className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={panel}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <a className="btn btn--primary" href={`/api/datasets/${slug}?format=json&download=1`}>
                      Download {slug} JSON{def?.keyGated ? ' 🔒' : ''}
                    </a>
                    <a className="btn" href={`/api/datasets/${slug}?format=csv`}>CSV</a>
                    <Link className="btn" href={`/datasets/${slug}`}>Dataset page</Link>
                    {def?.keyGated && (
                      <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>key-gated</span>
                    )}
                  </div>
                  {def && (
                    <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 10, maxWidth: 760, lineHeight: 1.55 }}>
                      {def.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 10 }}>
            From a browser without the portal cookie (a work machine), unlock first:{' '}
            <code>{host}/datasets/enter?k=&lt;PORTAL_KEY&gt;</code>, then download the same URLs. tooling-catalog
            needs no key.
          </p>
          {handoff && (
            <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 10 }}>
                Rendered from the live dataset registry and category roster, so this never drifts from what the
                downloads actually serve.
              </div>
              <CopyHandoff text={handoff} label="Copy importer handoff" />
            </div>
          )}
        </section>

        <section id="history" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">History &amp; health</div>

          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <ToolingWeekStrip weeks={weekCells} />
          </div>

          <div
            style={{
              marginTop: 14, display: 'grid', gap: 'var(--gap, 10px)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            {[
              {
                label: `Runs · ${health.weeks}w`,
                value: `${health.runs.completed} ok`,
                sub: `${health.runs.failed} failed · ${health.runs.running} running`,
                warn: health.runs.failed > 0,
              },
              {
                label: 'Catalog',
                value: `${health.products.cataloged}`,
                sub: `${health.products.candidate} candidate · ${health.products.parked} parked · ${health.products.dismissed} dismissed`,
                warn: false,
              },
              {
                label: 'Cataloged in window',
                value: `${health.catalogedInWindow}`,
                sub: `first seen in the last ${health.weeks} weeks`,
                warn: false,
              },
              {
                label: 'Deep dives',
                value: `${health.deepDivesInWindow}`,
                sub: `in the last ${health.weeks} weeks`,
                warn: false,
              },
              {
                label: 'Spend',
                value: `$${health.spendUsd.toFixed(2)}`,
                sub: `over the last ${health.weeks} weeks`,
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

          {health.issues.length > 0 && (
            <details style={{ marginTop: 14 }}>
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

          <div style={{ marginTop: 14 }}>
            <ToolingRunsTable runs={runs.slice(0, 20)} />
          </div>

          {modelStats.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>
                Enrichment model A/B, by enriched_by
              </div>
              <ToolingModelAb stats={modelStats} />
            </div>
          )}
        </section>

        <section id="categories" style={{ marginTop: 24, scrollMarginTop: 80 }}>
          <div className="section-label">Categories · {categories.length}</div>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
            The real category list overlays private/tooling-categories.json (npm run db:seed:tooling); this
            migration&apos;s generic starter set is what a fresh install shows until then.
          </p>
          <div style={{ marginTop: 14 }}>
            <CategoriesManager categories={categories} />
          </div>
        </section>
      </section>
    </>
  );
}
