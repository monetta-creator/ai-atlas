// External Scan's pure core: the RSS/Atom feed parser, window filtering, and
// small normalizers. DELIBERATELY dependency-light (no runtime imports) so
// scripts/test-scan.mjs can load it under plain-Node type stripping — keep
// runtime imports out of this module.
//
// The parser is hand-rolled on purpose: the need is narrow (title, link, date
// from well-formed press feeds), node-html-parser mangles XML namespaces, and
// a full XML dependency would be ~60 lines of code traded for a new runtime
// dep. If a real feed defeats it, swap in fast-xml-parser then.

export interface FeedItem {
  title: string;
  url: string;
  publishedISO: string | null; // 'YYYY-MM-DD' precision is all the scan needs
}

// Numeric entities first, then named, &amp; strictly last (so &amp;lt; decodes
// once to &lt; and stops, never double-decoding into a bare '<').
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

// The text content of the first <name>...</name> in a block ('' when absent).
// `name` may carry a namespace prefix (dc:date).
function tagText(block: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  return decodeEntities(stripCdata(m[1]).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// Atom link resolution: prefer rel="alternate" (or a rel-less link) over
// self/enclosure/edit links. Returns '' when no href is found.
function atomHref(block: string): string {
  const links = block.match(/<link\b[^>]*>/gi) ?? [];
  let fallback = '';
  for (const tag of links) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (!href) continue;
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!rel || rel === 'alternate') return decodeEntities(href.trim());
    if (!fallback) fallback = decodeEntities(href.trim());
  }
  return fallback;
}

function parseDateISO(raw: string): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

// RSS 2.0 <item> blocks, else Atom <entry> blocks. Items without an http(s)
// link are dropped; dates that fail to parse become null (withinWindow lets
// null-dated items through — a dupe-checked extra beats a miss).
export function parseFeedXml(xml: string, maxItems = 50): FeedItem[] {
  const src = String(xml ?? '');
  let blocks = src.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  const isAtom = blocks.length === 0;
  if (isAtom) blocks = src.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  const out: FeedItem[] = [];
  for (const block of blocks) {
    if (out.length >= maxItems) break;
    const title = tagText(block, 'title');
    // RSS carries the URL as <link> text; Atom (and mixed feeds) as href attrs.
    const url = (isAtom ? '' : tagText(block, 'link')) || atomHref(block);
    if (!/^https?:\/\//i.test(url)) continue;
    const dateRaw =
      tagText(block, 'pubDate') ||
      tagText(block, 'published') ||
      tagText(block, 'updated') ||
      tagText(block, 'dc:date');
    out.push({
      title: title.slice(0, 500),
      url: url.slice(0, 2000),
      publishedISO: parseDateISO(dateRaw),
    });
  }
  return out;
}

// Window filter for feed items. A null date PASSES: government feeds
// occasionally omit dates, and the normalized-url dedupe already caught
// yesterday's copies of a dateless item.
export function withinWindow(publishedISO: string | null, sinceISO: string): boolean {
  if (!publishedISO) return true;
  return publishedISO >= sinceISO;
}

// Clamp the model's relevance onto numeric(3,2) [0,1]; null for non-numbers
// (schema ranges live in descriptions only — the tool validator rejects
// minimum/maximum on number properties, the 0033 landmine).
export function clamp01(n: unknown): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}

// The next topic the search leg should run: active, has queries, not yet
// checkpointed in searched_topics. Null when the leg is done.
export function nextSearchTopic<T extends { slug: string; active: boolean; search_queries: string[] }>(
  topics: T[],
  searched: string[]
): T | null {
  const done = new Set(searched);
  for (const t of topics) {
    if (t.active && t.search_queries.length > 0 && !done.has(t.slug)) return t;
  }
  return null;
}
