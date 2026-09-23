import { parse, NodeType } from 'node-html-parser';
import type { HTMLElement as ParsedElement, Node as ParsedNode } from 'node-html-parser';
import { windowFor } from '../edition/pure.ts';
import { dateLabel } from '../format.ts';
import { logoSource } from '../logo.ts';
import type { CitationAllowlist } from '../citations';
import type { CostDeck, DeckSlide } from '../costs-deck';
import type {
  IntelDeckCompany, IntelDeckMover, IntelDeckPack, IntelDeckQuiet, IntelDeckTier, SavedIntelDeck,
} from './deck-types';

// The company intel deck, the pure half: the press window, deterministic
// scoring and ranking, the per-company citation allowlist, and the deck
// builder that turns a saved pack + narrative into CostDeck slides. No DB, no
// model (lib/intel/deck-pack.ts reads, deck-generate.ts writes the sentences);
// scripts/test-intel-deck.mjs loads this file under plain Node, hence the
// explicit .ts relative imports.

// 16:20 UTC: the Intel Desk's last window (sweep3, 15:20 UTC + a 700s budget)
// is done by ~15:32; the Daily Edition's model legs start at 16:45.
export const INTEL_DECK_PRESS_UTC = '16:20:00';
export const INTEL_DECK_CRON = '20 16 * * 1-5';

export function deckWindowFor(day: string): { from: string; to: string } {
  return windowFor(day, INTEL_DECK_PRESS_UTC);
}

export const TIER_LABEL: Record<IntelDeckTier, string> = {
  card_issuer: 'Card issuer',
  consumer_bank: 'Consumer bank',
  fintech: 'Fintech',
  tech_platform: 'Tech platform',
  wildcard: 'Wildcard',
};

// Σ item significance (an unscored item counts 0.5) + 0.5 per fact + 1.0 per
// filing + 1.5 per new metric row. Deterministic, so two builds of the same
// window rank the same.
export function scoreCompany(c: Pick<IntelDeckCompany, 'items' | 'facts' | 'filings' | 'metrics'>): number {
  const items = c.items.reduce((sum, it) => sum + (it.significance ?? 0.5), 0);
  return Math.round((items + 0.5 * c.facts.length + 1.0 * c.filings.length + 1.5 * c.metrics.length) * 100) / 100;
}

export function rankMovers(companies: IntelDeckCompany[], n = 3): IntelDeckMover[] {
  return [...companies]
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, n)
    .map((c) => ({ slug: c.slug, name: c.name, score: c.score, headline: c.items[0]?.headline ?? c.facts[0]?.fact ?? null }));
}

export function quietCompanies(
  active: { slug: string; name: string; tier: string; domain: string | null }[],
  present: Set<string>
): IntelDeckQuiet[] {
  return active
    .filter((c) => c.tier !== 'self' && !present.has(c.slug))
    .map((c) => ({ slug: c.slug, name: c.name, tier: c.tier as IntelDeckTier, domain: c.domain }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Everything a company's sentence may link to: its items, facts (via their
// provenance item) and filings. Nothing else survives the citation gate.
// enforceCitations reports a surviving link as "cited" only through
// tagByHref, so every allowed href maps to itself here (the deck has no S/P
// tags; the href IS the citation). An empty map would gate correctly but
// count nothing as cited, and every sentence would then be dropped.
export function allowlistForCompany(c: IntelDeckCompany): CitationAllowlist {
  const hrefs = new Set<string>();
  for (const it of c.items) hrefs.add(it.url);
  for (const f of c.facts) if (f.url) hrefs.add(f.url);
  for (const f of c.filings) hrefs.add(f.url);
  return { hrefs, tagByHref: new Map([...hrefs].map((h) => [h, h])) };
}

export function allowlistForDeck(pack: IntelDeckPack): CitationAllowlist {
  const hrefs = new Set<string>();
  for (const c of pack.companies) for (const h of allowlistForCompany(c).hrefs) hrefs.add(h);
  return { hrefs, tagByHref: new Map([...hrefs].map((h) => [h, h])) };
}

// ---------------------------------------------------------------- formatting

const ACRONYMS: Record<string, string> = { ma: 'M&A', ai: 'AI', us: 'US', uk: 'UK', eu: 'EU', ipo: 'IPO', api: 'API', bnpl: 'BNPL', p2p: 'P2P', yoy: 'YoY', qoq: 'QoQ', roe: 'ROE', roa: 'ROA', nim: 'NIM', cet1: 'CET1', eps: 'EPS' };

// 'ma_partnerships' -> 'M&A partnerships', 'net_interest_income' -> 'Net interest income'.
export function humanizeCode(code: string): string {
  const words = code.split('_').filter(Boolean).map((w) => ACRONYMS[w.toLowerCase()] ?? w);
  const s = words.join(' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtMetricValue(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return '';
  const u = (unit ?? '').toUpperCase();
  if (u === 'USD') {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
    return `${sign}$${abs.toFixed(2)}`;
  }
  if (u === 'USD/SHARE') return `$${value.toFixed(2)}`;
  if (u === 'PERCENT' || u === '%') return `${value.toFixed(1)}%`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e3).toFixed(0)}K`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function fmtDelta(deltaPct: number | null): string | null {
  if (deltaPct == null || !Number.isFinite(deltaPct)) return null;
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

function itemMeta(it: IntelDeckCompany['items'][number]): string {
  return [it.domain, it.sourceTier ? `T${it.sourceTier}` : null, it.publishedDate ? dateLabel(it.publishedDate) : null]
    .filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- sentence html -> segments

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#?\w+);/g, (m, name: string) => {
    if (name in ENTITIES) return ENTITIES[name];
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return m;
  });
}

// The gated sentence HTML (only allow-listed <a> survive the gate) as text
// segments with optional hrefs, for renderers that cannot take HTML (react-pdf).
export function sentenceSegments(html: string | null): { text: string; href?: string }[] | null {
  if (!html) return null;
  const root = parse(html);
  const out: { text: string; href?: string }[] = [];
  const walk = (node: ParsedNode, href?: string) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const text = decodeEntities(node.rawText).replace(/\s+/g, ' ');
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.href === href) last.text += text;
      else out.push(href ? { text, href } : { text });
      return;
    }
    const el = node as ParsedElement;
    const tag = el.tagName?.toLowerCase();
    const link = tag === 'a' ? (el.getAttribute('href') ?? undefined) : href;
    for (const child of el.childNodes) walk(child, link);
  };
  for (const child of root.childNodes) walk(child);
  const segs = out.map((s) => ({ ...s, text: s.text })).filter((s) => s.text.trim());
  if (!segs.length) return null;
  segs[0].text = segs[0].text.replace(/^\s+/, '');
  segs[segs.length - 1].text = segs[segs.length - 1].text.replace(/\s+$/, '');
  return segs;
}

// ---------------------------------------------------------------- deck builder

function absolute(origin: string, href: string): string {
  return href.startsWith('/') ? `${origin.replace(/\/+$/, '')}${href}` : href;
}

export function buildIntelDeck(saved: SavedIntelDeck, origin: string): CostDeck {
  const { pack, narrative } = saved;
  const abs = (href: string) => absolute(origin, href);
  const slides: DeckSlide[] = [];
  const day = dateLabel(pack.day) ?? pack.day;
  const sentenceBySlug = new Map(narrative.sentences.map((s) => [s.slug, s.html]));

  slides.push({
    kind: 'title',
    kicker: `COMPANY INTEL DECK · No. ${pack.issueNumber}`,
    title: pack.movers[0]?.headline ?? `Company intel, ${day}`,
    subtitle: `${day} · ${pack.numbers.items} items across ${pack.numbers.companies} tracked companies`,
    bigStat: { n: String(pack.numbers.companies), l: 'companies with something new in the window' },
    date: pack.day,
  });

  slides.push({
    kind: 'stat-grid',
    kicker: 'The day',
    title: 'Yesterday, by the numbers',
    stats: [
      { n: String(pack.numbers.companies), l: 'Companies active' },
      { n: String(pack.numbers.items), l: 'Items collected' },
      { n: String(pack.numbers.facts), l: 'Facts extracted' },
      { n: String(pack.numbers.filings), l: 'Filings' },
      { n: String(pack.numbers.metrics), l: 'Metric updates' },
      { n: String(pack.numbers.quiet), l: 'Quiet' },
    ],
    takeaway: `${pack.numbers.items} items from ${pack.numbers.outlets} outlets across ${pack.numbers.companies} companies; ${pack.numbers.quiet} tracked companies had nothing new.`,
  });

  if (pack.movers.length) {
    slides.push({
      kind: 'bullets',
      kicker: 'The front',
      title: "The day's biggest moves",
      bullets: pack.movers.map((m) => {
        const c = pack.companies.find((x) => x.slug === m.slug);
        const top = c?.items[0];
        return {
          lead: m.name,
          text: m.headline ?? '',
          href: top ? abs(top.url) : undefined,
          meta: `score ${m.score.toFixed(1)}${c ? ` · ${c.items.length} items · ${c.facts.length} facts` : ''}`,
        };
      }),
      takeaway: narrative.frontHtml
        ? (sentenceSegments(narrative.frontHtml)?.map((s) => s.text).join('') ?? '')
        : 'Ranked by a deterministic score over items, facts, filings and metric updates.',
    });
  }

  for (const c of pack.companies) {
    slides.push({
      kind: 'company',
      kicker: TIER_LABEL[c.tier] ?? c.tier,
      title: c.name,
      tier: TIER_LABEL[c.tier] ?? c.tier,
      ticker: c.ticker,
      domain: c.domain,
      logoSrc: logoSource(c.domain, null),
      logoDataUri: c.logoDataUri,
      items: c.items.slice(0, 6).map((it) => ({ headline: it.headline, url: abs(it.url), meta: itemMeta(it) })),
      facts: c.facts.slice(0, 6).map((f) => ({
        text: f.valueText ? `${f.fact} (${f.valueText})` : f.fact,
        meta: [humanizeCode(f.dimension), f.asOf ? dateLabel(f.asOf) : null].filter(Boolean).join(' · '),
      })),
      filings: c.filings.slice(0, 4).map((f) => ({ headline: f.headline, url: abs(f.url) })),
      metrics: c.metrics.slice(0, 4).map((m) => ({
        label: `${m.label} · ${m.period}`,
        value: fmtMetricValue(m.value, m.unit),
        delta: fmtDelta(m.deltaPct),
      })),
      sentence: sentenceSegments(sentenceBySlug.get(c.slug) ?? null)?.map((s) => (s.href ? { ...s, href: abs(s.href) } : s)) ?? null,
      takeaway: `Score ${c.score.toFixed(1)}: ${c.items.length} items, ${c.facts.length} facts, ${c.filings.length} filings, ${c.metrics.length} metric updates.`,
    });
  }

  if (pack.quiet.length) {
    slides.push({
      kind: 'bullets',
      kicker: 'Quiet',
      title: 'Nothing new in the window',
      bullets: pack.quiet.map((q) => ({ lead: q.name, text: '', meta: TIER_LABEL[q.tier] ?? q.tier })),
      takeaway: `${pack.quiet.length} tracked companies produced no items, facts, filings or metric updates.`,
    });
  }

  slides.push({
    kind: 'divider',
    kicker: 'Close',
    title: 'Everything here is public, stored, and linked to its source',
    subtitle: `Built ${dateLabel(pack.generatedAt) ?? pack.generatedAt} from what the Intel Desk collected between ${dateLabel(pack.windowFrom) ?? pack.windowFrom} and ${day}. Access-key holders only.`,
  });

  return { generatedOn: pack.generatedAt.slice(0, 10), slides };
}
