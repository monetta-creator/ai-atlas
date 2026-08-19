import Link from 'next/link';
import type { TopClaim } from '@/lib/types';
import { DOMAIN_LABEL, confidenceText, heatVar } from '@/lib/format';

// The claims ledger (Console Broadsheet, left column): claims ranked by attached
// evidence as ruled rows — mono code, bold statement, big headline figure with the
// direction split beneath. Evidence counts are public; the confidence word is
// admin-only (already stripped via `personal`). Styles: .bs-row* in home.css.
const trunc = (s: string, n = 96) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export default function TopClaimsPanel({ claims, personal }: { claims: TopClaim[]; personal: boolean }) {
  return (
    <div className="bs-col" style={{ minWidth: 0 }}>
      <div className="section-label bs-colhead">
        Most-evidenced claims
        <Link href="/map">The map →</Link>
      </div>
      {claims.length === 0 ? (
        <p className="ls-empty">No evidence attached to any claim yet.</p>
      ) : (
        <ol className="bs-list">
          {claims.map((c) => (
            <li key={c.id}>
              <Link href={`/claim/${encodeURIComponent(c.code)}`} className="bs-row">
                <span className="bs-code">{c.code}</span>
                <span className="bs-rowbody">
                  <span className="bs-rowhed">{trunc(c.statement)}</span>
                  <span className="bs-tags">
                    {c.domain && DOMAIN_LABEL[c.domain]}
                    {personal && c.confidence_label && (
                      <>
                        {c.domain && ' · '}
                        <span style={{ color: heatVar(c.confidence_label) }}>{confidenceText(c.confidence_label)}</span>
                      </>
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
