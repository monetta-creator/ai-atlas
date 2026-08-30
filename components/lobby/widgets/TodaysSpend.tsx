import Link from 'next/link';
import { getSpendWidgetData } from '@/lib/data';

// Whole-dollar-ish past $10: a $3.14 today reads finely, a $187 month-to-date
// doesn't need the cents.
function usd(n: number): string {
  return n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n)}`;
}

export default async function TodaysSpend() {
  let spend: Awaited<ReturnType<typeof getSpendWidgetData>>;
  try {
    spend = await getSpendWidgetData();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  return (
    <>
      <div className="lw-head">Today’s spend</div>
      <div className="lw-big">${spend.todayUsd.toFixed(2)}</div>
      <div className="lw-sub">today</div>
      <div className="lw-sub">month to date · {usd(spend.monthToDateUsd)}</div>
      <div className="lw-sub">30-day forecast · {usd(spend.forecast30Usd)}</div>
      <Link href="/costs" className="lw-foot">AI costs →</Link>
    </>
  );
}
