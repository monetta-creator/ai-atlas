import Link from 'next/link';
import { getRecentSignals } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import { LensBadges, SignificanceTag } from '@/components/SignalBadges';
import type { SignalLens, Significance } from '@/lib/types';

export default async function LatestSignals() {
  let signals: Awaited<ReturnType<typeof getRecentSignals>>;
  try {
    signals = await getRecentSignals(3);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  return (
    <>
      <div className="lw-head">Latest signals</div>
      {signals.length === 0 ? (
        <p className="lw-sub">No published signals yet.</p>
      ) : (
        signals.map((s) => (
          <div key={s.id} className="lw-sig">
            <Link href={`/signals/${s.id}`} className="lw-sig-headline">{s.headline}</Link>
            <div className="lw-sig-meta">
              <LensBadges lenses={s.lenses as SignalLens[]} />
              <SignificanceTag significance={s.significance as Significance} />
              <span>{dateLabel(s.published_on)}</span>
            </div>
          </div>
        ))
      )}
      <Link href="/signals" className="lw-foot">Signal Board →</Link>
    </>
  );
}
