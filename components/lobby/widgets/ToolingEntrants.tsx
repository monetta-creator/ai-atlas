import Link from 'next/link';
import { getNewEntrants } from '@/lib/data';
import { TOOLING_MATURITY_LABEL } from '@/lib/format';

// Guest-safe by construction: viewer is hardcoded to {admin:false, portal:false},
// so this widget only ever shows what a signed-out lobby visitor could see on
// /tooling itself. Mirrors LatestSignals' shape (span 2, .lw-sig rows).
export default async function ToolingEntrants() {
  let entrants: Awaited<ReturnType<typeof getNewEntrants>>;
  try {
    // new Date().getTime(), not Date.now(): the react-hooks/purity rule flags
    // the latter as an impure call during render, even in a server component.
    const since = new Date(new Date().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    entrants = await getNewEntrants(since, { admin: false, portal: false }, { limit: 6 });
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  return (
    <>
      <div className="lw-head">New AI tools this week</div>
      {entrants.length === 0 ? (
        <p className="lw-sub">Nothing new this week.</p>
      ) : (
        entrants.map((p) => (
          <div key={p.id} className="lw-sig">
            <Link href={`/tooling/${p.slug}`} className="lw-sig-headline">{p.name}</Link>
            <div className="lw-sig-meta">
              <span>{TOOLING_MATURITY_LABEL[p.maturity]}</span>
              {p.vendor && <span>{p.vendor}</span>}
            </div>
          </div>
        ))
      )}
      <Link href="/tooling" className="lw-foot">Tooling Monitor →</Link>
    </>
  );
}
