// Source reliability tiers for the external scan and the intel desk.
//
// The scan's only score used to be `relevance` (topic fit, model-scored), so
// on-topic junk (a crypto promo site, a stock-tip aggregator) outscored primary
// sources every day, and a research house like Ipsos read as "0.55". Reliability
// is a SEPARATE axis and it is derived from the SOURCE, deterministically:
//
//   1. suffix rules (.gov, .edu, central banks, blog platforms) and the curated
//      map below decide most of the volume without any model;
//   2. a domain neither covers is rated ONCE by the utility model
//      (lib/scan/source-rating.ts) and persisted in source_tiers, so the long
//      tail rates itself and nobody tends a list by hand;
//   3. every item is stamped source_tier + source_kind at collection time, and
//      the firewall datasets ship them beside relevance plus a composed
//      `priority` (relevance discounted by tier and content kind).
//
// Kevin's standing decision (2026-09-02): he does not want to adjust
// reliability by hand; the system must recognise junk blogs on its own. The
// curated map is written once as editorial judgment; the model fills the rest.
// This module is pure (no imports) so scripts/test-scan.mjs loads it directly.

export type SourceTier = 1 | 2 | 3 | 4;

export type SourceKind =
  | 'regulator'   // government, central banks, supervisors, courts, statistics agencies
  | 'primary'     // the company or lab itself: newsrooms, IR pages, official blogs
  | 'research'    // research houses, pollsters, academic and policy institutes
  | 'wire'        // Reuters, AP, AFP
  | 'major'       // national and international news organisations
  | 'trade'       // sector trade press (banking, payments, fintech, legal)
  | 'tech_press'  // technology press
  | 'general'     // regional and general-interest outlets, unknown quality
  | 'aggregator'  // syndication and aggregation front ends
  | 'pr_wire'     // press-release distribution wires
  | 'blog'        // blogging platforms and personal sites
  | 'social'      // social networks and forums
  | 'promo'       // stock-tip, crypto-promo, SEO and content-farm sites
  | 'unknown';

export type ContentKind = 'news' | 'analysis' | 'data' | 'press_release' | 'marketing' | 'opinion' | 'other';

export const SOURCE_KINDS: readonly SourceKind[] = [
  'regulator', 'primary', 'research', 'wire', 'major', 'trade', 'tech_press', 'general',
  'aggregator', 'pr_wire', 'blog', 'social', 'promo', 'unknown',
];
export const CONTENT_KINDS: readonly ContentKind[] = [
  'news', 'analysis', 'data', 'press_release', 'marketing', 'opinion', 'other',
];

// The tier a kind implies when nothing more specific is known.
export const KIND_TIER: Record<SourceKind, SourceTier> = {
  regulator: 1, primary: 1, research: 1, wire: 1,
  major: 2, trade: 2, tech_press: 2,
  general: 3, aggregator: 3, blog: 3, pr_wire: 3, unknown: 3,
  social: 4, promo: 4,
};

export interface SourceRating {
  tier: SourceTier;
  kind: SourceKind;
  via: 'suffix' | 'curated';
}

// Domain-suffix rules: institutional TLDs and country-government patterns rate
// tier 1 regardless of the exact host; blogging platforms rate tier 3.
const SUFFIX_RULES: { suffix: string; kind: SourceKind }[] = [
  { suffix: '.gov', kind: 'regulator' },
  { suffix: '.mil', kind: 'regulator' },
  { suffix: '.gov.uk', kind: 'regulator' },
  { suffix: '.gov.au', kind: 'regulator' },
  { suffix: '.gc.ca', kind: 'regulator' },
  { suffix: '.gouv.fr', kind: 'regulator' },
  { suffix: '.bund.de', kind: 'regulator' },
  { suffix: '.europa.eu', kind: 'regulator' },
  { suffix: '.int', kind: 'regulator' },
  { suffix: '.edu', kind: 'research' },
  { suffix: '.ac.uk', kind: 'research' },
  { suffix: '.substack.com', kind: 'blog' },
  { suffix: '.medium.com', kind: 'blog' },
  { suffix: '.blogspot.com', kind: 'blog' },
  { suffix: '.wordpress.com', kind: 'blog' },
  { suffix: '.wixsite.com', kind: 'blog' },
  { suffix: '.github.io', kind: 'blog' },
  { suffix: '.beehiiv.com', kind: 'blog' },
  { suffix: '.ghost.io', kind: 'blog' },
];

// Editorial judgment, written once. Subdomains inherit (news.bloomberg.com ->
// bloomberg.com). A tier here overrides the kind's default only where noted.
const CURATED: Record<string, { kind: SourceKind; tier?: SourceTier }> = {
  // regulators, supervisors, central banks, official statistics (non-.gov hosts)
  'bis.org': { kind: 'regulator' }, 'imf.org': { kind: 'regulator' }, 'worldbank.org': { kind: 'regulator' },
  'oecd.org': { kind: 'regulator' }, 'bankofengland.co.uk': { kind: 'regulator' }, 'ecb.europa.eu': { kind: 'regulator' },
  'fsb.org': { kind: 'regulator' }, 'fca.org.uk': { kind: 'regulator' }, 'finra.org': { kind: 'regulator' },
  'newyorkfed.org': { kind: 'regulator' }, 'stlouisfed.org': { kind: 'regulator' }, 'federalreserve.gov': { kind: 'regulator' },
  'ffiec.gov': { kind: 'regulator' }, 'un.org': { kind: 'regulator' }, 'wto.org': { kind: 'regulator' },
  'courtlistener.com': { kind: 'regulator' },
  // research houses, pollsters, institutes, academic publishing
  'ipsos.com': { kind: 'research' }, 'gallup.com': { kind: 'research' }, 'pewresearch.org': { kind: 'research' },
  'yougov.com': { kind: 'research' }, 'morningconsult.com': { kind: 'research' }, 'nielsen.com': { kind: 'research' },
  'mckinsey.com': { kind: 'research' }, 'bcg.com': { kind: 'research' }, 'bain.com': { kind: 'research' },
  'deloitte.com': { kind: 'research' }, 'pwc.com': { kind: 'research' }, 'kpmg.com': { kind: 'research' },
  'ey.com': { kind: 'research' }, 'accenture.com': { kind: 'research' }, 'gartner.com': { kind: 'research' },
  'forrester.com': { kind: 'research' }, 'idc.com': { kind: 'research' }, 'nber.org': { kind: 'research' },
  'ssrn.com': { kind: 'research' }, 'arxiv.org': { kind: 'research' }, 'cepr.org': { kind: 'research' },
  'brookings.edu': { kind: 'research' }, 'rand.org': { kind: 'research' }, 'epochai.org': { kind: 'research' },
  'nature.com': { kind: 'research' }, 'science.org': { kind: 'research' }, 'cbinsights.com': { kind: 'research' },
  'pitchbook.com': { kind: 'research' }, 'crunchbase.com': { kind: 'research', tier: 2 }, 'statista.com': { kind: 'research', tier: 2 },
  'jpmorgan.com': { kind: 'research', tier: 2 }, 'goldmansachs.com': { kind: 'research', tier: 2 },
  // primary sources: the companies and labs themselves
  'openai.com': { kind: 'primary' }, 'anthropic.com': { kind: 'primary' }, 'deepmind.google': { kind: 'primary' },
  'blog.google': { kind: 'primary' }, 'ai.meta.com': { kind: 'primary' }, 'about.fb.com': { kind: 'primary' },
  'microsoft.com': { kind: 'primary' }, 'nvidia.com': { kind: 'primary' }, 'apple.com': { kind: 'primary' },
  'aboutamazon.com': { kind: 'primary' }, 'huggingface.co': { kind: 'primary' }, 'github.com': { kind: 'primary', tier: 2 },
  'mistral.ai': { kind: 'primary' }, 'x.ai': { kind: 'primary' }, 'cohere.com': { kind: 'primary' },
  'stripe.com': { kind: 'primary' }, 'visa.com': { kind: 'primary' }, 'mastercard.com': { kind: 'primary' },
  'paypal.com': { kind: 'primary' }, 'block.xyz': { kind: 'primary' }, 'capitalone.com': { kind: 'primary' },
  // wires
  'reuters.com': { kind: 'wire' }, 'apnews.com': { kind: 'wire' }, 'afp.com': { kind: 'wire' },
  // majors
  'bloomberg.com': { kind: 'major' }, 'ft.com': { kind: 'major' }, 'wsj.com': { kind: 'major' },
  'nytimes.com': { kind: 'major' }, 'economist.com': { kind: 'major' }, 'washingtonpost.com': { kind: 'major' },
  'theguardian.com': { kind: 'major' }, 'cnbc.com': { kind: 'major' }, 'cnn.com': { kind: 'major' },
  'bbc.com': { kind: 'major' }, 'bbc.co.uk': { kind: 'major' }, 'axios.com': { kind: 'major' },
  'politico.com': { kind: 'major' }, 'fortune.com': { kind: 'major' }, 'theatlantic.com': { kind: 'major' },
  'wired.com': { kind: 'major' }, 'time.com': { kind: 'major' }, 'npr.org': { kind: 'major' },
  'semafor.com': { kind: 'major' }, 'theinformation.com': { kind: 'major' }, 'barrons.com': { kind: 'major' },
  'marketwatch.com': { kind: 'major', tier: 3 }, 'forbes.com': { kind: 'major', tier: 3 }, 'businessinsider.com': { kind: 'major', tier: 3 },
  'usatoday.com': { kind: 'major', tier: 3 }, 'thehill.com': { kind: 'major', tier: 3 },
  // trade press
  'americanbanker.com': { kind: 'trade' }, 'bankingdive.com': { kind: 'trade' }, 'paymentsdive.com': { kind: 'trade' },
  'pymnts.com': { kind: 'trade' }, 'finextra.com': { kind: 'trade' }, 'thebanker.com': { kind: 'trade' },
  'fintechfutures.com': { kind: 'trade' }, 'ffnews.com': { kind: 'trade' }, 'law360.com': { kind: 'trade' },
  'digitaltransactions.net': { kind: 'trade' }, 'thepaypers.com': { kind: 'trade' }, 'retaildive.com': { kind: 'trade' },
  'ciodive.com': { kind: 'trade' }, 'insidearm.com': { kind: 'trade' }, 'housingwire.com': { kind: 'trade' },
  'krebsonsecurity.com': { kind: 'trade' }, 'bleepingcomputer.com': { kind: 'trade' }, 'therecord.media': { kind: 'trade' },
  'darkreading.com': { kind: 'trade' }, 'securityweek.com': { kind: 'trade' }, 'adage.com': { kind: 'trade' },
  'adweek.com': { kind: 'trade' }, 'digiday.com': { kind: 'trade' }, 'tearsheet.co': { kind: 'trade' },
  'bankautomationnews.com': { kind: 'trade' }, 'fintechnexus.com': { kind: 'trade' },
  // technology press
  'techcrunch.com': { kind: 'tech_press' }, 'theverge.com': { kind: 'tech_press' }, 'arstechnica.com': { kind: 'tech_press' },
  'venturebeat.com': { kind: 'tech_press' }, 'theregister.com': { kind: 'tech_press' }, 'zdnet.com': { kind: 'tech_press' },
  'technologyreview.com': { kind: 'tech_press' }, 'spectrum.ieee.org': { kind: 'tech_press' }, 'hpcwire.com': { kind: 'tech_press' },
  'engadget.com': { kind: 'tech_press' }, 'thenextweb.com': { kind: 'tech_press' }, 'geekwire.com': { kind: 'tech_press' },
  'siliconangle.com': { kind: 'tech_press' }, 'infoworld.com': { kind: 'tech_press' }, 'computerworld.com': { kind: 'tech_press' },
  'tomshardware.com': { kind: 'tech_press' }, 'gizmodo.com': { kind: 'tech_press', tier: 3 }, 'mashable.com': { kind: 'tech_press', tier: 3 },
  // general and regional outlets (tier 3 by default)
  'economictimes.com': { kind: 'general' }, 'm.economictimes.com': { kind: 'general' }, 'indiatimes.com': { kind: 'general' },
  'timesofindia.indiatimes.com': { kind: 'general' }, 'moneycontrol.com': { kind: 'general' }, 'livemint.com': { kind: 'general' },
  'scmp.com': { kind: 'general' }, 'nikkei.com': { kind: 'major' }, 'asia.nikkei.com': { kind: 'major' },
  'telegraph.co.uk': { kind: 'general' }, 'independent.co.uk': { kind: 'general' }, 'express.co.uk': { kind: 'general', tier: 4 },
  'dailymail.co.uk': { kind: 'general', tier: 4 }, 'nypost.com': { kind: 'general', tier: 4 }, 'foxbusiness.com': { kind: 'general' },
  'yahoo.com': { kind: 'aggregator' }, 'finance.yahoo.com': { kind: 'aggregator' }, 'msn.com': { kind: 'aggregator' },
  'news.google.com': { kind: 'aggregator' }, 'google.com.hk': { kind: 'aggregator' }, 'google.com': { kind: 'aggregator' },
  'flipboard.com': { kind: 'aggregator' }, 'newsbreak.com': { kind: 'aggregator' }, 'ground.news': { kind: 'aggregator' },
  'theglobeandmail.com': { kind: 'major' }, 'globalbankingandfinance.com': { kind: 'general', tier: 4 },
  // press-release wires (company-authored; the content kind carries the discount)
  'prnewswire.com': { kind: 'pr_wire' }, 'businesswire.com': { kind: 'pr_wire' }, 'globenewswire.com': { kind: 'pr_wire' },
  'einpresswire.com': { kind: 'pr_wire' }, 'accesswire.com': { kind: 'pr_wire' }, 'newswire.com': { kind: 'pr_wire' },
  'prweb.com': { kind: 'pr_wire' }, 'newsfilecorp.com': { kind: 'pr_wire' }, 'marketwired.com': { kind: 'pr_wire' },
  // social and forums
  'facebook.com': { kind: 'social' }, 'x.com': { kind: 'social' }, 'twitter.com': { kind: 'social' },
  'linkedin.com': { kind: 'social' }, 'reddit.com': { kind: 'social' }, 'youtube.com': { kind: 'social' },
  'tiktok.com': { kind: 'social' }, 'instagram.com': { kind: 'social' }, 'threads.net': { kind: 'social' },
  'medium.com': { kind: 'blog' }, 'substack.com': { kind: 'blog' }, 'buttondown.com': { kind: 'blog' },
  // stock-tip, crypto-promo, SEO and content-farm sites
  'seekingalpha.com': { kind: 'promo', tier: 3 }, 'fool.com': { kind: 'promo' }, 'benzinga.com': { kind: 'promo' },
  'zacks.com': { kind: 'promo' }, 'investorplace.com': { kind: 'promo' }, '247wallst.com': { kind: 'promo' },
  'simplywall.st': { kind: 'promo' }, 'tradingview.com': { kind: 'promo' }, 'stocktitan.net': { kind: 'promo' },
  'whalesbook.com': { kind: 'promo' }, 'cryptorank.io': { kind: 'promo' }, 'scanx.trade': { kind: 'promo' },
  'gurufocus.com': { kind: 'promo' }, 'schaeffersresearch.com': { kind: 'promo' }, 'marketbeat.com': { kind: 'promo' },
  'tipranks.com': { kind: 'promo' }, 'coindesk.com': { kind: 'trade', tier: 3 }, 'cointelegraph.com': { kind: 'promo' },
  'crypto.news': { kind: 'promo' }, 'marktechpost.com': { kind: 'promo' }, 'analyticsinsight.net': { kind: 'promo' },
  'aicerts.ai': { kind: 'promo' }, 'techtimes.com': { kind: 'promo' }, 'tech-insider.org': { kind: 'promo' },
  'cambodiainvestmentreview.com': { kind: 'promo' }, 'ad-hoc-news.de': { kind: 'promo' }, 'snsinsider.com': { kind: 'promo' },
  'theeduledger.com': { kind: 'promo' }, 'admakeai.com': { kind: 'promo' }, 'intuitionlabs.ai': { kind: 'promo' },
  'yen.com.gh': { kind: 'promo' }, 'manilatimes.net': { kind: 'general' }, 'menshealth.com.au': { kind: 'promo' },
};

export function normalizeDomain(domain: string): string {
  return String(domain ?? '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

// Rule-based rating: exact curated match, then parent-domain walk, then the
// suffix rules. null means "unknown to the rules" (the model rates it once).
export function rateDomainByRule(domain: string): SourceRating | null {
  const d = normalizeDomain(domain);
  if (!d) return null;
  const parts = d.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const hit = CURATED[candidate];
    if (hit) return { tier: hit.tier ?? KIND_TIER[hit.kind], kind: hit.kind, via: 'curated' };
  }
  for (const rule of SUFFIX_RULES) {
    if (d.endsWith(rule.suffix) && d.length > rule.suffix.length) {
      return { tier: KIND_TIER[rule.kind], kind: rule.kind, via: 'suffix' };
    }
  }
  return null;
}

export function isSourceTier(v: unknown): v is SourceTier {
  return v === 1 || v === 2 || v === 3 || v === 4;
}
export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === 'string' && (SOURCE_KINDS as readonly string[]).includes(v);
}
export function isContentKind(v: unknown): v is ContentKind {
  return typeof v === 'string' && (CONTENT_KINDS as readonly string[]).includes(v);
}

// The composed priority the firewall importer can rank on: relevance (topic
// fit) discounted by the source tier and the content kind. Kept simple and
// documented in the handoff so the downstream side can recompute it.
export const TIER_WEIGHT: Record<SourceTier, number> = { 1: 1.0, 2: 0.85, 3: 0.6, 4: 0.25 };
export const CONTENT_WEIGHT: Record<ContentKind, number> = {
  news: 1.0, analysis: 1.0, data: 1.0, opinion: 0.85, other: 0.85, press_release: 0.7, marketing: 0.4,
};

export function priorityOf(
  relevance: number | null | undefined,
  tier: SourceTier | null | undefined,
  contentKind: ContentKind | null | undefined
): number | null {
  if (relevance == null || Number.isNaN(Number(relevance))) return null;
  const r = Math.min(1, Math.max(0, Number(relevance)));
  const t = TIER_WEIGHT[isSourceTier(tier) ? tier : 3];
  const c = CONTENT_WEIGHT[isContentKind(contentKind) ? contentKind : 'other'];
  return Math.round(r * t * c * 100) / 100;
}

export function curatedDomainCount(): number {
  return Object.keys(CURATED).length;
}
