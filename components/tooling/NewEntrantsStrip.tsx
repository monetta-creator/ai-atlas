import Link from 'next/link';
import { getNewEntrants } from '@/lib/data';
import { TOOLING_MATURITY_LABEL, dateLabel } from '@/lib/format';
import type { ToolingViewer } from '@/lib/types';

// "New this week" on the /tooling hub: cataloged products first seen in the
// last 7 days, self-fetching so the page only has to render <NewEntrantsStrip
// viewer={viewer} />. Hidden entirely (returns null) when there are none.
export default async function NewEntrantsStrip({ viewer }: { viewer: ToolingViewer }) {
  // new Date().getTime(), not Date.now(): the react-hooks/purity rule flags
  // the latter as an impure call during render, even in a server component
  // (see app/research/digest/page.tsx's note on the same landmine).
  const since = new Date(new Date().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const entrants = await getNewEntrants(since, viewer, { limit: 12 });
  if (!entrants.length) return null;
  return (
    <section style={{ marginBottom: 26 }}>
      <div className="section-label">New this week · {entrants.length}</div>
      <div className="flex gap-2.5" style={{ overflowX: 'auto', paddingBottom: 6 }}>
        {entrants.map((p) => (
          <Link
            key={p.id}
            href={`/tooling/${p.slug}`}
            className="rounded-[var(--radius)] border p-2.5"
            style={{
              background: 'var(--surface)', borderColor: 'var(--line)', color: 'var(--ink)',
              textDecoration: 'none', minWidth: 210, flex: '0 0 auto',
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{p.name}</div>
            {p.one_liner && (
              <div className="text-xs" style={{ color: 'var(--dim)', marginTop: 4 }}>{p.one_liner}</div>
            )}
            <div className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
              {TOOLING_MATURITY_LABEL[p.maturity]} · since {dateLabel(p.first_seen)}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
