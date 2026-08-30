// Pure intel helpers: no lib/db, no SDK, type-only imports — plain-Node
// type-stripping loads this directly in scripts/test-intel.mjs (the
// lib/scan/core.ts convention).

// The dimension taxonomy enrichment allow-lists against (a const, not a
// table: the set is editorial and changes with a deploy, unlike the company
// registry). Codes travel into intel_items.dimensions and intel_facts.dimension
// and out through the datasets, so treat them as a public contract.
export const INTEL_DIMENSIONS = [
  { code: 'strategy', name: 'Strategy', description: 'Stated direction, priorities, business model shifts, expansion or exit moves.' },
  { code: 'products', name: 'Products', description: 'Launches, pricing, features, partnerships that ship something to customers.' },
  { code: 'tech_ai', name: 'Technology & AI', description: 'AI deployments, platform and infrastructure moves, engineering direction.' },
  { code: 'financials', name: 'Financials', description: 'Earnings, guidance, credit performance, capital actions, funding.' },
  { code: 'leadership', name: 'Leadership', description: 'Executive and board changes, org restructures, key hires and departures.' },
  { code: 'regulatory', name: 'Regulatory', description: 'Supervisory actions, rulemaking exposure, enforcement, compliance posture.' },
  { code: 'ma_partnerships', name: 'M&A & partnerships', description: 'Acquisitions, divestitures, investments, strategic alliances.' },
  { code: 'brand', name: 'Brand & marketing', description: 'Positioning, campaigns, sponsorships, reputation events.' },
  { code: 'talent', name: 'Talent', description: 'Hiring patterns, layoffs, compensation moves, workforce signals.' },
  { code: 'risk', name: 'Risk', description: 'Credit, fraud, security, litigation, operational incidents.' },
] as const;

export type IntelDimensionCode = (typeof INTEL_DIMENSIONS)[number]['code'];

export const INTEL_DIMENSION_CODES: string[] = INTEL_DIMENSIONS.map((d) => d.code);

// Rendered into the enrichment system block (the scan taxonomyDigest pattern).
export function dimensionDigest(): string {
  return INTEL_DIMENSIONS.map((d) => `[${d.code}] ${d.name}: ${d.description}`).join('\n');
}

// Mirrors the intel_facts.fact_key generated column exactly, so writers can
// dedupe client-side before hitting the unique constraint.
export function intelFactKey(fact: string): string {
  return fact.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 120);
}

function dayNumber(dayISO: string): number {
  return Math.floor(Date.parse(`${dayISO}T00:00:00Z`) / 86_400_000);
}

// Which companies get their Tavily search today. Deterministic every-Nth-day
// rotation: company i is due when i ≡ dayNumber (mod cadence), so the load
// spreads evenly and every company is searched every `cadence` days
// regardless of registry size. Order is the caller's (sort by slug for
// stability). Feeds and filings run daily for everyone; this is the paid-ish
// leg's quota knob.
export function searchDueSlugs(slugs: string[], dayISO: string, cadence = 3): string[] {
  if (cadence <= 1) return [...slugs];
  const day = dayNumber(dayISO);
  return slugs.filter((_, i) => i % cadence === day % cadence);
}

// {year}/{month} tokens in registry search queries, resolved against the run
// day (month-anchored phrasing surfaces the week's news, not SEO listicles —
// the discovery lesson).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function resolveIntelTokens(query: string, dayISO: string): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  return query
    .replaceAll('{year}', String(d.getUTCFullYear()))
    .replaceAll('{month}', MONTHS[d.getUTCMonth()]);
}

// The free default feed for any company: Bing News RSS on an exact phrase.
// Keyless and unmetered, which is what keeps the Tavily leg on a 3-day ring.
// Bing, not Google: Google News RSS wraps article links in encrypted
// news.google.com redirects (unhydratable); Bing's apiclick links carry the
// real publisher URL as a query param that unwrapNewsUrl extracts.
export function bingNewsFeedUrl(phrase: string): string {
  const q = encodeURIComponent(`"${phrase}"`);
  return `https://www.bing.com/news/search?q=${q}&format=RSS`;
}

// Resolve a news-aggregator redirect link to the publisher URL it carries.
// Handles Bing's apiclick.aspx (?url=<encoded>); anything else passes
// through untouched.
export function unwrapNewsUrl(url: string): string {
  const m = /^https?:\/\/(?:www\.)?bing\.com\/news\/apiclick\.aspx\?(.*)$/i.exec(url);
  if (!m) return url;
  try {
    const target = new URLSearchParams(m[1]).get('url');
    if (target && /^https?:\/\//i.test(target)) return target;
  } catch {
    // fall through to the wrapper URL
  }
  return url;
}

// EDGAR filing forms worth tracking (amendments matched by prefix at the
// caller). Everything else a filer submits is noise for this desk.
export const EDGAR_FORMS = ['8-K', '10-Q', '10-K', 'S-1', 'DEF 14A', '20-F', '6-K'] as const;

// A checkpoint entry for intel_runs.swept_units.
export type SweepLeg = 'feeds' | 'search' | 'filings' | 'synthesis';

export function sweepUnit(leg: SweepLeg, slug?: string): string {
  return slug ? `${leg}:${slug}` : leg;
}

// The next unswept company for a leg (the nextSearchTopic shape, but over
// sweep units so one array checkpoints every per-company leg).
export function nextUnsweptSlug(
  slugs: string[],
  leg: Exclude<SweepLeg, 'feeds'>,
  sweptUnits: string[],
): string | null {
  const swept = new Set(sweptUnits);
  for (const slug of slugs) {
    if (!swept.has(sweepUnit(leg, slug))) return slug;
  }
  return null;
}
