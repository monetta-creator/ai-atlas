import { parse, NodeType } from 'node-html-parser';
import type { HTMLElement as ParsedElement, Node as ParsedNode } from 'node-html-parser';
import { enforceCitations } from '../citations.ts';
import { fmtChange } from './markets.ts';
import type { CitationAllowlist } from '../citations';
import type { CostDeck, DeckSlide } from '../costs-deck';
import type { SavedEdition, EditionPack } from './types';
import { dateLabel } from '../format.ts';

// The Daily Edition's 16:9 deck: buildEditionDeck turns a SavedEdition into
// the same CostDeck shape the cost report and education guides render
// (lib/costs-deck.ts / lib/pdf/costs-deck.tsx). PURE and DB-free by design
// (scripts/test-edition-deck.mjs loads it under plain-Node type stripping):
// every relative import carries an explicit .ts extension, and this module
// deliberately does NOT import lib/edition/pack.ts (which pulls ../db.ts at
// load time), allowlistForEdition's logic is duplicated below instead.

type Bullet = { lead: string; text: string; href?: string; meta?: string };

// ---------------------------------------------------------------- allowlist
// Duplicated from lib/edition/pack.ts's allowlistForEdition (kept in lockstep
// by hand; both are short and change rarely) so this module never imports
// pack.ts's ../db.ts dependency chain.
function allowlistForEditionPure(pack: EditionPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  for (const c of pack.clusters) {
    for (const it of c.items) {
      hrefs.add(it.url);
      if (it.href) hrefs.add(it.href);
    }
  }
  for (const t of pack.thingsHappen) {
    hrefs.add(t.url);
    if (t.href) hrefs.add(t.href);
  }
  for (const p of pack.papers) hrefs.add(p.href);
  for (const t of pack.tools) hrefs.add(t.href);
  for (const c of pack.claimsTouched) {
    hrefs.add(c.href);
    for (const h of c.signalHrefs) hrefs.add(h);
    tagByHref.set(c.href, c.code);
  }
  for (const co of pack.companies) for (const f of co.facts) if (f.url) hrefs.add(f.url);
  for (const b of pack.blindSpots) if (b.url) hrefs.add(b.url);
  return { hrefs, tagByHref };
}

// ---------------------------------------------------------------- helpers

function absolute(origin: string, href: string): string {
  return href.startsWith('/') ? origin + href : href;
}

function normWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const isElement = (n: ParsedNode): n is ParsedElement => n.nodeType === NodeType.ELEMENT_NODE;

// Plain-text paragraphs from the citation-gated column HTML: one entry per
// p/h2/h3/blockquote/li, in document order. Not a full HTML-to-text
// converter, just enough for the discrete allowedTags set lib/citations.ts
// permits (p/br/strong/em/u/ul/ol/li/a/h2/h3/blockquote/code).
function htmlToParagraphs(html: string): string[] {
  const root = parse(html);
  const BLOCK_TAGS = new Set(['p', 'h2', 'h3', 'blockquote']);
  const paras: string[] = [];
  function walk(node: ParsedNode): void {
    if (node.nodeType === NodeType.TEXT_NODE) {
      const t = normWs(node.text);
      if (t) paras.push(t);
      return;
    }
    if (!isElement(node)) return;
    const tag = node.tagName?.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      for (const child of node.childNodes) {
        if (isElement(child) && child.tagName?.toLowerCase() === 'li') {
          const t = normWs(child.text);
          if (t) paras.push(t);
        }
      }
      return;
    }
    if (tag && BLOCK_TAGS.has(tag)) {
      const t = normWs(node.text);
      if (t) paras.push(t);
      return;
    }
    for (const child of node.childNodes) walk(child);
  }
  for (const child of root.childNodes) walk(child);
  return paras;
}

function extractLinks(html: string): { text: string; href: string }[] {
  const root = parse(html);
  return root
    .querySelectorAll('a')
    .map((a) => ({ text: normWs(a.text), href: a.getAttribute('href') ?? '' }))
    .filter((l) => l.href);
}

// Greedily packs paragraphs into up to `maxSlides` slides of roughly
// `maxChars` characters each; once the slide cap is reached, any remaining
// paragraphs land on the last slide rather than being dropped.
function chunkParagraphs(paragraphs: string[], maxChars: number, maxSlides: number): string[][] {
  const slides: string[][] = [];
  let cur: string[] = [];
  let curLen = 0;
  for (const p of paragraphs) {
    if (cur.length > 0 && curLen + p.length > maxChars && slides.length < maxSlides - 1) {
      slides.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(p);
    curLen += p.length;
  }
  if (cur.length > 0) slides.push(cur);
  return slides;
}

function paraToBullet(p: string): Bullet {
  const words = p.split(/\s+/).filter(Boolean);
  const lead = words.slice(0, 3).join(' ');
  const text = words.slice(3).join(' ');
  return { lead, text };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- deck

export function buildEditionDeck(edition: SavedEdition, origin: string): CostDeck {
  const { pack, narrative } = edition;
  const abs = (href: string) => absolute(origin, href);
  const slides: DeckSlide[] = [];

  const frontLeadHeadline = narrative.front[0]?.headline ?? pack.clusters[0]?.lead.headline ?? 'Daily edition';

  slides.push({
    kind: 'title',
    kicker: `DAILY EDITION · No. ${pack.issueNumber}`,
    title: frontLeadHeadline,
    subtitle: `${dateLabel(pack.day) ?? pack.day} · ${pack.numbers.itemsRead} items read from ${pack.numbers.outlets} outlets`,
    bigStat: { n: String(pack.numbers.clusters), l: "stories clustered from the day's intake" },
    date: pack.day,
  });

  // ---- numbers strip + markets ------------------------------------------

  const numberStats = [
    { n: String(pack.numbers.itemsRead), l: 'Items read' },
    { n: String(pack.numbers.outlets), l: 'Outlets' },
    { n: String(pack.numbers.signalsPublished), l: 'Signals published' },
    { n: String(pack.numbers.papersKept), l: 'Papers kept' },
    { n: String(pack.numbers.clusters), l: 'Stories' },
    ...(pack.numbers.newTools > 0 ? [{ n: String(pack.numbers.newTools), l: 'New tools' }] : []),
  ];
  slides.push({
    kind: 'stat-grid',
    kicker: 'The day',
    title: 'Today, by the numbers',
    stats: numberStats,
    takeaway: `${pack.numbers.clusters} stories clustered from ${pack.numbers.itemsRead} items across ${pack.numbers.outlets} outlets.`,
  });

  if (pack.markets && pack.markets.rows.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'Markets',
      title: 'Markets at press time',
      bullets: pack.markets.rows.map((m) => ({
        lead: `${m.label} ${m.price.toFixed(m.price >= 100 ? 0 : 2)}`,
        text: fmtChange(m.changePct),
      })),
      takeaway: 'An unofficial feed, priced at edition time.',
    });
  }

  // ---- front items --------------------------------------------------------

  const frontN = narrative.front.length;
  narrative.front.forEach((item, i) => {
    const bullets: Bullet[] = [{ lead: 'Why it matters', text: item.why }];
    if (item.numbers) bullets.push({ lead: 'By the numbers', text: item.numbers });
    bullets.push({ lead: 'Coverage', text: item.coverage });
    bullets.push({ lead: 'Go deeper', text: item.goDeeperLabel, href: abs(item.goDeeperHref) });
    slides.push({
      kind: 'bullets',
      kicker: `FRONT · ${i + 1}/${frontN}`,
      title: item.headline,
      bullets,
      takeaway: '',
    });
  });

  // ---- the column -----------------------------------------------------

  slides.push({
    kind: 'divider',
    kicker: 'The column',
    title: narrative.column.title,
    subtitle: '',
  });

  const allow = allowlistForEditionPure(pack);
  const { html: gatedColumnHtml } = enforceCitations(narrative.column.html, allow);
  const paragraphs = gatedColumnHtml ? htmlToParagraphs(gatedColumnHtml) : [];
  const columnChunks = chunkParagraphs(paragraphs, 700, 3);
  columnChunks.forEach((paras, i) => {
    slides.push({
      kind: 'bullets',
      kicker: `THE COLUMN · ${i + 1}/${columnChunks.length}`,
      title: narrative.column.title,
      bullets: paras.map(paraToBullet),
      takeaway: '',
    });
  });

  const links = gatedColumnHtml ? extractLinks(gatedColumnHtml) : [];
  if (links.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'The column · links',
      title: 'Links from the column',
      bullets: links.map((l) => ({ lead: l.text || l.href, text: '', href: abs(l.href) })),
      takeaway: '',
    });
  }

  // ---- things happen -----------------------------------------------------

  const thingsChunks = chunk(pack.thingsHappen, 7);
  thingsChunks.forEach((group, i) => {
    slides.push({
      kind: 'bullets',
      kicker: `THINGS HAPPEN · ${i + 1}/${thingsChunks.length}`,
      title: 'Things happen',
      bullets: group.map((t) => ({
        lead: t.headline,
        text: '',
        href: abs(t.href ?? t.url),
        meta: `${t.domain}${t.tier ? ` · T${t.tier}` : ''}`,
      })),
      takeaway: '',
    });
  });

  // ---- what builders are reading -----------------------------------------

  if (pack.hn && pack.hn.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'What builders are reading',
      title: 'What builders are reading',
      bullets: pack.hn.map((h) => ({
        lead: h.title,
        text: `${h.points} points · ${h.comments} comments`,
        href: h.url ?? h.hnUrl,
      })),
      takeaway: '',
    });
  }

  // ---- research / tools / blind spots ------------------------------------

  if (pack.papers.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'Research',
      title: 'Research',
      bullets: pack.papers.map((p) => ({ lead: p.title, text: p.whoCares ?? '', href: abs(p.href) })),
      takeaway: '',
    });
  }

  if (pack.tools.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'Tools',
      title: 'Tools',
      bullets: pack.tools.map((t) => ({
        lead: t.name,
        text: t.oneLiner ?? (t.vendor ? `By ${t.vendor}.` : ''),
        href: abs(t.href),
      })),
      takeaway: '',
    });
  }

  if (pack.blindSpots.length > 0) {
    slides.push({
      kind: 'bullets',
      kicker: 'Blind spots',
      title: 'Blind spots',
      bullets: pack.blindSpots.map((b) => ({
        lead: b.headline,
        text: '',
        ...(b.url ? { href: abs(b.url) } : {}),
      })),
      takeaway: '',
    });
  }

  // ---- sources --------------------------------------------------------

  slides.push({
    kind: 'bullets',
    kicker: 'Sources',
    title: 'Sources',
    bullets: pack.sources.map((s) => ({
      lead: s.domain,
      text: `${s.count} items${s.tier ? `, tier ${s.tier}` : ''}`,
    })),
    takeaway: `${pack.numbers.outlets} outlets read today`,
  });

  // ---- close ------------------------------------------------------------

  slides.push({
    kind: 'divider',
    kicker: 'Close',
    title: 'Every link resolves to a stored record or its source.',
    subtitle: dateLabel(pack.generatedAt) ?? '',
  });

  return { generatedOn: pack.day, slides };
}
