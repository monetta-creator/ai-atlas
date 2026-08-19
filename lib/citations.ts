import sanitizeHtml from 'sanitize-html';

// The generic citation gate: the deterministic backstop between model prose and a
// rendered report. A grounded narrative may link ONLY into its own frozen pack;
// any other href (an invented URL, a claim outside the pack, a hallucinated
// signal) is stripped to plain text and recorded in the audit, never rendered as
// a link. Extracted from lib/thesis/citations.ts (2026-08-13) so the tear-sheet
// generators share the exact same enforcement; the thesis module now builds on
// this. Runs at generation time AND again at the save/render boundaries.

const HTML_OPTS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote', 'code'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedSchemes: ['http', 'https'],
};

export interface CitationAllowlist {
  hrefs: Set<string>;
  tagByHref: Map<string, string>;   // '/signals/<id>' -> 'S3'
}

export function enforceCitations(
  html: string | null,
  allow: CitationAllowlist
): { html: string | null; cited: string[]; dropped: string[] } {
  if (html == null) return { html: null, cited: [], dropped: [] };
  const cited = new Set<string>();
  const dropped = new Set<string>();
  const clean = sanitizeHtml(html, {
    ...HTML_OPTS,
    transformTags: {
      a: (tagName, attribs): sanitizeHtml.Tag => {
        const href = attribs.href ?? '';
        if (!allow.hrefs.has(href)) {
          dropped.add(href || '(no href)');
          return { tagName: 'span', attribs: {} };
        }
        const tag = allow.tagByHref.get(href);
        if (tag) cited.add(tag);
        const out: Record<string, string> = { href };
        if (/^https?:\/\//.test(href)) {
          out.target = '_blank';
          out.rel = 'noopener';
        }
        return { tagName: 'a', attribs: out };
      },
    },
  });
  return { html: clean, cited: [...cited], dropped: [...dropped] };
}

export const byTagNumber = (a: string, b: string) =>
  Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b);
