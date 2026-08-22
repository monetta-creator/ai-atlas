import Link from 'next/link';
import type { TopHypothesis } from '@/lib/types';
import { convictionText, heatVar } from '@/lib/format';

// The hypothesis ledger (Console Broadsheet, left column): hypotheses ranked by
// attached evidence as ruled rows — mono code, bold statement, big headline figure
// with the direction split beneath. Evidence counts are public; the conviction word
// is admin-only (already stripped via `personal`). Styles: .bs-row* in home.css.
const trunc = (s: string, n = 96) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function TopHypothesesPanel({ hypotheses, personal }: { hypotheses: TopHypothesis[]; personal: boolean }) {
  return (
    <div className="bs-col" style={{ minWidth: 0 }}>
      <div className="section-label bs-colhead">
        Most-evidenced hypotheses
        <Link href="/map">The board →</Link>
      </div>
      {hypotheses.length === 0 ? (
        <p className="ls-empty">No evidence attached to any hypothesis yet.</p>
      ) : (
        <ol className="bs-list">
          {hypotheses.map((c) => (
            <li key={c.id}>
              <Link href={`/hypothesis/${encodeURIComponent(c.code)}`} className="bs-row">
                <span className="bs-code">{c.code}</span>
                <span className="bs-rowbody">
                  <span className="bs-rowhed">{trunc(c.statement)}</span>
                  <span className="bs-tags">
                    {personal && c.conviction_label && (
                      <span style={{ color: heatVar(c.conviction_label) }}>{convictionText(c.conviction_label)}</span>
                    )}
                  </span>
                </span>
                <span
                  className="bs-fig"
                  title={`${c.supports} support · ${c.contradicts} contradict · ${c.neutral} neutral`}
                >
                  <span className="bs-fig-n">{c.evidence_count}</span>
                  <span className="bs-split">
                    <span className="s">{c.supports}</span>
                    <span className="c">{c.contradicts}</span>
                    <span className="n">{c.neutral}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
