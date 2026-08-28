import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getScanTopics, getScanRuns } from '@/lib/data';
import Header from '@/components/Header';
import ScanConsole from '@/components/scan/ScanConsole';
import TopicToggle from '@/components/scan/TopicToggle';

export const dynamic = 'force-dynamic';
// Hosts the scan tick action (at most one bounded work unit per call).
export const maxDuration = 60;
export const metadata = { title: 'External scan · The AI Atlas' };

// The External Scan console (admin): topics, run history, manual run/resume.
// The scheduled driver is the /api/cron/scan pair; the public egress is the
// key-gated external-scan dataset.
export default async function ScanPage() {
  const admin = await requireAdminPage();
  const [topics, runs] = await Promise.all([getScanTopics(), getScanRuns(14)]);
  const searchable = topics.filter((t) => t.active && t.search_queries.length > 0).length;
  const feedCount = topics.reduce((n, t) => n + (t.active ? t.feed_urls.length : 0), 0);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <h1 style={{ marginBottom: 10 }}>External scan</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            The daily outside-the-firewall sweep: press feeds and topic web searches, hydrated
            to full text and lightly enriched. Each day ships as the key-gated{' '}
            <Link href="/datasets/external-scan">external-scan dataset</Link>.
          </p>
        </header>

        <ScanConsole />

        <section style={{ marginTop: 24 }}>
          <div className="section-label">
            Topics · {searchable} searched daily · {feedCount} feeds
          </div>
          <div className="flex flex-col gap-1" style={{ marginTop: 14 }}>
            {topics.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                No topics yet. Seed them with npm run db:seed:scan (reads private/scan-topics.json).
              </p>
            )}
            {topics.map((t) => (
              <div
                key={t.slug}
                className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
                style={{
                  background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)',
                  opacity: t.active ? 1 : 0.55,
                }}
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
              </div>
            ))}
          </div>
        </section>

        {runs.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <div className="section-label">Run history</div>
            <div className="flex flex-col gap-1" style={{ marginTop: 14 }}>
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center flex-wrap gap-3 text-xs rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}
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
