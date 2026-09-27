import Link from 'next/link';
import { getSpendByFeature } from '@/lib/data/costs';
import { getOpsStatus, getOpsBackground } from '@/lib/data/ops';
import { money } from './shared';

// 'ops-spend': the last 7 days of spend by feature, then today's spend
// against each engine's own budget cap, plus the embed cap.
export default async function OpsSpend() {
  let rows: Awaited<ReturnType<typeof getSpendByFeature>>;
  let status: Awaited<ReturnType<typeof getOpsStatus>>;
  let background: Awaited<ReturnType<typeof getOpsBackground>>;
  try {
    [rows, status, background] = await Promise.all([getSpendByFeature(7), getOpsStatus(), getOpsBackground()]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }

  const maxUsd = rows.length ? Math.max(...rows.map((r) => r.usd)) : 0;
  const capped = status.jobs.filter((j) => j.budgetCapUsd != null);

  return (
    <>
      <div className="lw-head">Spend by feature</div>
      <div className="lw-sub">last 7 days</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        {rows.map((r) => (
          <div key={r.feature} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ flex: '0 0 130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.feature}</span>
            <div className="lw-bar" style={{ flex: 1, margin: 0 }}>
              <div style={{ width: maxUsd > 0 ? `${Math.max(2, (r.usd / maxUsd) * 100)}%` : '0%', background: 'var(--accent)' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', flex: '0 0 auto' }}>${r.usd.toFixed(2)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="ops-empty">No spend in the last 7 days.</p>}
      </div>

      <div className="lw-head" style={{ marginTop: 14 }}>Today, by cap</div>
      <ul className="ops-notes" style={{ fontSize: 12 }}>
        {capped.map((j) => (
          <li key={j.job.key}>{j.job.label}: {money(j.spendTodayUsd)} of {money(j.budgetCapUsd)}</li>
        ))}
        <li>Embeddings: {money(background.embedSpendUsd)} of {money(background.embedCapUsd)}</li>
      </ul>
      <Link href="/costs" className="lw-foot">AI costs →</Link>
    </>
  );
}
