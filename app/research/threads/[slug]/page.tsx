import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getThreadBySlug, getThreadPapers, getThreadRevisions } from '@/lib/data';
import { sanitizeSynthesisHtml } from '@/lib/sanitize';
import { timeAgo } from '@/lib/format';
import Header from '@/components/Header';
import ThreadSynthesisButton from '@/components/ThreadSynthesisButton';
import type { ThreadRelation } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research thread · The Strategy Atlas' };

const RELATION_ORDER: ThreadRelation[] = ['supports', 'contradicts', 'complicates', 'context'];
const RELATION_COLOR: Record<ThreadRelation, string> = {
  supports: 'var(--supports)',
  contradicts: 'var(--heat-4)',
  complicates: 'var(--heat-2)',
  context: 'var(--faint-ink)',
};

// A research thread: the frontier question, its living synthesis (model-maintained,
// admin-triggered, every rewrite preserved), and its papers grouped by relation.
// Public read-only since the lobby redesign: the synthesis and paper groupings are
// publishable; the update button, placement rationales, and revision trail stay admin.
export default async function ThreadPage({ params }: { params: Promise<{ slug: string }> }) {
  const personal = await isAdmin();

  const { slug } = await params;
  const thread = await getThreadBySlug(slug.toLowerCase());
  if (!thread) notFound();

  const [papers, revisions] = await Promise.all([
    getThreadPapers(thread.id),
    getThreadRevisions(thread.id),
  ]);

  return (
    <>
      <Header admin={personal} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <p style={{ marginBottom: 12 }}>
          <Link href="/research" className="text-xs hover:underline" style={{ color: 'var(--faint-ink)' }}>
            ← Research
          </Link>
        </p>

        <header style={{ marginBottom: 20 }}>
          <h1 style={{ marginBottom: 8 }}>{thread.title}</h1>
          <p className="text-sm" style={{ color: 'var(--dim)', margin: 0 }}>{thread.question}</p>
        </header>

        {personal && (
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)', marginBottom: 8 }}>
            <ThreadSynthesisButton slug={thread.slug} status={thread.status} paperCount={papers.length} />
          </div>
        )}

        <section style={{ marginTop: 8 }}>
          <div className="section-label">
            Living synthesis{thread.synthesis ? ` · updated ${timeAgo(thread.updated_at)}` : ''}
          </div>
          <div className="rounded-[var(--radius)] border p-[var(--card-pad)]"
            style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
            {thread.synthesis ? (
              <div
                className="prose-thread text-sm"
                style={{ color: 'var(--ink)', lineHeight: 1.65 }}
                // Sanitized at the save boundary AND re-sanitized here on render.
                dangerouslySetInnerHTML={{ __html: sanitizeSynthesisHtml(thread.synthesis) ?? '' }}
              />
            ) : (
              <p className="text-sm" style={{ color: 'var(--faint-ink)', margin: 0 }}>
                No synthesis yet. Place papers in this thread, then click Update synthesis.
              </p>
            )}
          </div>
        </section>

        <section style={{ marginTop: 8 }}>
          <div className="section-label">Papers · {papers.length}</div>
          {papers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
              Nothing placed yet. Confirm thread placements from a paper page.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {RELATION_ORDER.filter((rel) => papers.some((p) => p.relation === rel)).map((rel) => (
                <div key={rel}>
                  <div className="text-xs" style={{
                    color: RELATION_COLOR[rel], fontFamily: 'var(--font-mono)',
                    textTransform: 'uppercase', letterSpacing: '0.08em', margin: '8px 0 6px',
                  }}>
                    {rel}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {papers.filter((p) => p.relation === rel).map((p) => (
                      <div key={p.id} className="rounded-[var(--radius)] border p-3"
                        style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <Link href={`/research/${p.id}`} className="text-sm hover:underline" style={{ color: 'var(--ink)' }}>
                            {p.title}
                          </Link>
                          <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                            {p.published_at ?? ''}
                            {p.review_status === 'tracked' ? ' · ★' : ''}
                          </span>
                        </div>
                        {(p.headline ?? (personal ? p.why : null)) && (
                          <p className="text-xs" style={{ color: 'var(--dim)', margin: '4px 0 0' }}>
                            {p.headline ?? p.why}
                          </p>
                        )}
                        {p.effect && (
                          <p className="text-xs" style={{ color: 'var(--faint-ink)', margin: '2px 0 0' }}>
                            {p.effect}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {personal && revisions.length > 1 && (
          <section style={{ marginTop: 8 }}>
            <div className="section-label">Revision history · {revisions.length}</div>
            <div className="flex flex-col gap-1">
              {revisions.map((r, i) => (
                <details key={r.id} className="rounded-[var(--radius)] border p-2.5 text-xs"
                  style={{ background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--dim)' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {i === 0 ? 'current' : timeAgo(r.created_at)}
                    {r.trigger_note ? ` · ${r.trigger_note}` : ''}
                  </summary>
                  <div
                    className="text-xs" style={{ marginTop: 8, lineHeight: 1.6 }}
                    dangerouslySetInnerHTML={{ __html: sanitizeSynthesisHtml(r.synthesis) ?? '' }}
                  />
                </details>
              ))}
            </div>
          </section>
        )}
      </section>
    </>
  );
}
