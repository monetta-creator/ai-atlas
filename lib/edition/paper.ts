import { parse, NodeType } from 'node-html-parser';
import type { HTMLElement as ParsedElement, Node as ParsedNode } from 'node-html-parser';
import { enforceCitations } from '../citations.ts';
import { dateLabel } from '../format.ts';
import { fmtChange } from './markets.ts';
import { allowlistForEdition, deDash } from './pure.ts';
import { balanceColumns, cleanBlindSpots, groupByDesk } from './desks.ts';
import type { SavedEdition, EditionThing } from './types';

// The Daily Edition's newspaper PDF, data half (2026-09-26). buildEditionPaper
// turns a SavedEdition into a flat, print-ready view model that
// lib/pdf/edition-paper.tsx lays out on US Letter: masthead with the online
// link, almanac row, the front (lead + secondary items), The industry strip,
// the column in two balanced text columns, Things happen by desk in three
// balanced columns, research, Hacker News, sources, blind spots. Pure and
// DB-free (explicit .ts imports) so scripts/test-edition-paper.mjs loads it
// under plain Node. The 16:9 deck (./deck.ts) is the secondary format.

export interface PaperBrief {
  headline: string;
  href: string;             // absolute: the in-app record when one exists, else the source
  domain: string;
  tier: number | null;
  inAtlas: boolean;
}

export interface PaperFront {
  headline: string;
  why: string;
  numbers: string | null;
  coverage: string;         // '' when a single plain outlet
  href: string;             // absolute
  label: string;
}

export interface PaperDesk {
  label: string;
  items: PaperBrief[];
}

export interface PaperModel {
  day: string;
  masthead: { wordmark: string; dateLabel: string; issue: string; onlineUrl: string };
  numbers: { n: number; label: string }[];
  markets: { label: string; price: string; change: string; dir: 'up' | 'down' | 'flat' }[];
  lead: PaperFront | null;
  secondary: PaperFront[];
  industry: PaperBrief[];
  column: { title: string; halves: [string, string] } | null;
  thingsCount: number;
  deskColumns: PaperDesk[][];      // columns of desk blocks, balanced by item count
  researchHead: string;
  research: { title: string; href: string; whoCares: string | null }[];
  hn: { title: string; href: string; meta: string }[];
  sourcesHead: string;
  sourcesLine: string;             // "domain 12 · domain 9 · ..."
  blindSpots: { headline: string; href: string | null }[];
  footer: string;
}

// ---------------------------------------------------------------- helpers

const absolute = (origin: string, href: string): string => (href.startsWith('/') ? origin + href : href);

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`);

const isElement = (n: ParsedNode): n is ParsedElement => n.nodeType === NodeType.ELEMENT_NODE;

function brief(origin: string, t: EditionThing): PaperBrief {
  const href = t.href ?? t.url;
  return {
    headline: deDash(t.headline),
    href: absolute(origin, href),
    domain: t.domain,
    tier: t.tier,
    inAtlas: href.startsWith('/'),
  };
}

// Split the gated column HTML into two halves of roughly equal text length,
// at top-level block boundaries. <code> is unwrapped first: the column is
// model markdown, so backticks arrive as <code>, and lib/pdf/shell.tsx sets
// <code> in JetBrains Mono, whose contextual alternates crash fontkit on
// uncontrolled text (see the mono note in shell.tsx). One block yields a
// second half that is empty; the renderer then prints a single column.
export function splitColumnHtml(html: string): [string, string] {
  const root = parse(html);
  for (const code of root.querySelectorAll('code')) code.replaceWith(code.innerHTML);
  const blocks = root.childNodes.filter((n) => (isElement(n) ? true : n.text.trim().length > 0));
  const lengths = blocks.map((b) => b.text.replace(/\s+/g, ' ').trim().length);
  const total = lengths.reduce((a, b) => a + b, 0);
  let acc = 0;
  let cut = blocks.length;
  for (let i = 0; i < blocks.length; i += 1) {
    acc += lengths[i];
    // Cut after the block that carries the midpoint past half, unless that
    // block alone would leave the right column with nothing.
    if (acc >= total / 2) {
      cut = i + 1;
      break;
    }
  }
  if (cut >= blocks.length && blocks.length > 1) cut = blocks.length - 1;
  const ser = (ns: ParsedNode[]) => ns.map((n) => n.toString()).join('');
  return [ser(blocks.slice(0, cut)), ser(blocks.slice(cut))];
}

// ---------------------------------------------------------------- builder

export function buildEditionPaper(edition: SavedEdition, origin: string): PaperModel {
  const { pack, narrative } = edition;
  const allow = allowlistForEdition(pack);
  const day = pack.day;
  const dayLabel = dateLabel(day) ?? day;

  const front: PaperFront[] = narrative.front.map((f) => ({
    headline: deDash(f.headline),
    why: deDash(f.why),
    numbers: f.numbers ? deDash(f.numbers) : null,
    coverage: f.coverage === '1 outlet' ? '' : deDash(f.coverage ?? ''),
    href: absolute(origin, f.goDeeperHref),
    label: f.goDeeperLabel,
  }));

  const numbers = [
    { n: pack.numbers.itemsRead, l: 'Items read' },
    { n: pack.numbers.outlets, l: 'Outlets' },
    { n: pack.numbers.signalsPublished, l: 'Signals' },
    { n: pack.numbers.papersKept, l: 'Papers' },
    ...(pack.numbers.newTools > 0 ? [{ n: pack.numbers.newTools, l: 'New tools' }] : []),
    { n: pack.numbers.clusters, l: 'AI stories' },
  ].map((c) => ({ n: c.n, label: c.l }));

  const markets = (pack.markets?.rows ?? []).map((m) => ({
    label: m.label,
    price: m.price.toFixed(m.price >= 100 ? 0 : 2),
    change: fmtChange(m.changePct),
    dir: (m.changePct > 0 ? 'up' : m.changePct < 0 ? 'down' : 'flat') as 'up' | 'down' | 'flat',
  }));

  const gated = enforceCitations(narrative.column.html, allow);
  const columnHtml = gated.html ?? '';
  const column = columnHtml.trim()
    ? { title: deDash(narrative.column.title), halves: splitColumnHtml(columnHtml) }
    : null;

  const things = pack.thingsHappen;
  const desks = groupByDesk(things).map((g) => ({ label: g.label, items: g.items.map((t) => brief(origin, t)) }));
  // A desk longer than 12 briefs splits into two blocks so no wrap={false}
  // block outgrows a page (react-pdf clips silently past that).
  const blocks: PaperDesk[] = [];
  for (const d of desks) {
    if (d.items.length <= 12) blocks.push(d);
    else for (let i = 0; i < d.items.length; i += 12) blocks.push({ label: i === 0 ? d.label : `${d.label} (cont.)`, items: d.items.slice(i, i + 12) });
  }
  const deskColumns = balanceColumns(blocks, 3, (b) => 1.5 + b.items.length);

  const research = pack.papers.map((p) => ({
    title: deDash(p.title),
    href: absolute(origin, p.href),
    whoCares: p.whoCares ? clip(deDash(p.whoCares), 220) : null,
  }));
  const researchHead =
    pack.numbers.papersKept > research.length
      ? `Research · ${pack.numbers.papersKept} analyzed, top ${research.length}`
      : `Research · ${research.length} analyzed`;

  const hn = (pack.hn ?? []).map((h) => ({
    title: deDash(h.title),
    href: h.url ?? h.hnUrl,
    meta: `${h.points} points · ${h.comments} comments`,
  }));

  const sourcesLine = pack.sources.map((src) => `${src.domain} ${src.count}`).join(' · ');
  const sourcesHead = `Sources · ${pack.numbers.outlets} outlets across ${pack.numbers.itemsRead} items`;

  const blindSpots = cleanBlindSpots(pack.blindSpots.map((b) => ({ headline: b.headline, url: b.url, covered: false }))).map(
    (b) => ({ headline: deDash(b.headline), href: b.url })
  );

  const footer =
    `Generated ${dateLabel(pack.generatedAt) ?? pack.generatedAt.slice(0, 10)} from ${pack.numbers.itemsRead} items the ` +
    `engines stored; every link resolves to a stored record or its source.` +
    (pack.markets ? ` Market prices as of ${new Date(pack.markets.asOf).toISOString().slice(11, 16)} UTC, unofficial feed.` : '');

  return {
    day,
    masthead: {
      wordmark: 'THE AI ATLAS',
      dateLabel: dayLabel,
      issue: `No. ${pack.issueNumber}`,
      onlineUrl: `${origin}/blotter/${day}`,
    },
    numbers,
    markets,
    lead: front[0] ?? null,
    secondary: front.slice(1),
    industry: (pack.industry ?? []).map((t) => brief(origin, t)),
    column,
    thingsCount: things.length,
    deskColumns,
    researchHead,
    research,
    hn,
    sourcesHead,
    sourcesLine,
    blindSpots,
    footer,
  };
}

export function editionPaperFilename(day: string): string {
  return `atlas-edition-${day}.pdf`;
}
