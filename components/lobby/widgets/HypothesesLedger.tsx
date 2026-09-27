import Link from 'next/link';
import { getOpenHypotheses, getCompanyNameMap } from '@/lib/data/savant';
import { getPortalIdentity } from '@/lib/portal/identity';
import { buildNameMatcher, scrubSentences } from '@/lib/embed/report-sections';
import { dateLabel } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = { open: 'Open', strengthened: 'Strengthened', weakened: 'Weakened' };

// Savant's open hypotheses, statement only, never a reading or a verdict
// (those name tracked companies and are the ledger's private working
// detail). Statements are model-written from a pack that may name the
// reader organization's peers, so every statement is scrubbed for anyone
// who is not admin or an active keyholder, same rule as the teaser pages.
export default async function HypothesesLedger({}: { personal: boolean }) {
  let rows: Awaited<ReturnType<typeof getOpenHypotheses>>;
  let unlocked = false;
  try {
    const [hyps, names, identity] = await Promise.all([
      getOpenHypotheses(),
      getCompanyNameMap(),
      getPortalIdentity(),
    ]);
    rows = hyps;
    unlocked = identity.tier === 'admin' || identity.active;
    if (!unlocked) {
      const re = buildNameMatcher([...names.values()]);
      rows = rows
        .map((h) => ({ ...h, statement: scrubSentences(h.statement, re).text }))
        .filter((h) => h.statement.length > 0);
    }
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  const shown = rows.slice(0, 4);
  return (
    <>
      <div className="lw-head">Open hypotheses</div>
      {shown.length === 0 ? (
        <p className="lw-sub">Savant has no open hypotheses right now.</p>
      ) : (
        <ul className="lw-hyp-list">
          {shown.map((h) => (
            <li key={h.id} className="lw-hyp-item">
              <span className={`lw-hyp-chip lw-hyp-chip--${h.status}`}>{STATUS_LABEL[h.status] ?? h.status}</span>
              <p className="lw-hyp-statement">{h.statement}</p>
              <span className="lw-hyp-posed">posed week of {dateLabel(h.posed_week)}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/savant" className="lw-foot">How Savant works →</Link>
    </>
  );
}
