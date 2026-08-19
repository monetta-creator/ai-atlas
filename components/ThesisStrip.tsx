import Link from 'next/link';
import type { ThesisDeskEntry } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import ThesisDraftBox from '@/components/ThesisDraftBox';

// The /map thesis desk (admin only): every ACTIVE thesis as a card, report or
// not, each linking its workflow page (/theses/[id]: mapping, logic tree, gap
// diagnosis, reports). Guests keep the report-anchored ThesisTracker; this
// component must never render for them (it shows unmapped/no-run working state).
// Styles: the .bs-thesis* block in home.css, hence the .bs wrapper requirement.
export default function ThesisStrip({ entries }: { entries: ThesisDeskEntry[] }) {
  return (
    <div>
      <div className="section-label bs-colhead">
        Theses · the hypotheses you track
        <Link href="/theses">Console →</Link>
      </div>
      <ThesisDraftBox />
      {entries.length === 0 ? (
        <p className="ls-empty">
          No standing theses yet. Type the hypothesis above: the Atlas maps it to claims and
          tracks it from there.
        </p>
      ) : (
        <div className="bs-theses-grid">
          {entries.map((e) => (
            <Link key={e.id} href={`/theses/${e.id}`} className="bs-thesis">
              <span className="bs-tags">
                {e.claim_count > 0
                  ? `${e.claim_count} claim${e.claim_count === 1 ? '' : 's'} mapped`
                  : 'not yet mapped'}
                {e.gap_count > 0 && ` · ${e.gap_count} gap${e.gap_count === 1 ? '' : 's'} flagged`}
                {e.report_count > 0 && e.last_generated_at
                  ? ` · run ${dateLabel(e.last_generated_at) ?? e.last_generated_at.slice(0, 10)}`
                  : ' · no runs yet'}
              </span>
              <span className="bs-thesis-stmt">{e.statement}</span>
              {e.report_count > 0 ? (
                <span className="bs-split" style={{ fontSize: 11 }}>
                  <span className="s">{e.supports} supporting</span>
                  <span className="c">{e.contradicts} contradicting</span>
                  {e.mixed > 0 && <span className="n">{e.mixed} mixed</span>}
                </span>
              ) : (
                <span className="bs-tags" style={{ marginTop: 6 }}>
                  Open to map claims and run the first report
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
