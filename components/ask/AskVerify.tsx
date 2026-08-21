'use client';

import type { VerifyReport } from '@/lib/ask/deep';

// The verification strip under an assistant answer: one summary line, then a
// flag line per problem. Verdicts are shown, never silently applied (the
// verifier is itself a model; only the quote/figure layer is deterministic).
// When web search ran this turn (report.webSearched), missing quotes and
// figures may live in web content the deterministic layer cannot see, so those
// lines soften to informational instead of flagging.
export default function AskVerify({ report }: { report: VerifyReport }) {
  const parts: string[] = [];
  if (report.checked === undefined) {
    parts.push('record cross-check unavailable');
  } else if (report.checked === 0) {
    parts.push('no citation-bearing statements to check');
  } else {
    parts.push(`${Math.max(0, report.checked - report.flags.length)} of ${report.checked} cited statements supported`);
  }
  if (report.quotesChecked > 0) {
    parts.push(`${report.quotesChecked - report.quotesMissing.length}/${report.quotesChecked} quotes found in records`);
  }
  if (report.numbersChecked > 0) {
    parts.push(`${report.numbersChecked - report.numbersMissing.length}/${report.numbersChecked} figures found in records`);
  }
  const verdicts = report.verdictLanguage ?? [];
  const web = report.webSearched === true;
  const flagged =
    report.flags.length > 0 ||
    verdicts.length > 0 ||
    (!web && (report.quotesMissing.length > 0 || report.numbersMissing.length > 0));

  return (
    <div className={`ask-verify${flagged ? ' ask-verify--flagged' : ''}`}>
      <p className="ask-verify-line">verification: {parts.join(' · ')}</p>
      {report.flags.map((f, i) => (
        <p key={`f${i}`} className="ask-verify-flag">
          ! &quot;{f.excerpt}&quot;: {f.issue}
        </p>
      ))}
      {verdicts.map((v, i) => (
        <p key={`v${i}`} className="ask-verify-flag">
          ! verdict language, the Atlas maps the debate and the reader judges: &quot;{v}&quot;
        </p>
      ))}
      {report.quotesMissing.map((t, i) => (
        <p key={`q${i}`} className={web ? 'ask-verify-soft' : 'ask-verify-flag'}>
          ! quote not found in the records{web ? ' (web search ran; it may be web-sourced)' : ''}: &quot;{t.length > 90 ? `${t.slice(0, 90)} ...` : t}&quot;
        </p>
      ))}
      {report.numbersMissing.map((n, i) => (
        <p key={`n${i}`} className={web ? 'ask-verify-soft' : 'ask-verify-flag'}>
          ! figure not found in the records{web ? ' (web search ran; it may be web-sourced)' : ''}: {n}
        </p>
      ))}
    </div>
  );
}
