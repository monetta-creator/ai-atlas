'use client';

import { createPortal } from 'react-dom';
import { SIGNAL_LENS_LABEL, formatDateRange } from '@/lib/format';
import type { Report } from '@/lib/types';
import ReportDisclaimer from './ReportDisclaimer';

// The print layout. Portaled to <body> and hidden on screen; window.print() prints ONLY
// this (see the @media print rules in components.css). We use the browser's own print
// engine because it is the one path that preserves all CSS formatting AND turns every
// <a href> into a clickable link annotation in the resulting PDF — the primary constraint.
//
// Design system: Arial throughout (bold headers, regular body); #000099 for section
// headers, callout-box backgrounds, links, and dividers; #FFE512 only as a small
// decorative shape; callout boxes = #000099 bg + white bold centered text; black on white;
// a footer (title · range · generated) repeats on every page via position:fixed. Sections
// with no content are omitted entirely.

const pct = (r: number | null) => (r === null ? '–' : `${Math.round(r * 100)}%`);

// Make internal root-relative links absolute so they're clickable in the exported PDF
// (a PDF has no base URL). External https links are already absolute and untouched.
const absolutize = (html: string, origin: string) => html.replace(/href="\//g, `href="${origin}/`);

// Drop a leading heading the model may have emitted (e.g. "## Market & Valuation") so the
// section/lens title — which the app renders once — isn't duplicated. New generations omit
// it (prompt-instructed); this also cleans already-saved reports.
const stripLeadingHeading = (html: string) => html.replace(/^\s*<h[1-3]\b[^>]*>[\s\S]*?<\/h[1-3]>\s*/i, '');

export default function ReportPrint({ report, title }: { report: Report; title: string }) {
  // Client-only (portal target is <body>). ReportPrint is only rendered after generation,
  // which is client-side, so this guard just keeps it inert during any SSR pass.
  if (typeof document === 'undefined') return null;

  const origin = window.location.origin;
  const { narrative, range, lenses, generatedAt, metrics, touches, signals } = report;
  const when = `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 16)} UTC`;
  const dateRange = formatDateRange(range.from, range.to);
  const creative = title && !title.startsWith('AI Atlas') ? title : '';
  const headline = creative || `AI Atlas Report - ${dateRange}`;
  const lensCount = `${lenses.length} lens${lenses.length === 1 ? '' : 'es'}`;
  const subText = creative
    ? `AI Atlas Report · ${dateRange} · ${lensCount} · generated ${when}`
    : `${lensCount} · generated ${when}`;
  const footer = `AI Atlas Report · ${dateRange} · generated ${when}`;

  const lensesWithContent = lenses.filter((l) => narrative.perLens[l]);
  const hasPipeline = metrics.overall.counts.candidates > 0;
  const hasTouches = touches.length > 0;
  const hasSignals = signals.length > 0;
  const hasAppendix = hasPipeline || hasTouches || hasSignals;

  // Plain render helper (not a component) — keeps it out of the React component namespace.
  const renderBody = (html: string) => (
    <div className="print-body" dangerouslySetInnerHTML={{ __html: absolutize(stripLeadingHeading(html), origin) }} />
  );

  const content = (
    <div className="report-print">
      {/* Repeats on every printed page */}
      <div className="report-print-footer">{footer}</div>

      <header className="print-header">
        <span className="print-deco" aria-hidden="true" />
        <span className="print-title">{headline}</span>
        <p className="print-sub">{subText}</p>
      </header>

      {/* Summary — page 1: the 3×2 grid of per-lens callouts at the top, then the period
          summary. The page break follows (claims recap, lenses, appendices, disclaimer). */}
      {lensesWithContent.length > 0 && (
        <div className="print-callout-grid">
          {lensesWithContent.map((l) => {
            const c = narrative.callouts[l];
            return (
              <div key={l} className="print-callout-cell">
                <div className="print-callout-lens">{SIGNAL_LENS_LABEL[l]}</div>
                <div className="print-callout-text">{c && c.trim() ? c : '–'}</div>
              </div>
            );
          })}
        </div>
      )}

      {narrative.macroSurvey && (
        <section className="print-section">
          <h2 className="print-h">Period Summary</h2>
          {renderBody(narrative.macroSurvey)}
        </section>
      )}

      {narrative.claimsRecap && (
        <section className="print-section print-page">
          <h2 className="print-h">Claims Recap</h2>
          {renderBody(narrative.claimsRecap)}
        </section>
      )}

      {/* Each lens on its own page; its name appears once (the model's leading heading is
          stripped, the umbrella header is dropped, and the callout lives on the summary grid). */}
      {lensesWithContent.map((l) => (
        <section key={l} className="print-section print-page">
          <h2 className="print-h">{SIGNAL_LENS_LABEL[l]}</h2>
          {renderBody(narrative.perLens[l] as string)}
        </section>
      ))}

      {hasAppendix && (
        <>
          <section className="print-section print-page">
            <h2 className="print-h">Appendices</h2>

            {hasPipeline && (
              <div className="print-appendix">
                <h3 className="print-h3">Discovery pipeline</h3>
                <p className="print-body">
                  Overall: {metrics.overall.counts.candidates} candidates · {metrics.overall.counts.approved} approved ·{' '}
                  {metrics.overall.counts.drafted} drafted · {metrics.overall.counts.published} published · triage pass{' '}
                  {pct(metrics.overall.rates.triagePass)} · analysis conv. {pct(metrics.overall.rates.analysisConversion)} ·{' '}
                  discovery→signal {pct(metrics.overall.rates.discoveryToSignal)} · draft→published{' '}
                  {pct(metrics.overall.rates.draftToPublished)}
                </p>
                <table className="print-table">
                  <thead>
                    <tr><th>Lens</th><th>Candidates</th><th>Approved</th><th>Drafted</th><th>Published</th></tr>
                  </thead>
                  <tbody>
                    {metrics.perLens.map(({ lens, funnel }) => (
                      <tr key={lens}>
                        <td>{SIGNAL_LENS_LABEL[lens]}</td>
                        <td>{funnel.counts.candidates}</td>
                        <td>{funnel.counts.approved}</td>
                        <td>{funnel.counts.drafted}</td>
                        <td>{funnel.counts.published}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {hasTouches && (
              <div className="print-appendix">
                <h3 className="print-h3">Claims &amp; bridge-claims touched ({touches.length})</h3>
                <ul className="print-list">
                  {touches.map((t) => (
                    <li key={t.code}>
                      {t.href && t.href !== '#' ? <a href={`${origin}${t.href}`}>{t.code}</a> : t.code} · {t.statement}{' '}
                      ({t.signal_count} signal{t.signal_count === 1 ? '' : 's'})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasSignals && (
              <div className="print-appendix">
                <h3 className="print-h3">Published signals ({signals.length})</h3>
                <ul className="print-list">
                  {signals.map((s) => (
                    <li key={s.id}>
                      {s.title}
                      {s.source_url ? <> · <a href={s.source_url}>{s.source_title || 'source'}</a></> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </>
      )}

      <ReportDisclaimer variant="print" />
    </div>
  );

  return createPortal(content, document.body);
}
