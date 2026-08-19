import Link from 'next/link';
import type { QuestionStats } from '@/lib/types';
import { timeAgo, LENS_LABEL } from '@/lib/format';

export default function QuestionCard({ q, admin }: { q: QuestionStats; admin: boolean }) {
  return (
    <Link href={`/q/${q.slug}`} className="qcard">
      <div className="qcode">
        Q{q.sort_order}
        {q.primary_lens && <span className="lens">· lens: {LENS_LABEL[q.primary_lens]}</span>}
      </div>
      <h3>{q.title}</h3>
      {q.summary && <p className="blurb">{q.summary}</p>}
      <div className="qstats">
        {q.claim_count} claims <span className="dot" /> {q.stance_count} stances
        {q.evidence_count > 0 && (
          <>
            <span className="dot" /> {q.evidence_count} evidence
          </>
        )}
        {admin && (
          <>
            <span className="dot" />
            <span className="contested">{q.contested_count} contested</span>
            <span className="moved">{timeAgo(q.last_moved)}</span>
          </>
        )}
      </div>
    </Link>
  );
}
