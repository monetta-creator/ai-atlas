import Link from 'next/link';
import { SAVANT_TOC, SAVANT_STRAPLINE } from '@/lib/savant/types';

// What a guest sees for a real issue: the masthead, the strapline, the
// issue's own title, and the fixed table of contents as a numbered list.
// Deliberately takes ONLY the title as a prop: Savant is key-gated because
// its peer-and-market-watch section names the reader organization and its
// industry peers, so nothing else from the pack or the narrative may reach
// this component, even by accident of a wider prop type.
export default function SavantTeaser({ title }: { title: string }) {
  return (
    <div className="sv-wrap">
      <div className="sv-masthead">
        <div>
          <p className="sv-wordmark">THE AI ATLAS</p>
          <p className="sv-signature">Savant</p>
        </div>
      </div>
      <p className="sv-strapline">{SAVANT_STRAPLINE}</p>
      <div className="sv-rule" />

      <h1 className="sv-teaser-title">{title}</h1>

      <p className="sv-toc-head">In this issue</p>
      <ol className="sv-toc">
        {SAVANT_TOC.map((s) => (
          <li key={s.key}>{s.title}</li>
        ))}
      </ol>

      <div className="plate sv-lockplate">
        <p className="sv-lock-head">Read with an access key</p>
        <p className="sv-lock-body">
          Savant names the reader organization and its industry peers, so the full issue needs an access key or the
          admin password. Request one, or see what else the Report Portal has published without a key.
        </p>
        <div className="sv-lock-actions">
          <Link href="/datasets/request" className="btn btn--primary btn--sm">Request an access key</Link>
          <Link href="/reports" className="btn btn--quiet btn--sm">Report Portal</Link>
        </div>
      </div>
    </div>
  );
}
