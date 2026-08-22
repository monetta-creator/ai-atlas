import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import {
  getResearchThreads, getWatchlist, getNotedPapers,
  getTrackedSince, getRecentThreadRevisions, getResearchTouchRollup, getNavCounts,
} from '@/lib/data';
import { timeAgo } from '@/lib/format';
import Header from '@/components/Header';
import ResearchInfo from '@/components/ResearchInfo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research Portal · The AI Atlas' };

// Strip the synthesis HTML down to a plain-text card excerpt.
const excerpt = (html: string, n = 190) => {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)} …` : t;
};

// The Research Portal (public): insights first. What changed in the window, the
// threads as the spine (each with its living-synthesis excerpt), then the
// watchlist and noted shelf. The working console (runs, queue, thread tools,
// history) moved to /research/console on 2026-08-14; admins get a desk strip
// linking there. Leak discipline unchanged: admin-only data is simply never
// fetched for guests, so nothing private reaches the RSC payload.
export default async function ResearchPage() {
  const personal = await isAdmin();

  const [threads, tracked, noted, freshPapers, freshRevisions, touchRollup] = await Promise.all([
    getResearchThreads(), getWatchlist(), getNotedPapers(),
    getTrackedSince(null), getRecentThreadRevisions(null), getResearchTouchRollup(),
  ]);
  const counts = personal ? await getNavCounts() : null;
  const fresh = freshPapers.length + freshRevisions.length;

  return (
    <>
      <Header admin={personal} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead" style={{ paddingBottom: 30 }}>
          <h1 style={{ marginBottom: 10 }}>Research</h1>
          <p className="lede" style={{ marginBottom: 20 }}>
            What the recent AI literature says, and what it changes: living syntheses by
            question, a tracked watchlist, and every paper&apos;s finding one click away.
          </p>
          <nav aria-label="Page sections" className="flex items-center gap-2 flex-wrap">
            {fresh > 0 && <a href="#new" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>New</a>}
            <a href="#threads" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Threads</a>
            {touchRollup.length > 0 && <a href="#map" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Map</a>}
            <a href="#watchlist" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
              Watchlist <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{tracked.length}</span>
            </a>
            {noted.length > 0 && <a href="#noted" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>Noted</a>}
            {personal && (
              <Link href="/research/console" className="touch-chip" style={{ fontSize: 12, padding: '5px 13px' }}>
                Console →
              </Link>
            )}
            <ResearchInfo />
          </nav>
        </header>

        {personal && (
          <div
            className="flex items-center flex-wrap gap-3 rounded-[var(--radius)] border p-3 text-sm"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 22 }}
          >
            <span style={{ color: 'var(--dim)' }}>
              The desk: {counts?.papers ?? 0} paper{(counts?.papers ?? 0) === 1 ? '' : 's'} awaiting review.
            </span>
            <span style={{ marginLeft: 'auto' }} className="flex items-center gap-2">
              <Link href="/research/console" className="btn btn--ghost btn--sm">Open the console →</Link>
              <Link href="/research/digest" className="btn btn--quiet btn--sm">Digest</Link>
            </span>
          </div>
        )}

        {fresh > 0 && (
          <section id="new" style={{ scrollMarginTop: 80, marginBottom: 26 }}>
            <div className="section-label">New this fortnight</div>
            <div className="flex flex-col gap-1">
              {freshRevisions.map((r) => (
                <div
                  key={r.id}
                  className="rounded-[var(--radius)] border p-2.5 text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <div className="flex items-center flex-wrap gap-2">
                    <span style={{ color: 'var(--accent)' }} aria-hidden="true">◆</span>
                    <Link href={`/research/threads/${r.thread_slug}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                      {r.thread_title}
                    </Link>
                    <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>synthesis updated</span>
                    <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                      {timeAgo(r.created_at)}
                    </span>
                  </div>
                  {r.trigger_note && (
                    <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{r.trigger_note}</div>
                  )}
                </div>
              ))}
              {freshPapers.map((p) => (
                <div
                  key={p.id}
                  className="rounded-[var(--radius)] border p-2.5 text-sm"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <div className="flex items-center flex-wrap gap-2">
                    <span style={{ color: 'var(--heat-2)' }} aria-hidden="true">★</span>
                    <Link href={`/research/${p.id}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                      {p.title}
                    </Link>
                    <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>tracked</span>
                    <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                      {p.reviewed_at ? timeAgo(p.reviewed_at) : ''}
                    </span>
                  </div>
                  {p.headline && (
                    <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{p.headline}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="threads" style={{ scrollMarginTop: 80 }}>
          <div className="section-label">Threads · the living syntheses</div>
          {threads.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>No threads yet.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {threads.map((t) => (
                <Link
                  key={t.slug}
                  href={`/research/threads/${t.slug}`}
                  className="rounded-[var(--radius)] border p-[var(--card-pad)] flex flex-col gap-2"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)', textDecoration: 'none' }}
                >
                  <span className="flex items-baseline gap-2">
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15.5 }}>{t.title}</span>
                    {t.status !== 'open' && (
                      <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{t.status}</span>
                    )}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{t.question}</span>
                  <span className="text-sm" style={{ color: 'var(--dim)', flex: 1 }}>
                    {t.synthesis ? excerpt(t.synthesis) : 'No synthesis yet: the thread is gathering papers.'}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                    {t.paper_count ?? 0} paper{(t.paper_count ?? 0) === 1 ? '' : 's'}
                    {t.synthesis ? ` · updated ${timeAgo(t.updated_at)}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {touchRollup.length > 0 && (
          <section id="map" style={{ marginTop: 26, scrollMarginTop: 80 }}>
            <div className="section-label">On the Argument Map · advisory, papers never write evidence</div>
            <div className="flex flex-col gap-1">
              {touchRollup.map((t) => (
                <div
                  key={t.code}
                  className="flex items-baseline flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  {t.href ? (
                    <Link href={t.href} className="hover:underline" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                      [{t.code}]
                    </Link>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>[{t.code}]</span>
                  )}
                  <span style={{ color: 'var(--dim)', flex: 1, minWidth: 240 }}>
                    {t.statement ?? 'no longer on the map'}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                    {t.paper_count} paper{t.paper_count === 1 ? '' : 's'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section id="watchlist" style={{ marginTop: 26, scrollMarginTop: 80 }}>
          <div className="section-label">Watchlist · {tracked.length} tracked</div>
          {tracked.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>Nothing tracked yet.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {tracked.map((p) => {
                // The private review note never renders for guests; the public
                // fallback is the model's headline or nothing.
                const note = p.headline ?? (personal ? p.review_note : null);
                return (
                  <div
                    key={p.id}
                    className="rounded-[var(--radius)] border p-2.5 text-sm"
                    style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                  >
                    <div className="flex items-center flex-wrap gap-2">
                      <span style={{ color: 'var(--heat-2)' }} aria-hidden="true">★</span>
                      <Link href={`/research/${p.id}`} className="hover:underline" style={{ color: 'var(--ink)' }}>
                        {p.title}
                      </Link>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
                        ↗
                      </a>
                      {p.signal_id && (
                        <Link href={`/signals/${p.signal_id}`} className="text-xs hover:underline" style={{ color: 'var(--supports)' }}>
                          signal →
                        </Link>
                      )}
                      <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                        {p.published_at ?? ''}
                      </span>
                    </div>
                    {note && (
                      <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>
                        {note}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {noted.length > 0 && (
          <section id="noted" style={{ marginTop: 26, scrollMarginTop: 80 }}>
            <div className="section-label">Noted · {noted.length}</div>
            <div className="flex flex-col gap-1">
              {noted.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center flex-wrap gap-2 text-sm rounded-[var(--radius)] border p-2.5"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
                >
                  <Link href={`/research/${p.id}`} className="hover:underline" style={{ color: 'var(--dim)' }}>
                    {p.title}
                  </Link>
                  <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                    {p.published_at ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </>
  );
}
