import { redirect } from 'next/navigation';
import { isAdmin } from '@/lib/auth';
import { getTrackedSince, getThreadsUpdatedSince } from '@/lib/data';
import { sanitizeSynthesisHtml } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Research digest · The AI Atlas' };

// Admin-only, not linked in nav (the /signals/digest pattern). A clean, print-friendly
// snapshot of the research picture: papers tracked in the window (with their whys and
// findings) and threads whose living synthesis moved. Accepts ?since=YYYY-MM-DD
// (default: last 14 days). Fully server-rendered.
export default async function ResearchDigestPage({
  searchParams,
}: {
  searchParams: Promise<{ since?: string }>;
}) {
  const admin = await isAdmin();
  if (!admin) redirect('/login');
  const sp = await searchParams;

  // Default window (14 days) resolves in SQL — the react purity rule (correctly)
  // rejects Date.now() during render, even in a server component.
  const since = sp.since && /^\d{4}-\d{2}-\d{2}$/.test(sp.since) ? sp.since : null;

  const [papers, threads] = await Promise.all([
    getTrackedSince(since),
    getThreadsUpdatedSince(since),
  ]);

  return (
    <main className="digest">
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, margin: '0 0 4px', color: 'var(--ink)' }}>
          AI Atlas · Research Digest
        </h1>
        <p style={{ color: 'var(--dim)', fontSize: 13, margin: 0 }}>
          {since ? `since ${since}` : 'last 14 days'} · {papers.length} paper{papers.length === 1 ? '' : 's'} tracked ·{' '}
          {threads.length} thread{threads.length === 1 ? '' : 's'} updated
        </p>
      </header>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, color: 'var(--ink)', margin: '0 0 10px' }}>Tracked papers</h2>
        {papers.length === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 13 }}>Nothing tracked in this window.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {papers.map((p) => (
              <article key={p.id} style={{ breakInside: 'avoid' }}>
                <div style={{ fontSize: 14, color: 'var(--ink)' }}>
                  {p.title}
                  <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 8 }}>
                    {p.arxiv_id ?? 'manual'}{p.published_at ? ` · ${p.published_at}` : ''}
                    {p.citation_count != null ? ` · ${p.citation_count} citations` : ''}
                  </span>
                </div>
                {p.headline && (
                  <p style={{ color: 'var(--dim)', fontSize: 13, margin: '4px 0 0' }}>{p.headline}</p>
                )}
                {p.review_note && (
                  <p style={{ color: 'var(--faint-ink)', fontSize: 12, margin: '2px 0 0' }}>
                    Why tracked: {p.review_note}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 15, color: 'var(--ink)', margin: '0 0 10px' }}>Thread syntheses</h2>
        {threads.length === 0 ? (
          <p style={{ color: 'var(--faint-ink)', fontSize: 13 }}>No synthesis moved in this window.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {threads.map((t) => (
              <article key={t.slug} style={{ breakInside: 'avoid' }}>
                <h3 style={{ fontSize: 14, color: 'var(--ink)', margin: '0 0 2px' }}>{t.title}</h3>
                <p style={{ color: 'var(--faint-ink)', fontSize: 12, margin: '0 0 6px' }}>{t.question}</p>
                <div
                  style={{ color: 'var(--dim)', fontSize: 13, lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: sanitizeSynthesisHtml(t.synthesis) ?? '' }}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
