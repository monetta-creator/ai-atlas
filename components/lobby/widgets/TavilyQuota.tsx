import Link from 'next/link';
import { getTavilyQuota } from '@/lib/data';

export default async function TavilyQuota() {
  let quota: Awaited<ReturnType<typeof getTavilyQuota>>;
  try {
    quota = await getTavilyQuota();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  const pct = Math.min(100, Math.round(quota.pctUsed * 100));
  const warn = quota.pctUsed >= 0.85 || quota.capHit;
  return (
    <>
      <div className="lw-head">Tavily quota</div>
      <div className="lw-big">{quota.used} / {quota.cap}</div>
      <div className="lw-bar">
        <div style={{ width: `${pct}%`, background: warn ? 'var(--heat-4)' : 'var(--supports)' }} />
      </div>
      <div className="lw-sub">
        projected {quota.projected} this month
        {quota.projected > quota.cap ? ' · over the cap' : ''}
      </div>
      <Link href="/intel" className="lw-foot">Intel desk →</Link>
    </>
  );
}
