import Link from 'next/link';
import type { ThesisTrackerEntry } from '@/lib/data';
import { dateLabel } from '@/lib/format';

// The thesis tracker (front page, under the lead story): the latest saved run per
// standing thesis, as broadsheet entries — thesis statement as the headline, the
// deterministic stance stats beneath, each linking to its public report. Guest-safe
// (everything shown is from the public report itself). Renders nothing until a
// thesis report exists. Styles: .bs-thesis* in app/styles/home.css.
export default function ThesisTracker({ entries, admin }: { entries: ThesisTrackerEntry[]; admin: boolean }) {
  if (!entries.length) return null;
  return (
    <div>
      <div className="section-label bs-colhead">
        Thesis tracker
        {admin && <Link href="/theses">Theses →</Link>}
      </div>
      <div className="bs-theses-grid">
        {entries.map((e) => (
          <Link key={e.report_id} href={`/thesis-report/${e.report_id}`} className="bs-thesis">
            <span className="bs-tags">
              Updated {dateLabel(e.generated_at) ?? e.generated_at.slice(0, 10)} · {e.matched} signals matched
            </span>
            <span className="bs-thesis-stmt">{e.statement}</span>
            <span className="bs-split" style={{ fontSize: 11 }}>
              <span className="s">{e.supports} supporting</span>
              <span className="c">{e.contradicts} contradicting</span>
              {e.mixed > 0 && <span className="n">{e.mixed} mixed</span>}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
