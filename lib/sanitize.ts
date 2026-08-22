import sanitizeHtml from 'sanitize-html';
import type { Report } from './types';

// Narrative HTML sanitization (server-side). The editor's HTML is admin-authored, but it is
// persisted and rendered server-side (the PDF/print path and the public read-only view), so
// clean it at the save boundary AND before any server render: allow only the formatting tags
// the editor produces; drop everything else (scripts, event handlers, etc.); keep relative
// /claim,/bridge links + http(s)/mailto. Callouts are plain text → all tags stripped.
//
// Kept in its own module (no AI-SDK imports) so the public report view can import it without
// pulling lib/report-generate's generation dependencies.
const HTML_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote', 'code'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // relative URLs (internal /claim, /bridge links) are kept by default
};
const cleanHtml = (html: string | null): string | null => (html == null ? null : sanitizeHtml(html, HTML_OPTS));
const cleanText = (text: string | null): string | null =>
  text == null ? null : sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} }).trim();

// Return a copy of the report with every narrative HTML field sanitized and every callout
// reduced to plain text.
export function sanitizeReportNarrative(report: Report): Report {
  const n = report.narrative;
  const perContext: Record<string, string | null> = {};
  for (const k of Object.keys(n.perContext)) perContext[k] = cleanHtml(n.perContext[k]);
  const callouts: Record<string, string | null> = {};
  for (const k of Object.keys(n.callouts)) callouts[k] = cleanText(n.callouts[k]);
  return {
    ...report,
    narrative: { macroSurvey: cleanHtml(n.macroSurvey), claimsRecap: cleanHtml(n.claimsRecap), perContext, callouts },
  };
}

// Thread-synthesis HTML (the research section's living pages): model-written markdown
// is converted server-side and sanitized here at the save boundary AND on render,
// with the same conservative allow-list as report narrative.
export function sanitizeSynthesisHtml(html: string | null): string | null {
  return cleanHtml(html);
}
