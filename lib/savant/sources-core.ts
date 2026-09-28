// Appendix B of the Savant PDF: the sources the issue actually cites, in the
// order they first appear, each with the words the issue linked (2026-09-28).
// It used to print the first 60 entries of the whole citation allow-list as
// bare URLs, most of them never cited, and a URL has no spaces to break at,
// so long ones ran across the next column and off the page. Pure: tested by
// scripts/test-savant-figures.mjs.

export interface CitedSource {
  href: string;   // as it appears in the issue (absolute, or an Atlas path)
  label: string;  // the linked words, or a readable form of the URL
  host: string;   // "arxiv.org", or "The AI Atlas" for an Atlas path
}

const ANCHOR_RE = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

const decode = (s: string) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

export function hostOf(href: string): string {
  if (href.startsWith('/')) return 'The AI Atlas';
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; }
}

// "arxiv.org/abs/2609.30058": no scheme, no www, no trailing slash.
export function displayUrl(href: string): string {
  return href.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

// A zero-width space after each URL separator gives the PDF line breaker
// (Unicode line-break class ZW) somewhere to wrap; the link target is untouched.
export function breakableUrl(text: string): string {
  return text.replace(/([/.\-_?&=#])/g, '$1​');
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') { if (value.includes('<a')) out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return; }
  if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out);
}

// A label worth printing: not a bare footnote number ("3"), not a bare date
// ("2026-09-24"), not the URL itself.
function weakLabel(label: string, href: string): boolean {
  return !label || label.length < 4 || /^\d{4}-\d{2}-\d{2}$/.test(label) || /^[\d\s.,[\]()]+$/.test(label)
    || /^https?:\/\//.test(label) || label === displayUrl(href);
}

// A readable fallback for a weak label: Atlas paths by record kind, SEC
// documents by filer path, anything else by its readable URL.
export function fallbackLabel(href: string): string {
  const atlas = href.match(/^\/(claim|bridge|q|stance|concepts|signals|research|tooling|scout|reports)\/([^/?#]+)/);
  if (atlas) {
    const [, kind, id] = atlas;
    const names: Record<string, string> = {
      claim: `Claim ${id}`, bridge: `Bridge-claim ${id}`, q: `Question: ${id.replace(/-/g, ' ')}`,
      stance: `Stance ${id}`, concepts: `Concept: ${id.replace(/-/g, ' ')}`, signals: 'Atlas signal',
      research: 'Research paper', tooling: `Tool: ${id.replace(/-/g, ' ')}`, scout: 'Scout company', reports: 'Atlas report',
    };
    return names[kind];
  }
  if (/sec\.gov\/Archives\/edgar/.test(href)) return 'SEC filing';
  return displayUrl(href);
}

// Every link in the narrative that the citation gate would keep, once each, in
// order of first appearance, labeled with the most informative words the
// issue linked it with (a later mention can upgrade a footnote-number label),
// else a readable fallback. Labels are capped for the two-column layout.
export function collectCitedSources(narrative: unknown, allowed: Set<string>, max = 200): CitedSource[] {
  const strings: string[] = [];
  collectStrings(narrative, strings);
  const byHref = new Map<string, CitedSource>();
  for (const html of strings) {
    for (const m of html.matchAll(ANCHOR_RE)) {
      const href = decode(m[1]);
      if (!allowed.has(href)) continue;
      let label = decode(m[2]);
      if (label.length > 140) label = `${label.slice(0, 139).trimEnd()}…`;
      const prev = byHref.get(href);
      if (prev) {
        if (weakLabel(prev.label, href) && !weakLabel(label, href)) prev.label = label;
        continue;
      }
      if (byHref.size >= max) continue;
      byHref.set(href, { href, label, host: hostOf(href) });
    }
  }
  return [...byHref.values()].map((src) => (weakLabel(src.label, src.href) ? { ...src, label: fallbackLabel(src.href) } : src));
}
