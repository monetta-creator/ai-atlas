import Link from 'next/link';
import { getLatestEdition } from '@/lib/data/editions';
import { dateLabel } from '@/lib/format';

// The Daily Edition's top story on the lobby (span 2). Guest-safe by
// construction: the edition pack/narrative is guest-safe already (no admin
// gate on /blotter), so this widget needs no viewer check.
export default async function EditionFront({}: { personal: boolean }) {
  let edition: Awaited<ReturnType<typeof getLatestEdition>>;
  try {
    edition = await getLatestEdition(true);
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  const front = edition?.narrative?.front ?? [];
  if (!edition || front.length === 0) {
    return (
      <>
        <div className="lw-head">Today&rsquo;s edition</div>
        <p className="lw-sub">No edition yet today.</p>
        <Link href="/blotter/archive" className="lw-foot">Browse past editions →</Link>
      </>
    );
  }
  const [lead, ...rest] = front;
  const leadHref = `/blotter/${edition.day}#front-0`;
  return (
    <>
      <div className="lw-head">Today&rsquo;s edition · {dateLabel(edition.day)}</div>
      <div className="lw-ed-lead">
        <Link href={leadHref} className="lw-ed-headline">{lead.headline}</Link>
        {lead.why && <p className="lw-ed-why">{lead.why}</p>}
        {lead.numbers && <p className="lw-ed-numbers">{lead.numbers}</p>}
      </div>
      {rest.length > 0 && (
        <ul className="lw-ed-more">
          {rest.slice(0, 3).map((f, i) => (
            <li key={f.clusterId || f.headline}>
              <Link href={`/blotter/${edition.day}#front-${i + 1}`}>{f.headline}</Link>
            </li>
          ))}
        </ul>
      )}
      <Link href="/blotter" className="lw-foot">Read the paper →</Link>
    </>
  );
}
