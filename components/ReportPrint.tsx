'use client';

import { createPortal } from 'react-dom';
import { SIGNAL_CONTEXT_LABEL, formatDateRange } from '@/lib/format';
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
  const { narrative, range, contexts, generatedAt, touches, signals } = report;
  const when = `${generatedAt.slice(0, 10)} ${generatedAt.slice(11, 16)} UTC`;
  const dateRange = formatDateRange(range.from, range.to);
  const creative = title && !title.startsWith('Strategy Atlas') ? title : '';
  const headline = creative || `Strategy Atlas Report - ${dateRange}`;
  const contextCount = `${contexts.length} context${contexts.length === 1 ? '' : 's'}`;
  const subText = creative
    ? `Strategy Atlas Report · ${dateRange} · ${contextCount} · generated ${when}`
    : `${contextCount} · generated ${when}`;
  const footer = `Strategy Atlas Report · ${dateRange} · generated ${when}`;

  const contextsWithContent = contexts.filter((c) => narrative.perContext[c]);
  const hasTouches = touches.length > 0;
  const hasSignals = signals.length > 0;
  const hasAppendix = hasTouches || hasSignals;

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

      {/* Summary — page 1: the grid of per-context callouts at the top, then the period
          summary. The page break follows (recap, contexts, appendices, disclaimer). */}
      {contextsWithContent.length > 0 && (
        <div className="print-callout-grid">
          {contextsWithContent.map((c) => {
            const text = narrative.callouts[c];
            return (
              <div key={c} className="print-callout-cell">
                <div className="print-callout-lens">{SIGNAL_CONTEXT_LABEL[c]}</div>
                <div className="print-callout-text">{text && text.trim() ? text : '–'}</div>
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
          <h2 className="print-h">Hypotheses Recap</h2>
          {renderBody(narrative.claimsRecap)}
        </section>
      )}

      {/* Each context on its own page; its name appears once (the model's leading heading is
          stripped, the umbrella header is dropped, and the callout lives on the summary grid). */}
      {contextsWithContent.map((c) => (
        <section key={c} className="print-section print-page">
          <h2 className="print-h">{SIGNAL_CONTEXT_LABEL[c]}</h2>
          {renderBody(narrative.perContext[c] as string)}
        </section>
      ))}

      {hasAppendix && (
        <>
          <section className="print-section print-page">
            <h2 className="print-h">Appendices</h2>

            {hasTouches && (
              <div className="print-appendix">
                <h3 className="print-h3">Hypotheses touched ({touches.length})</h3>
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
