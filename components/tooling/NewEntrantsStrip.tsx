import Link from 'next/link';
import { getNewEntrants } from '@/lib/data';
import { TOOLING_MATURITY_LABEL, dateLabel } from '@/lib/format';
import ProductLogo from './ProductLogo';
import type { ToolingViewer } from '@/lib/types';

// "New this week" on the /tooling hub: cataloged products first seen in the
// last 7 days, self-fetching so the page only has to render <NewEntrantsStrip
// viewer={viewer} reportHref={...} />. Always renders (an explicit empty
// state instead of returning null) so the section head + report link stay
// visible even in a quiet week.
export default async function NewEntrantsStrip({
  viewer, reportHref,
}: {
  viewer: ToolingViewer;
  reportHref?: string | null;
}) {
  // new Date().getTime(), not Date.now(): the react-hooks/purity rule flags
  // the latter as an impure call during render, even in a server component
  // (see app/research/digest/page.tsx's note on the same landmine).
  const since = new Date(new Date().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const entrants = await getNewEntrants(since, viewer, { limit: 12 });
  return (
    <section style={{ marginBottom: 26 }}>
      <div className="tl-strip-head">
        <div className="section-label">New this week · {entrants.length}</div>
        {reportHref && (
          <Link href={reportHref} className="tl-strip-report">This week&apos;s new-entrants report →</Link>
        )}
      </div>
      {entrants.length === 0 ? (
        <p className="tl-empty">Nothing new cataloged in the last 7 days. The next scan runs Monday 07:00 UTC.</p>
      ) : (
        <div className="tl-strip">
          {entrants.map((p) => (
            <Link key={p.id} href={`/tooling/${p.slug}`} className="tl-strip-card">
              <div className="flex items-center gap-2" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>
                <ProductLogo name={p.name} domain={p.vendor_domain} url={p.url} size={22} />
                <span>{p.name}</span>
              </div>
              {p.one_liner && (
                <div className="tl-strip-oneliner text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{p.one_liner}</div>
              )}
              <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                {p.maturity !== 'unknown' ? `${TOOLING_MATURITY_LABEL[p.maturity]} · ` : ''}first seen {dateLabel(p.first_seen)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
