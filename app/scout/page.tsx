import Link from 'next/link';
import { isAdmin, isPortal } from '@/lib/auth';
import {
  getScoutVerticals, getTrackedCompanies, getRecentCompanyEvents, getScoutQueue,
  getQueuedCompaniesPublic,
} from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { COMPANY_STAGE_LABEL, COMPANY_EVENT_LABEL, timeAgo } from '@/lib/format';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import AddCompanyForm from '@/components/scout/AddCompanyForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Startup Scout · The AI Atlas' };

// Startup Scout (public): the acquisition watchlist. Tracked companies grouped
// by vertical, each profile a click away, plus a recent-activity strip. The
// working console (queue, runs, verticals) lives at /scout/console. Leak
// discipline: verdicts, scores, reasons, and non-tracked companies are
// admin-only and never fetched here for guests.
export default async function ScoutPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const personal = await isAdmin();
  const portal = await isPortal();
  const { editing, txt } = await getEditContext();
  const { added } = await searchParams;
  const justAdded = added === '1';

  const [verticals, tracked, events] = await Promise.all([
    getScoutVerticals(personal), getTrackedCompanies(personal), getRecentCompanyEvents(),
  ]);
  const queued = personal ? (await getScoutQueue()).length : 0;
  // Portal keyholders (not admins, who have the console) see the queue's
  // descriptive strip: their adds wait here for editorial review.
  const pendingQueue = portal && !personal ? await getQueuedCompaniesPublic() : [];

  const byVertical = new Map<string, typeof tracked>();
  for (const c of tracked) {
    const list = byVertical.get(c.vertical) ?? [];
    list.push(c);
    byVertical.set(c.vertical, list);
  }

  return (
    <>
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname="/scout"
          label="Startup Scout"
          viewer={{ admin: personal, portal: portal || personal }}
          title={
            <Editable
              as="h1"
              k="scout.title"
              value={txt('scout.title', 'Startup Scout')}
              editing={editing}
            />
          }
        >
          {personal && `The desk: ${queued} compan${queued === 1 ? 'y' : 'ies'} in the review queue`}
        </PageTop>

        {portal && !personal && justAdded && (
          <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 16 }}>
            Thanks, the target is in the review queue.
          </p>
        )}

        {portal && (
          <details style={{ marginBottom: 22 }}>
            <summary className="text-sm" style={{ color: 'var(--dim)', cursor: 'pointer' }}>
              Add a target… {!personal && '(added companies wait for editorial review before joining the watchlist)'}
            </summary>
            <div style={{ marginTop: 10 }}>
              <AddCompanyForm verticals={verticals.filter((v) => v.active)} />
            </div>
          </details>
        )}

        {pendingQueue.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <div className="section-label">In the review queue · {pendingQueue.length}</div>
            <div className="flex flex-col gap-1">
              {pendingQueue.map((c) => (
                <div
                  key={c.id}
                  className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <Link href={`/scout/${c.id}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                    {c.name}
                  </Link>
                  {c.one_liner && <span style={{ color: 'var(--dim)', flex: 1, minWidth: 200 }}>{c.one_liner}</span>}
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                    {COMPANY_STAGE_LABEL[c.stage]}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6 }}>
              Added companies wait here for editorial review before joining the watchlist.
            </p>
          </section>
        )}

        {events.length > 0 && (
          <section id="activity" style={{ scrollMarginTop: 80, marginBottom: 26 }}>
            <div className="section-label">Recent activity</div>
            <div className="flex flex-col gap-1">
              {events.map((e) => (
                <div
                  key={e.id}
                  className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                    {e.event_date}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--accent)' }}>{COMPANY_EVENT_LABEL[e.kind]}</span>
                  <Link href={`/scout/${e.company_id}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                    {e.company_name}
                  </Link>
                  <span style={{ color: 'var(--dim)', flex: 1, minWidth: 200 }}>{e.title}</span>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
                      ↗
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {tracked.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
            Nothing tracked yet. Companies land here once they clear the review queue.
          </p>
        )}

        {verticals.filter((v) => v.active || (byVertical.get(v.slug)?.length ?? 0) > 0).map((v) => {
          const companies = byVertical.get(v.slug) ?? [];
          return (
            <section key={v.slug} id={`v-${v.slug}`} style={{ marginTop: 26, scrollMarginTop: 80 }}>
              <div className="section-label">{v.name} · {companies.length} tracked</div>
              {v.description && (
                <p className="text-xs" style={{ color: 'var(--faint-ink)', marginBottom: 8 }}>{v.description}</p>
              )}
              {companies.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>None tracked in this vertical yet.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
                  {companies.map((c) => (
                    <Link
                      key={c.id}
                      href={`/scout/${c.id}`}
                      className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-2"
                      style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)', textDecoration: 'none' }}
                    >
                      <span className="flex items-baseline gap-2">
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15.5 }}>{c.name}</span>
                        {c.domain && (
                          <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{c.domain}</span>
                        )}
                      </span>
                      {c.one_liner && <span className="text-sm" style={{ color: 'var(--dim)' }}>{c.one_liner}</span>}
                      {c.ai_tech && (
                        <span className="text-xs" style={{ color: 'var(--dim)', flex: 1 }}>
                          <span style={{ color: 'var(--faint-ink)' }}>AI tech: </span>
                          {c.ai_tech.length > 160 ? `${c.ai_tech.slice(0, 160)} …` : c.ai_tech}
                        </span>
                      )}
                      <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                        {COMPANY_STAGE_LABEL[c.stage]}
                        {c.founded_year ? ` · founded ${c.founded_year}` : ''}
                        {c.hq ? ` · ${c.hq}` : ''}
                        {c.reviewed_at ? ` · tracked ${timeAgo(c.reviewed_at)}` : ''}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </section>
    </>
  );
}
