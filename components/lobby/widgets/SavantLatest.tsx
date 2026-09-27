import Link from 'next/link';
import { listSavantIssueMetas } from '@/lib/data/savant-issues';
import { toSheetCard } from '@/lib/reports/cards';
import ReportCover from '@/components/reports/ReportCover';
import { getPortalIdentity } from '@/lib/portal/identity';

// The latest published Savant issue's cover, teased for everyone and linked
// through for a keyholder or admin. Guest-safe: listSavantIssueMetas(true)
// only ever returns published issues, and the cover card carries no company
// names (Savant's own scrub happens before publish).
export default async function SavantLatest({}: { personal: boolean }) {
  let metas: Awaited<ReturnType<typeof listSavantIssueMetas>>;
  let unlocked = false;
  try {
    [metas, unlocked] = await Promise.all([
      listSavantIssueMetas(true),
      getPortalIdentity().then((identity) => identity.tier === 'admin' || identity.active),
    ]);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  const meta = metas[0];
  if (!meta) {
    return (
      <>
        <div className="lw-head">Latest Savant issue</div>
        <p className="lw-sub">The first issue lands on a Friday.</p>
      </>
    );
  }
  const card = toSheetCard(meta);
  const href = unlocked ? card.href : '/savant';
  return (
    <>
      <div className="lw-head">Latest Savant issue</div>
      <Link href={href} className="lw-sv-cover">
        <div className="lw-sv-coverbox"><ReportCover card={card} /></div>
      </Link>
      <Link href={href} className="lw-sv-title">{card.title}</Link>
      <div className="lw-sub">{card.metaLines[0]} · {card.subject}</div>
      {!unlocked && <p className="lw-sub">Reading it needs an access key.</p>}
    </>
  );
}
