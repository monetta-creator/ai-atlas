import Link from 'next/link';
import { headers } from 'next/headers';
import { requireAdminPage } from '@/lib/auth';
import { getScanTopics, getScanRuns, getScanPrefs } from '@/lib/data';
import { getDataset } from '@/lib/datasets/registry';
import { checkScanBudget } from '@/lib/scan/budget';
import { buildScanHandoff, cronLabel } from '@/lib/scan/handoff';
import vercelConfig from '@/vercel.json';
import Header from '@/components/Header';
import ScanConsole from '@/components/scan/ScanConsole';
import TopicToggle from '@/components/scan/TopicToggle';
import ScanEnabledToggle from '@/components/scan/ScanEnabledToggle';
import CopyHandoff from '@/components/scan/CopyHandoff';

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
  const [topics, runs, prefs, budget, h] = await Promise.all([
    getScanTopics(), getScanRuns(14), getScanPrefs(), checkScanBudget(), headers(),
  ]);
  const def = getDataset('external-scan');
  const hostName = h.get('host') ?? 'localhost:3000';
  const host = `${hostName.startsWith('localhost') ? 'http' : 'https'}://${hostName}`;
  const crons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
  const latestDay = runs.find((r) => r.status === 'completed')?.day ?? null;
  const searchable = topics.filter((t) => t.active && t.search_queries.length > 0).length;
  const feedCount = topics.reduce((n, t) => n + (t.active ? t.feed_urls.length : 0), 0);
  const activeTopics = topics.filter((t) => t.active);
  const handoff = def
    ? buildScanHandoff({
        def, topics, crons, host,
        generatedOn: new Date().toISOString().slice(0, 10),
      })
    : '';

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <h1 style={{ marginBottom: 10 }}>External scan</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            The daily outside-the-firewall sweep: press feeds and topic web searches, hydrated
            to full text and lightly enriched. The output that matters is one JSON file per day.
          </p>
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            <a href="#json" className="touch-chip" style={chip}>The JSON</a>
            <a href="#config" className="touch-chip" style={chip}>Schedule &amp; config</a>
            <a href="#run" className="touch-chip" style={chip}>Run</a>
            <a href="#topics" className="touch-chip" style={chip}>Topics</a>
            <a href="#contract" className="touch-chip" style={chip}>Contract</a>
            {runs.length > 0 && <a href="#history" className="touch-chip" style={chip}>History</a>}
          </nav>
        </header>

        <section id="json" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">The daily JSON</div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]" style={{ ...panel, marginTop: 14 }}>
            <div className="flex items-center gap-3 flex-wrap">
              <a className="btn btn--primary" href={`/api/datasets/${DATASET_SLUG}?format=json`}>
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
                {' '}JINA_API_KEY: {process.env.JINA_API_KEY ? 'set' : 'unset (keyless reader fallback, rate-limited)'}
              </span>
              <span>
                Models: claude-sonnet-4-6 (one web search per query-bearing topic) · claude-haiku-4-5 (per-item enrichment)
              </span>
              <span>
                Cron SCHEDULES are deploy-time config (vercel.json, shown live above): changing the times is a
                one-line edit plus a push. The toggle here pauses or resumes what the crons actually do.
              </span>
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

        {runs.length > 0 && (
          <section id="history" style={{ marginTop: 24, scrollMarginTop: 80 }}>
            <div className="section-label">Run history</div>
            <div className="flex flex-col gap-1" style={{ marginTop: 14 }}>
              {runs.map((r) => (
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
                  {r.error && <span style={{ color: 'var(--heat-4)', width: '100%' }}>{r.error}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </>
  );
}
