import Link from 'next/link';
import { SIGNAL_LENS_LABEL, signalLensColor, formatDateRange } from '@/lib/format';
import type { Report } from '@/lib/types';
import ReportDisclaimer from './ReportDisclaimer';

// Public, read-only render of a saved report (the /reports/[id] view the home page links to).
// Server component — no editing, no client JS. HTML is sanitized at the page boundary; we
// still strip a leading heading so the section title isn't duplicated (mirrors the PDF).
const stripLeadingHeading = (html: string) => html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');

function Prose({ html }: { html: string }) {
  return <div className="report-prose" dangerouslySetInnerHTML={{ __html: stripLeadingHeading(html) }} />;
}

export default function ReportReadView({ title, report }: { title: string; report: Report }) {
  const { narrative, range, lenses, generatedAt, touches } = report;
  const when = generatedAt.slice(0, 10);
  const lensesWithContent = lenses.filter((l) => narrative.perLens[l]);
  // Creative editorial title leads (large); the report name + date + generated go in the
  // byline beneath. Legacy auto-titles ("AI Atlas — <range>") fall back to the name as the
  // headline so older reports still read cleanly.
  const creative = title && !title.startsWith('AI Atlas') ? title : '';
  const headline = creative || `AI Atlas Report - ${formatDateRange(range.from, range.to)}`;
  const byline = creative
    ? `AI Atlas Report · ${formatDateRange(range.from, range.to)} · generated ${when}`
    : `Generated ${when}`;

  return (
    <article className="flex flex-col gap-2">
      <header style={{ marginBottom: 8 }}>
        <h1 style={{ fontFamily: 'var(--font-headline)', fontWeight: 400, fontSize: 'clamp(30px,5vw,46px)', margin: '0 0 6px', color: 'var(--ink)', lineHeight: 1.05, letterSpacing: '0.005em' }}>
          {headline}
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--faint-ink)' }}>{byline}</p>
      </header>

      {narrative.macroSurvey && (
        <section style={{ marginTop: 12 }}>
          <div className="section-label">Period summary</div>
          <Prose html={narrative.macroSurvey} />
        </section>
      )}

      {/* The per-lens callouts, gathered as a 3×2 grid (one per lens). */}
      {lensesWithContent.length > 0 && (
        <div className="callout-grid" style={{ marginTop: 16 }}>
          {lensesWithContent.map((l) => {
            const c = narrative.callouts[l];
            return (
              <div key={l} className="callout-box">
                <div className="callout-box-lens">{SIGNAL_LENS_LABEL[l]}</div>
                <div className="callout-box-text">{c && c.trim() ? c : '–'}</div>
              </div>
            );
          })}
        </div>
      )}

      {narrative.claimsRecap && (
        <section style={{ marginTop: 22 }}>
          <div className="section-label">Claims recap</div>
          <Prose html={narrative.claimsRecap} />
        </section>
      )}

      {lensesWithContent.map((l) => (
        <section key={l} style={{ marginTop: 22 }}>
          <div className="section-label" style={{ color: signalLensColor(l) }}>{SIGNAL_LENS_LABEL[l]}</div>
          <Prose html={narrative.perLens[l] as string} />
        </section>
      ))}

      {touches.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-label">Claims &amp; bridge-claims touched ({touches.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--dim)', fontSize: 14, lineHeight: 1.6 }}>
            {touches.map((t) => (
              <li key={t.code} style={{ margin: '3px 0' }}>
                {t.href && t.href !== '#'
                  ? <Link href={t.href} style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{t.code}</Link>
                  : <span style={{ fontFamily: 'var(--font-mono)' }}>{t.code}</span>}
                {' · '}<span style={{ color: 'var(--ink)' }}>{t.statement}</span>{' '}
                ({t.signal_count} signal{t.signal_count === 1 ? '' : 's'})
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReportDisclaimer variant="screen" />
    </article>
  );
}
