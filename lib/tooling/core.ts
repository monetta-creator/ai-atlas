import type { ToolingMaturity, ToolingEventKind, ToolingRunKind, ToolingDossier, RawHit } from '../types';

// The AI Tooling Monitor's pure core: dedupe normalization, feature-tag
// normalization, feed-link discovery, source mappers, the monotone dossier
// merge, hint parsing, and the discovery/checkpoint plan. DELIBERATELY
// dependency-light (type-only imports) so scripts/test-tooling.mjs can load
// it under plain-Node type stripping — keep runtime imports out of this
// module (the lib/scout/core.ts / lib/intel/core.ts convention).

// ---- Dedupe identity ---------------------------------------------------------

// Mirrors tooling_products.name_key exactly
// (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))); keep the two in sync.
export function productNameKey(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// host (no www) + path (no trailing slash, no query, no fragment), lowercased
// host only. Mirrors tooling_products.url_key, which the writer sets at
// insert time (there is no generated-column expression to match against, so
// this IS the single source of truth for that column's shape).
export function productUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '');
    return host ? `${host}${path}` : null;
  } catch {
    return null;
  }
}

// A readable-URL slug from a product name: lowercase, non-alphanumerics to a
// single hyphen, no leading/trailing hyphen. The writer (insertProducts)
// retries with the vendor prefixed, then a numeric suffix, on a conflict.
export function slugify(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The Monday of `date`'s UTC week, as 'YYYY-MM-DD'. A weekly tooling_runs row
// keys on this (kind = 'weekly').
export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

// ---- Feature tags -------------------------------------------------------------

// lowercase, trim, collapse whitespace/common punctuation runs to a single
// space, strip a trailing period, then reject anything too short/long to be
// a real feature tag (a stray fragment) or too long (dumped prose).
export function normalizeFeatureTag(raw: string): string | null {
  let s = String(raw ?? '').toLowerCase().trim();
  s = s.replace(/[\s,;:!?'"()[\]{}]+/g, ' ').trim();
  s = s.replace(/\.+$/, '').trim();
  if (s.length < 3 || s.length > 60) return null;
  return s;
}

// Normalize + dedupe (case/punctuation-insensitive via normalizeFeatureTag)
// while preserving first-seen order, capped.
export function normalizeFeatureTags(list: string[], cap = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const norm = normalizeFeatureTag(raw);
    if (!norm || seen.has(norm) || out.length >= cap) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

// ---- Feed discovery -----------------------------------------------------------

// <link rel="alternate" type="application/rss+xml|atom+xml" href="..."> tags
// anywhere in a homepage's <head> (attribute order independent), resolved
// against the page's URL and deduped. Used by lib/tooling/finish.ts to find a
// product's changelog/RSS feed from its raw homepage fetch.
export function discoverFeedLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const tags = String(html ?? '').match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!rel.split(/\s+/).includes('alternate')) continue;
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!/^application\/(rss|atom)\+xml$/.test(type)) continue;
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (!href) continue;
    let resolved: string;
    try {
      resolved = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

// ---- Source mappers (tolerant of missing/odd fields; never throw) ------------

// HN Algolia search hits. A Show HN / Ask HN text post has no `url`; it maps
// to the HN item page itself so the candidate still has somewhere to point.
export function mapHnHits(hits: unknown[]): RawHit[] {
  const out: RawHit[] = [];
  for (const raw of hits ?? []) {
    const h = (raw ?? {}) as Record<string, unknown>;
    const objectID = String(h.objectID ?? '').trim();
    const title = String(h.title ?? '').trim();
    if (!objectID || !title) continue;
    const url = typeof h.url === 'string' && h.url.trim()
      ? h.url.trim()
      : `https://news.ycombinator.com/item?id=${objectID}`;
    const snippet = String(h.story_text ?? h.comment_text ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const createdAt = typeof h.created_at === 'string' ? h.created_at : null;
    out.push({
      title,
      url,
      snippet,
      source: 'hn',
      publishedISO: createdAt && /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? createdAt.slice(0, 10) : null,
    });
  }
  return out;
}

// GitHub search/repositories items.
export function mapGithubRepos(items: unknown[]): RawHit[] {
  const out: RawHit[] = [];
  for (const raw of items ?? []) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const url = typeof it.html_url === 'string' ? it.html_url.trim() : '';
    const title = String(it.full_name ?? it.name ?? '').trim();
    if (!url || !title) continue;
    const homepage = typeof it.homepage === 'string' && /^https?:\/\//i.test(it.homepage.trim()) ? it.homepage.trim() : '';
    const description = String(it.description ?? '').trim().slice(0, 400);
    // The repo's declared homepage rides in the snippet so the triage model
    // can name it as the product_url (else the repo URL itself qualifies).
    const snippet = (homepage ? `Homepage: ${homepage}. ` : '') + description;
    const pushedAt = typeof it.pushed_at === 'string' ? it.pushed_at : null;
    out.push({
      title,
      url,
      snippet,
      source: 'github',
      publishedISO: pushedAt && /^\d{4}-\d{2}-\d{2}/.test(pushedAt) ? pushedAt.slice(0, 10) : null,
    });
  }
  return out;
}

// Product Hunt GraphQL `posts` nodes. `website` (the vendor's own site) is
// preferred over the PH post `url`; the caller resolves that redirect
// separately before this mapper ever runs (this function is pure).
export function mapProductHuntPosts(posts: unknown[]): RawHit[] {
  const out: RawHit[] = [];
  for (const raw of posts ?? []) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = String(p.name ?? '').trim();
    const website = typeof p.website === 'string' && p.website.trim() ? p.website.trim() : '';
    const url = website || (typeof p.url === 'string' ? p.url.trim() : '');
    if (!name || !url) continue;
    const snippet = String(p.tagline ?? p.description ?? '').trim().slice(0, 500);
    const createdAt = typeof p.createdAt === 'string' ? p.createdAt : null;
    out.push({
      title: name,
      url,
      snippet,
      source: 'producthunt',
      publishedISO: createdAt && /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? createdAt.slice(0, 10) : null,
    });
  }
  return out;
}

// Tavily search results (news or general topic).
export function mapTavilyHits(results: unknown[]): RawHit[] {
  const out: RawHit[] = [];
  for (const raw of results ?? []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    const title = String(r.title ?? '').trim();
    if (!url || !title) continue;
    const snippet = String(r.content ?? r.snippet ?? '').trim().slice(0, 500);
    const rawDate = typeof r.published_date === 'string' ? r.published_date.trim() : '';
    const parsed = rawDate ? Date.parse(rawDate) : NaN;
    out.push({
      title,
      url,
      snippet,
      source: 'tavily',
      publishedISO: Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10),
    });
  }
  return out;
}

// ---- The dossier merge (three writers: homepage enrich, deep dive, manual edit) --
// Monotone like Scout's mergeDossier: no writer can erase another's finds.

function unionCapCI(existing: unknown, incoming: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const s = String(v ?? '').trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key) || out.length >= cap) return;
    seen.add(key);
    out.push(s);
  };
  if (Array.isArray(existing)) for (const v of existing) push(v);
  for (const v of incoming ?? []) push(v);
  return out;
}

export function mergeToolingDossier(
  existing: Record<string, unknown> | null,
  patch: {
    summary: string | null;
    features: string[];
    customers: string[];
    integrations: string[];
    sources: string[];
    updated_by: ToolingDossier['updated_by'];
  },
  nowISO: string
): ToolingDossier {
  const prev = existing ?? {};
  const prevSummary = typeof prev.summary === 'string' && prev.summary.trim() ? prev.summary : null;
  return {
    summary: patch.summary?.trim() ? patch.summary.trim() : prevSummary,
    features: unionCapCI(prev.features, patch.features, 24),
    customers: unionCapCI(prev.customers, patch.customers, 12),
    integrations: unionCapCI(prev.integrations, patch.integrations, 12),
    sources: unionCapCI(prev.sources, patch.sources, 20),
    updated_by: patch.updated_by,
    updated_at: nowISO,
  };
}

// ---- Event dedupe (feeds / deep dives / discovery all log timeline events) ---

function normalizeEventTitle(title: string): string {
  return String(title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeEventUrl(url: string | null): string {
  return String(url ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

// A candidate event already exists when its (non-empty) URL matches an
// existing event's, or its normalized title does. Loose on purpose: a
// duplicate skipped is cheaper than a timeline that repeats itself.
export function eventExists(
  existing: { title: string; url: string | null }[],
  candidate: { title: string; url: string }
): boolean {
  const cUrl = normalizeEventUrl(candidate.url);
  const cTitle = normalizeEventTitle(candidate.title);
  for (const e of existing) {
    if (cUrl && normalizeEventUrl(e.url) === cUrl) return true;
    if (cTitle && normalizeEventTitle(e.title) === cTitle) return true;
  }
  return false;
}

// ---- Hint parsing (free model text -> the closed enums) ----------------------

export function parseMaturityHint(hint: string): ToolingMaturity {
  const h = String(hint ?? '').toLowerCase();
  if (/open[\s-]?source/.test(h)) return 'open_source_project';
  if (/big[\s-]?tech|\b(google|microsoft|amazon|meta|apple|nvidia|oracle|salesforce|sap|ibm)\b/.test(h)) {
    return 'big_tech';
  }
  if (/incumbent|legacy|public(?:ly)?[\s-]?(?:traded|listed)/.test(h)) return 'incumbent';
  if (/scale[\s-]?up/.test(h)) return 'scaleup';
  if (/growth|series\s*[c-f]|late[\s-]?stage/.test(h)) return 'startup_growth';
  if (/early|seed|series\s*[ab]|startup/.test(h)) return 'startup_early';
  return 'unknown';
}

// Map the model's free-text event kind onto tooling_event_t; degrades to 'news'.
export function parseEventKindHint(hint: string): ToolingEventKind {
  const h = String(hint ?? '').toLowerCase();
  if (h.includes('fund') || h.includes('raise') || h.includes('round') || h.includes('invest')) return 'funding';
  if (h.includes('price') || h.includes('pricing')) return 'pricing';
  if (h.includes('partner')) return 'partnership';
  if (h.includes('changelog') || h.includes('release note')) return 'changelog';
  if (h.includes('launch') || h.includes('release') || h.includes('ship')) return 'launch';
  if (h.includes('feature') || h.includes('update')) return 'feature';
  return 'news';
}

// ---- Dedupe matching (insertProducts's core decision) -------------------------
// url_key match first; else name_key equal AND (vendor_domain equal or either
// null). Dismissed rows are filtered by the CALLER before matching (a match
// on one still counts as "found", never re-inserted or bumped).
export function matchExisting(
  existing: { id: string; url_key: string | null; name_key: string; vendor_domain: string | null }[],
  cand: { url_key: string | null; name_key: string; vendor_domain: string | null }
): string | null {
  if (cand.url_key) {
    const byUrl = existing.find((e) => e.url_key === cand.url_key);
    if (byUrl) return byUrl.id;
  }
  const byName = existing.find(
    (e) =>
      e.name_key === cand.name_key &&
      (e.vendor_domain === cand.vendor_domain || e.vendor_domain === null || cand.vendor_domain === null)
  );
  return byName ? byName.id : null;
}

// ---- The discovery/checkpoint plan --------------------------------------------

// One checkpoint entry for tooling_runs.swept_units, e.g. 'cat:coding-assistants',
// 'ph', 'enum:coding-assistants:leaders', 'dd:<id>', 'report'.
export function sweepUnit(kind: string, ...parts: string[]): string {
  return parts.length ? `${kind}:${parts.join(':')}` : kind;
}

// The ordered discover-step unit plan for a run: a pull run enumerates every
// category (leaders pass then emerging pass) BEFORE the shared search/PH
// sweep; both kinds end with one search unit per category, then one 'ph' unit.
export function toolingPlan(categories: { slug: string }[], kind: ToolingRunKind): string[] {
  const slugs = (categories ?? []).map((c) => c.slug);
  const units: string[] = [];
  if (kind === 'pull') {
    for (const slug of slugs) {
      units.push(sweepUnit('enum', slug, 'leaders'));
      units.push(sweepUnit('enum', slug, 'emerging'));
    }
  }
  for (const slug of slugs) units.push(sweepUnit('cat', slug));
  units.push(sweepUnit('ph'));
  return units;
}

// The first plan unit not yet in swept_units (the nextSearchTopic shape, but
// over pre-built unit strings so one array checkpoints every step's units).
export function nextUnswept(units: string[], swept: string[]): string | null {
  const sweptSet = new Set(swept);
  for (const u of units) {
    if (!sweptSet.has(u)) return u;
  }
  return null;
}

// ---- Small numeric/host helpers -----------------------------------------------

// Clamp a fit score onto tooling_products.agent_fit's 0-100 integer range;
// null on anything non-numeric (never throws on a malformed model output).
export function clampFit(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.min(100, Math.max(0, v)));
}

// A curated news/aggregator host set: a triaged product's product_url is
// rejected when it resolves to one of these (the found_url still carries the
// discovery article regardless). Matches the host itself or any parent
// domain (news.ycombinator.com's own subdomains, etc).
const NEWS_HOSTS: readonly string[] = [
  'techcrunch.com', 'theverge.com', 'venturebeat.com', 'news.ycombinator.com', 'producthunt.com',
  'github.com', 'reddit.com', 'medium.com', 'substack.com', 'linkedin.com', 'twitter.com', 'x.com',
  'youtube.com', 'wired.com', 'forbes.com', 'bloomberg.com', 'reuters.com', 'cnbc.com', 'businesswire.com',
  'prnewswire.com', 'globenewswire.com', 'zdnet.com', 'infoworld.com', 'thenewstack.io', 'siliconangle.com',
  'axios.com', 'theinformation.com', 'ft.com', 'wsj.com', 'nytimes.com', 'arstechnica.com', 'engadget.com',
  'mashable.com', 'geekwire.com', 'techradar.com', 'tomsguide.com', 'g2.com', 'capterra.com', 'crunchbase.com',
  'pitchbook.com',
];

export function isNewsHost(host: string): boolean {
  const h = String(host ?? '').toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  return NEWS_HOSTS.some((news) => h === news || h.endsWith(`.${news}`));
}

// Hosts where a DEEP path is a product page even though the root is an
// aggregator: an open-source project's repository IS its homepage.
const REPO_HOSTS = ['github.com', 'gitlab.com', 'huggingface.co'];

// Whether a triaged product_url may become a product's homepage: any
// non-news host, or a repository/space path (owner + name) on a repo host.
// News, blog and social roots are never a homepage.
export function isProductUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  if (REPO_HOSTS.some((r) => host === r || host.endsWith(`.${r}`))) {
    const depth = parsed.pathname.split('/').filter(Boolean).length;
    return depth >= 2;
  }
  return !isNewsHost(host);
}

// ---- {year}/{month} token resolution (reimplemented, not imported, to stay
// dependency-free — the lib/pipeline/config.ts resolveDateTokens shape) ------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function resolveToolingTokens(query: string, dayISO: string): string {
  let d = new Date(`${dayISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) d = new Date();
  const year = String(d.getUTCFullYear());
  const month = MONTH_NAMES[d.getUTCMonth()];
  return String(query ?? '').replaceAll('{year}', year).replaceAll('{month}', month);
}
