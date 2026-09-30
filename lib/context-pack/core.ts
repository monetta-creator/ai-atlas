// The company context pack, the pure half: everything the Atlas holds about one
// registry company, rendered as prompt-ready markdown for a model that runs
// somewhere the Atlas cannot reach. Three outputs from one input:
//
//   base    about 10k tokens, always-on context
//   brief   about 50k tokens, a deep single-company read
//   corpus  every section as a row, for full-text and vector retrieval
//
// Rules this file encodes:
//   * Public fields only. The input type has no `notes` and no `dossier`, so
//     neither can reach a pack (scripts/test-context-pack.mjs asserts it).
//   * The company's name comes from the input row, never from code.
//   * Every figure is rendered by code from a metric row. Model-written text
//     (the section briefs) is labeled, link-gated and number-gated.
//   * Deterministic: the same input renders the same bytes.
//
// Plain-Node loadable: no DB, no model, no framework import. The DB reader is
// lib/context-pack/load.ts.

import { METRIC_DEFS, METRIC_SOURCE_LABEL, metricSourceUrl } from '../savant/metric-codes.ts';
import type { MetricDef } from '../savant/metric-codes.ts';

// ---------------------------------------------------------------- input

export interface PackCompany {
  slug: string;
  name: string;
  tier: string;
  publicBlurb: string | null;
  domain?: string | null;       // for the entity mark on the Briefcase page; never rendered into a pack
  deepRecord: boolean;          // a backfilled public record exists (profile, timeline, documents)
  ids: { cik?: string | number | null; fdic_cert?: string | null; rssd_id?: string | null; cfpb_name?: string | null; ats_board?: string | null };
}

export interface PackProfileSentence { text: string; urls: string[] }
export interface PackTimelineEvent { date: string; category: string; headline: string; body: string | null; urls: string[] }
export interface PackRecord {
  source: string; title: string; url: string; date: string | null;
  summary: string | null; aiRelated: boolean; aiPassages: string[];
}
export interface PackFact { dimension: string; fact: string; valueText: string | null; asOf: string | null; url: string | null }
export interface PackItem {
  headline: string; url: string; domain: string | null; date: string | null;
  summary: string | null; significance: number | null;
}
export interface PackMetricSeries { code: string; points: { period: string; value: number }[] }   // newest first
export interface PackPeerRow {
  name: string; tier: string; isSubject: boolean;
  cells: { code: string; value: number | null; period: string | null }[];
  urls: string[];
}
export interface PackBrief { sectionId: string; body: string; citeUrls: string[]; model: string | null; weekEnd: string }

export interface PackInput {
  asOf: string;                 // YYYY-MM-DD, the build day
  company: PackCompany;
  profile: PackProfileSentence[];
  timeline: PackTimelineEvent[];
  records: PackRecord[];
  facts: PackFact[];
  items: PackItem[];
  metrics: PackMetricSeries[];
  peerCodes: string[];
  peers: PackPeerRow[];
  briefs: PackBrief[];
}

// ---------------------------------------------------------------- output

export type PackSize = 'base' | 'brief';
export type SectionKind = 'guide' | 'profile' | 'timeline' | 'metrics' | 'peers' | 'facts' | 'news' | 'record' | 'brief' | 'check';
export type Provenance = 'record' | 'model';

export interface PackSection {
  id: string;
  title: string;
  kind: SectionKind;
  provenance: Provenance;
  position: number;
  markdown: string;
  tokens: number;
  citeUrls: string[];
  inBase: boolean;
  inBrief: boolean;
}

export interface PackDocument { size: PackSize; markdown: string; tokens: number; budget: number; citeUrls: string[] }

export const TIER_BUDGET: Record<PackSize, number> = { base: 10_000, brief: 50_000 };
export const CORPUS_ROW_TOKENS = 2_000;
export const BRIEF_MAX_WORDS = 140;
export const BRIEF_LABEL = 'Model-written brief. The records below are the source.';

// The sections a weekly brief is written for, in reading order. The metrics
// and peers sections are deliberately absent: they are tables of figures, and
// the first live briefs over them (2026-09-29) compared two different series
// as one and explained moves the data does not explain. Figures stay with code.
export const BRIEFABLE = ['timeline', 'facts', 'recent', 'record-sec_filing', 'record-paper', 'record-news'] as const;

// ---------------------------------------------------------------- small helpers

// Characters / 4 is the usual English average; the 1.3 factor covers URLs,
// figures and the longer tokenizations of newer models. A ceiling, by design.
export function estimateTokens(s: string): number {
  return Math.ceil((s.length / 4) * 1.3);
}

export function oneLine(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = cut.lastIndexOf(' ');
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, '')}...`;
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v); const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

// FDIC and Y-9C report in thousands of dollars, EDGAR in dollars: the unit
// comes from the metric definition, never from the stored row.
export function fmtValue(value: number, unit: MetricDef['unit']): string {
  if (!Number.isFinite(value)) return '';
  switch (unit) {
    case 'usd_thousands': return fmtUsd(value * 1000);
    case 'usd': return fmtUsd(value);
    case 'percent': return `${value.toFixed(2)}%`;
    case 'ratio': return value.toFixed(3);
    case 'per_share': return `$${value.toFixed(2)}`;
    case 'count': return Math.round(value).toLocaleString('en-US');
  }
}

const UNIT_LABEL: Record<MetricDef['unit'], string> = {
  usd_thousands: 'US dollars', usd: 'US dollars', percent: 'percent', ratio: 'ratio', per_share: 'dollars per share', count: 'count',
};

const SOURCE_TITLE: Record<string, string> = {
  sec_filing: 'SEC filings', sec_exhibit: 'Press releases filed with the SEC', news: 'News coverage',
  newsroom: 'Company newsroom', paper: 'Research papers', patent: 'Patents', enforcement: 'Enforcement actions',
  comment_letter: 'Comment letters', merger: 'Merger filings', testimony: 'Congressional testimony',
};
const SOURCE_ORDER = ['sec_filing', 'sec_exhibit', 'merger', 'comment_letter', 'enforcement', 'testimony', 'news', 'newsroom', 'paper', 'patent'];

const ACRONYMS: Record<string, string> = { ma: 'M&A', ai: 'AI', ml: 'ML', us: 'US', ipo: 'IPO', api: 'API', bnpl: 'BNPL', esg: 'ESG' };
const humanize = (code: string) => {
  const s = code.split('_').filter(Boolean).map((w) => ACRONYMS[w.toLowerCase()] ?? w).join(' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// The order facts are dealt in when a tier has room for only some: what an AI
// transformation reader asks about first. Unlisted dimensions follow, by name.
const DIMENSION_ORDER = ['tech_ai', 'strategy', 'products', 'ma_partnerships', 'financials', 'regulatory', 'risk', 'leadership', 'talent', 'customers'];
const dimensionRank = (d: string) => { const i = DIMENSION_ORDER.indexOf(d); return i === -1 ? DIMENSION_ORDER.length : i; };

const cell = (s: string) => s.replace(/\|/g, '/');

// ---------------------------------------------------------------- blocks

// One line of a block at three depths: `short` for base, `full` for brief,
// `deep` for the corpus rows. A missing depth falls back to the shallower one.
interface Line {
  key: string;
  short: string;
  full?: string;
  deep?: string;
  urls: string[];
  group?: string;               // corpus grouping (a year, a month, a dimension)
}

interface Block {
  id: string;
  title: string;
  kind: SectionKind;
  intro?: string;
  head?: string;                // a table header, printed before the lines
  refColumn?: boolean;          // table rows end with a references cell
  lines: Line[];                // most important first: tiers trim from the tail
  groupLabel?: (g: string) => string;
}

const textAt = (l: Line, depth: 'short' | 'full' | 'deep'): string =>
  depth === 'deep' ? (l.deep ?? l.full ?? l.short) : depth === 'full' ? (l.full ?? l.short) : l.short;

function guideBlock(input: PackInput): Block {
  const c = input.company;
  const has = (n: number, what: string) => (n ? `${n.toLocaleString('en-US')} ${what}` : null);
  const holds = [
    has(input.profile.length, 'profile sentences'), has(input.timeline.length, 'timeline events'),
    has(input.records.length, 'public documents'), has(input.facts.length, 'extracted facts'),
    has(input.items.length, 'tracked news items'), has(input.metrics.length, 'metric series'),
  ].filter(Boolean).join(', ');
  const lines = [
    `This file describes ${c.name} from public records only, as of ${input.asOf}. It was compiled by The AI Atlas. It holds ${holds || 'no records yet'}.`,
    'Every statement ends with numbered references like [3]. The Sources section at the end maps each number to a public URL.',
    'Every figure was rendered by code from a public data series. Dollar figures are in US dollars. Series marked "year to date or mixed periods" must not be differenced quarter to quarter.',
    `Paragraphs under the line "${BRIEF_LABEL}" were written by a language model from the records in that section. Treat them as orientation. Quote and cite the records, not the brief.`,
    c.deepRecord
      ? 'The profile and the timeline were synthesized by a language model from the cited documents and each sentence was checked to cite a real record.'
      : 'This company has no backfilled public record, so there is no cited profile and no timeline. The file is built from recently tracked news, extracted facts and public metrics.',
    'If this file and a primary source disagree, the primary source is right. If something is not in this file, say so instead of guessing.',
  ];
  return { id: 'about', title: 'How to read this file', kind: 'guide', lines: lines.map((t, i) => ({ key: `g${i}`, short: `- ${t}`, urls: [] })) };
}

function profileBlock(input: PackInput): Block | null {
  if (input.profile.length) {
    return {
      id: 'profile', title: 'Profile', kind: 'profile',
      lines: input.profile.map((s, i) => ({ key: `p${i}`, short: `- ${oneLine(s.text)}`, urls: s.urls })),
    };
  }
  const blurb = oneLine(input.company.publicBlurb);
  if (!blurb) return null;
  return { id: 'profile', title: 'Profile', kind: 'profile', lines: [{ key: 'p0', short: `- ${blurb}`, urls: [] }] };
}

function timelineBlock(input: PackInput): Block | null {
  if (!input.timeline.length) return null;
  const events = [...input.timeline].sort((a, b) => b.date.localeCompare(a.date) || a.headline.localeCompare(b.headline));
  return {
    id: 'timeline', title: 'Timeline', kind: 'timeline',
    intro: 'Newest first.',
    groupLabel: (g) => g,
    lines: events.map((e, i) => {
      const head = `- ${e.date} · ${humanize(e.category)} · ${oneLine(e.headline)}`;
      const body = oneLine(e.body);
      return { key: `t${i}:${e.date}`, short: head, full: body ? `${head}. ${body}` : head, urls: e.urls, group: e.date.slice(0, 4) };
    }),
  };
}

function metricsBlock(input: PackInput): Block | null {
  const byCode = new Map(input.metrics.map((m) => [m.code, m]));
  const lines: Line[] = [];
  for (const def of METRIC_DEFS) {
    const series = byCode.get(def.code);
    if (!series || !series.points.length) continue;
    const url = metricSourceUrl(def.source, input.company.ids);
    const caveat = def.anomalyEligible === false ? ', year to date or mixed periods' : '';
    const label = `- **${def.label}** (${UNIT_LABEL[def.unit]}, ${METRIC_SOURCE_LABEL[def.source]}${caveat}):`;
    const run = (n: number) => series.points.slice(0, n).map((p) => `${p.period}: ${fmtValue(p.value, def.unit)}`).join(' · ');
    lines.push({
      key: `m:${def.code}`, short: `${label} ${run(4)}`, full: `${label} ${run(20)}`, deep: `${label} ${run(series.points.length)}`,
      urls: url ? [url] : [], group: def.group,
    });
  }
  if (!lines.length) return null;
  return {
    id: 'metrics', title: 'Public metrics', kind: 'metrics',
    intro: 'Each line is one public data series, newest period first. Periods are period-end dates.',
    groupLabel: humanize, lines,
  };
}

function peersBlock(input: PackInput): Block | null {
  const rows = input.peers.filter((r) => r.isSubject || r.cells.filter((c) => c.value != null).length >= 2);
  if (rows.length < 2) return null;
  const defs = input.peerCodes.map((code) => METRIC_DEFS.find((d) => d.code === code)).filter((d): d is MetricDef => Boolean(d));
  if (!defs.length) return null;
  const subject = rows.find((r) => r.isSubject);
  const rank = (r: PackPeerRow) => (r.isSubject ? 0 : subject && r.tier === subject.tier ? 1 : 2);
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.tier.localeCompare(b.tier) || a.name.localeCompare(b.name));
  const head = [
    `| Company | Tier | ${defs.map((d) => cell(d.label)).join(' | ')} | Sources |`,
    `|---|---|${defs.map(() => '---').join('|')}|---|`,
  ].join('\n');
  return {
    id: 'peers', title: 'Peer comparison', kind: 'peers',
    intro: 'Latest reported period per company, with the period-end month in parentheses. A dash means the series is not reported for that company.',
    head, refColumn: true,
    lines: sorted.map((r) => {
      const cells = defs.map((d) => {
        const c = r.cells.find((x) => x.code === d.code);
        return c && c.value != null ? `${fmtValue(c.value, d.unit)}${c.period ? ` (${c.period.slice(0, 7)})` : ''}` : '-';
      });
      const name = r.isSubject ? `**${cell(r.name)}**` : cell(r.name);
      return { key: `peer:${r.name}`, short: `| ${name} | ${humanize(r.tier)} | ${cells.join(' | ')} |`, urls: r.urls };
    }),
  };
}

// Round-robin across groups so a trimmed list keeps every group represented.
function roundRobin<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i += 1) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

function factsBlock(input: PackInput): Block | null {
  if (!input.facts.length) return null;
  const byDim = new Map<string, PackFact[]>();
  for (const f of input.facts) {
    const list = byDim.get(f.dimension) ?? [];
    list.push(f); byDim.set(f.dimension, list);
  }
  const dims = [...byDim.keys()].sort((a, b) => dimensionRank(a) - dimensionRank(b) || a.localeCompare(b));
  const groups = dims.map((d) => byDim.get(d)!.sort((a, b) => (b.asOf ?? '').localeCompare(a.asOf ?? '') || a.fact.localeCompare(b.fact)));
  const ordered = roundRobin(groups);
  return {
    id: 'facts', title: 'Extracted facts', kind: 'facts',
    intro: 'Facts a model extracted from tracked news and filings. Each cites the document it came from.',
    groupLabel: humanize,
    lines: ordered.map((f, i) => {
      const value = oneLine(f.valueText);
      const text = `- ${humanize(f.dimension)}: ${oneLine(f.fact)}${value ? ` (${value})` : ''}${f.asOf ? ` · as of ${f.asOf}` : ''}`;
      return { key: `f${i}`, short: clip(text, 320), full: text, urls: f.url ? [f.url] : [], group: f.dimension };
    }),
  };
}

function recentBlock(input: PackInput): Block | null {
  if (!input.items.length) return null;
  const items = [...input.items].sort((a, b) =>
    (b.significance ?? -1) - (a.significance ?? -1) || (b.date ?? '').localeCompare(a.date ?? '') || a.url.localeCompare(b.url));
  return {
    id: 'recent', title: 'Recent developments', kind: 'news',
    intro: 'Tracked news and filings, most significant first. Summaries were written by a model from the linked article.',
    groupLabel: (g) => g,
    lines: items.map((it) => {
      const head = `- ${[it.date, it.domain].filter(Boolean).join(' · ')}${it.date || it.domain ? ' · ' : ''}**${oneLine(it.headline) || it.url}**`;
      const sum = oneLine(it.summary);
      return {
        key: `i:${it.url}`, short: sum ? `${head}: ${clip(sum, 220)}` : head, full: sum ? `${head}: ${sum}` : head,
        urls: [it.url], group: (it.date ?? 'undated').slice(0, 7),
      };
    }),
  };
}

function recordOverviewBlock(input: PackInput): Block | null {
  if (!input.records.length) return null;
  const lines: Line[] = [];
  for (const source of SOURCE_ORDER) {
    const rows = input.records.filter((r) => r.source === source);
    if (!rows.length) continue;
    const dates = rows.map((r) => r.date).filter((d): d is string => Boolean(d)).sort();
    const ai = rows.filter((r) => r.aiRelated).length;
    const span = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : '-';
    lines.push({ key: `o:${source}`, short: `| ${SOURCE_TITLE[source] ?? humanize(source)} | ${rows.length.toLocaleString('en-US')} | ${ai.toLocaleString('en-US')} | ${span} |`, urls: [] });
  }
  return {
    id: 'record-overview', title: 'What the public record holds', kind: 'record',
    head: '| Source | Documents | AI-related | Dates |\n|---|---|---|---|',
    lines,
  };
}

function recordBlocks(input: PackInput): Block[] {
  const out: Block[] = [];
  for (const source of SOURCE_ORDER) {
    const rows = input.records
      .filter((r) => r.source === source)
      .sort((a, b) => Number(b.aiRelated) - Number(a.aiRelated) || (b.date ?? '').localeCompare(a.date ?? '') || a.url.localeCompare(b.url));
    if (!rows.length) continue;
    out.push({
      id: `record-${source}`, title: SOURCE_TITLE[source] ?? humanize(source), kind: 'record',
      intro: 'AI-related documents first, then newest first.',
      groupLabel: (g) => g,
      lines: rows.map((r) => {
        const title = oneLine(r.title);
        const head = `- ${r.date ?? 'undated'} · **${title}**${r.aiRelated ? ' · AI-related' : ''}`;
        const sum = oneLine(r.summary);
        const withSum = sum && sum !== title ? `${head}: ${sum}` : head;
        // Patent passages repeat the title, so a passage equal to it is noise.
        const passages = r.aiPassages.map(oneLine).filter((p) => p && p !== title);
        const quote = (list: string[], n: number) => list.map((p) => `\n  > ${clip(p, n)}`).join('');
        return {
          key: `r:${r.url}`, short: head,
          full: `${withSum}${quote(passages.slice(0, 2), 500)}`,
          deep: `${withSum}${quote(passages, 1200)}`,
          urls: [r.url], group: (r.date ?? 'undated').slice(0, 4),
        };
      }),
    });
  }
  return out;
}

export function buildBlocks(input: PackInput): Block[] {
  return [
    guideBlock(input), profileBlock(input), timelineBlock(input), metricsBlock(input), peersBlock(input),
    factsBlock(input), recentBlock(input), recordOverviewBlock(input), ...recordBlocks(input),
  ].filter((b): b is Block => Boolean(b && b.lines.length));
}

// ---------------------------------------------------------------- tiers

// Token allowance per block family. `fill` is the order leftover budget is
// handed out in: what a reader loses last.
const ALLOW: Record<PackSize, Record<string, number>> = {
  base: {
    about: 600, profile: 3000, timeline: 1400, metrics: 1600, peers: 900, facts: 800, recent: 900, 'record-overview': 400,
  },
  brief: {
    about: 600, profile: 3500, timeline: 12000, metrics: 5000, peers: 2500, facts: 6500, recent: 9000, 'record-overview': 500,
    'record-sec_filing': 3000, 'record-news': 2000, 'record-paper': 1500, 'record-patent': 1000,
    'record-sec_exhibit': 500, 'record-merger': 500, 'record-comment_letter': 400, 'record-enforcement': 300,
    'record-testimony': 300, 'record-newsroom': 400,
  },
};
const BRIEFS_ALLOW: Record<PackSize, number> = { base: 1200, brief: 1500 };
const FILL = [
  'profile', 'timeline', 'facts', 'recent', 'metrics', 'record-sec_filing', 'record-news', 'peers', 'record-paper',
  'record-merger', 'record-comment_letter', 'record-enforcement', 'record-testimony', 'record-sec_exhibit',
  'record-newsroom', 'record-patent',
];

const sourceLine = (n: number, url: string) => `[${n}] ${url}`;

interface Picked { block: Block; count: number; brief: PackBrief | null }

// Priority fill: every block takes lines from the top of its list until its
// allowance is spent, then leftover budget extends blocks in FILL order. A
// line is never split; a block that cannot afford one line is left out.
export function fitTier(input: PackInput, size: PackSize): Picked[] {
  const blocks = buildBlocks(input);
  const depth = size === 'base' ? 'short' : 'full';
  const budget = TIER_BUDGET[size];
  const seen = new Set<string>();
  const costOf = (l: Line): number => {
    let c = estimateTokens(`${textAt(l, depth)} [00]\n`);
    for (const u of l.urls) if (!seen.has(u)) c += estimateTokens(`${sourceLine(100, u)}\n`);
    return c;
  };
  const take = (l: Line) => { for (const u of l.urls) seen.add(u); };

  // The frame: title block, headings, the Sources heading.
  let used = estimateTokens(headerFor(input, size, 0)) + 40;
  const picked: Picked[] = blocks.map((block) => ({ block, count: 0, brief: null }));

  // Briefs first: they are short and they are what a reader meets first.
  let briefsLeft = BRIEFS_ALLOW[size];
  for (const p of picked) {
    const b = input.briefs.find((x) => x.sectionId === p.block.id);
    if (!b) continue;
    const c = estimateTokens(`${BRIEF_LABEL}\n${b.body}\n`) + b.citeUrls.filter((u) => !seen.has(u)).reduce((n, u) => n + estimateTokens(`${sourceLine(100, u)}\n`), 0);
    if (c > briefsLeft || used + c > budget) continue;
    p.brief = b; briefsLeft -= c; used += c;
    for (const u of b.citeUrls) seen.add(u);
  }

  const headCost = (b: Block) => estimateTokens(`## ${b.title}\n\n${b.intro ?? ''}\n${b.head ?? ''}\n`) + 15;
  const extend = (p: Picked, allowance: number): void => {
    let spent = 0;
    if (p.count === 0) {
      const h = headCost(p.block);
      const first = p.block.lines[0];
      if (h + costOf(first) > allowance || used + h + costOf(first) > budget) return;
      spent += h; used += h;
    }
    while (p.count < p.block.lines.length) {
      const l = p.block.lines[p.count];
      const c = costOf(l);
      if (spent + c > allowance || used + c > budget) break;
      take(l); p.count += 1; spent += c; used += c;
    }
  };

  for (const p of picked) extend(p, ALLOW[size][p.block.id] ?? 0);
  for (const id of FILL) {
    const p = picked.find((x) => x.block.id === id);
    if (!p || !(id in ALLOW[size])) continue;
    extend(p, budget - used);
  }
  return picked.filter((p) => p.count > 0 || p.brief);
}

function headerFor(input: PackInput, size: PackSize, tokens: number): string {
  const c = input.company;
  return [
    `# ${c.name}: company context, ${size} pack`,
    '',
    [
      `As of ${input.asOf}`, `registry tier: ${humanize(c.tier)}`, c.deepRecord ? 'deep record' : 'light record',
      `about ${tokens.toLocaleString('en-US')} tokens (estimate: characters / 4 x 1.3)`,
    ].join(' · '),
    '',
    'Compiled by The AI Atlas from public records.',
  ].join('\n');
}

// A brief's markdown links become numbered references, like every other line.
function numberLinks(body: string, ref: (url: string) => number): string {
  return body.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => `${text} [${ref(url)}]`);
}

export function renderTier(input: PackInput, size: PackSize): PackDocument {
  const picked = fitTier(input, size);
  const depth = size === 'base' ? 'short' : 'full';
  const urls: string[] = [];
  const index = new Map<string, number>();
  const ref = (url: string): number => {
    let n = index.get(url);
    if (!n) { urls.push(url); n = urls.length; index.set(url, n); }
    return n;
  };
  const refs = (list: string[]) => (list.length ? ` ${list.map((u) => `[${ref(u)}]`).join('')}` : '');

  const parts: string[] = [];
  for (const p of picked) {
    const b = p.block;
    const out: string[] = [`## ${b.title}`, ''];
    if (p.brief) out.push(`> ${BRIEF_LABEL}`, '>', `> ${numberLinks(oneLine(p.brief.body), ref)}`, '');
    if (p.count) {
      if (b.intro) out.push(b.intro, '');
      if (b.head) out.push(b.head);
      for (const l of b.lines.slice(0, p.count)) {
        const text = textAt(l, depth);
        // A table row carries its references in a trailing cell.
        out.push(b.refColumn ? `${text}${refs(l.urls) || ' -'} |` : b.head ? text : `${text}${refs(l.urls)}`);
      }
      const left = b.lines.length - p.count;
      if (left > 0) out.push('', `(${left.toLocaleString('en-US')} more in the section rows.)`);
    }
    parts.push(out.join('\n'));
  }
  if (urls.length) parts.push(['## Sources', '', ...urls.map((u, i) => sourceLine(i + 1, u))].join('\n'));

  const body = parts.join('\n\n');
  const tokens = estimateTokens(`${headerFor(input, size, 0)}\n\n${body}\n`);
  return { size, markdown: `${headerFor(input, size, tokens)}\n\n${body}\n`, tokens, budget: TIER_BUDGET[size], citeUrls: urls };
}

// ---------------------------------------------------------------- corpus rows

function renderRow(companyName: string, title: string, b: Block, lines: Line[]): { markdown: string; citeUrls: string[] } {
  const urls: string[] = [];
  const index = new Map<string, number>();
  const ref = (url: string): number => {
    let n = index.get(url);
    if (!n) { urls.push(url); n = urls.length; index.set(url, n); }
    return n;
  };
  const out: string[] = [`## ${companyName}: ${title}`, ''];
  if (b.intro) out.push(b.intro, '');
  if (b.head) out.push(b.head);
  for (const l of lines) {
    const text = textAt(l, 'deep');
    const marks = l.urls.map((u) => `[${ref(u)}]`).join('');
    out.push(b.refColumn ? `${text} ${marks || '-'} |` : marks ? `${text} ${marks}` : text);
  }
  if (urls.length) out.push('', 'Sources:', ...urls.map((u, i) => sourceLine(i + 1, u)));
  return { markdown: out.join('\n'), citeUrls: urls };
}

// Every section as a row: grouped (a year, a month, a dimension) and split so
// no row is much longer than CORPUS_ROW_TOKENS. Ids are stable for a given
// record: `<block>`, `<block>-<group>`, `<block>-<group>-<part>`.
export function buildSections(input: PackInput): PackSection[] {
  const name = input.company.name;
  const inTier = (size: PackSize): Map<string, number> => new Map(fitTier(input, size).map((p) => [p.block.id, p.count]));
  const base = inTier('base'); const brief = inTier('brief');
  const sections: PackSection[] = [];
  const push = (s: Omit<PackSection, 'position' | 'tokens'>) =>
    sections.push({ ...s, position: sections.length + 1, tokens: estimateTokens(s.markdown) });

  for (const b of buildBlocks(input)) {
    const stored = input.briefs.find((x) => x.sectionId === b.id);
    if (stored) {
      const body = oneLine(stored.body);
      push({
        id: `brief-${b.id}`, title: `${b.title}, brief`, kind: 'brief', provenance: 'model',
        markdown: `## ${name}: ${b.title}, brief\n\n${BRIEF_LABEL}\n\n${body}`,
        citeUrls: stored.citeUrls, inBase: true, inBrief: true,
      });
    }

    const baseKeys = new Set(b.lines.slice(0, base.get(b.id) ?? 0).map((l) => l.key));
    const briefKeys = new Set(b.lines.slice(0, brief.get(b.id) ?? 0).map((l) => l.key));
    const groups = new Map<string, Line[]>();
    const grouped = b.groupLabel != null && b.lines.some((l) => l.group);
    for (const l of b.lines) {
      const g = grouped ? (l.group ?? 'other') : '';
      const list = groups.get(g) ?? [];
      list.push(l); groups.set(g, list);
    }
    // A single group needs no suffix; several sort newest (or last) first.
    const keys = [...groups.keys()].sort((x, y) => y.localeCompare(x));
    const single = keys.length === 1;
    for (const g of keys) {
      const lines = groups.get(g)!;
      const chunks: Line[][] = [[]];
      let run = 0;
      for (const l of lines) {
        const c = estimateTokens(`${textAt(l, 'deep')}\n`) + l.urls.reduce((n, u) => n + estimateTokens(`${sourceLine(10, u)}\n`), 0);
        if (run + c > CORPUS_ROW_TOKENS && chunks[chunks.length - 1].length) { chunks.push([]); run = 0; }
        chunks[chunks.length - 1].push(l); run += c;
      }
      chunks.forEach((chunk, i) => {
        const gid = single || !g ? b.id : `${b.id}-${g.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const id = chunks.length > 1 ? `${gid}-${i + 1}` : gid;
        const gTitle = single || !g ? b.title : `${b.title}, ${b.groupLabel ? b.groupLabel(g) : g}`;
        const title = chunks.length > 1 ? `${gTitle} (part ${i + 1} of ${chunks.length})` : gTitle;
        const row = renderRow(name, title, b, chunk);
        push({
          id, title, kind: b.kind, provenance: 'record', markdown: row.markdown, citeUrls: row.citeUrls,
          inBase: chunk.some((l) => baseKeys.has(l.key)), inBrief: chunk.some((l) => briefKeys.has(l.key)),
        });
      });
    }
  }

  for (const c of buildChecks(input)) {
    push({
      id: c.id, title: `Check question ${c.n}`, kind: 'check', provenance: 'record',
      markdown: `Q: ${c.question}\nA: ${c.answer}\nAnswerable from: ${c.from}${c.url ? `\nSource: ${c.url}` : ''}`,
      citeUrls: c.url ? [c.url] : [], inBase: false, inBrief: false,
    });
  }
  return sections;
}

// ---------------------------------------------------------------- check questions

export interface PackCheck { id: string; n: number; question: string; answer: string; from: 'base' | 'brief' | 'corpus'; url: string | null }

// Questions with known answers, generated by code from the same rows the pack
// renders, so a reader inside the firewall can score a model with no context,
// the base file, the brief file, or retrieval. Never part of a prompt file.
export function buildChecks(input: PackInput): PackCheck[] {
  const name = input.company.name;
  const out: Omit<PackCheck, 'id' | 'n'>[] = [];
  const base = new Map(fitTier(input, 'base').map((p) => [p.block.id, p.count]));
  const brief = new Map(fitTier(input, 'brief').map((p) => [p.block.id, p.count]));
  const where = (blockId: string, index: number): PackCheck['from'] =>
    index < (base.get(blockId) ?? 0) ? 'base' : index < (brief.get(blockId) ?? 0) ? 'brief' : 'corpus';

  const present = METRIC_DEFS.filter((d) => input.metrics.some((m) => m.code === d.code && m.points.length));
  const wanted = ['fdic_eeffr', 'fdic_nimy', 'total_assets', 'net_income', 'cfpb_complaints_month', 'revenue'];
  const metricDefs = [...wanted.map((w) => present.find((d) => d.code === w)), ...present]
    .filter((d, i, a): d is MetricDef => Boolean(d) && a.indexOf(d) === i).slice(0, 4);
  for (const def of metricDefs) {
    const p = input.metrics.find((m) => m.code === def.code)!.points[0];
    out.push({
      question: `What was the ${def.label.toLowerCase()} of ${name} for the period ending ${p.period}, according to ${METRIC_SOURCE_LABEL[def.source]}?`,
      answer: fmtValue(p.value, def.unit), from: where('metrics', present.indexOf(def)), url: metricSourceUrl(def.source, input.company.ids),
    });
  }

  const events = [...input.timeline].sort((a, b) => b.date.localeCompare(a.date) || a.headline.localeCompare(b.headline));
  const spread = [0, Math.floor(events.length / 3), Math.floor((2 * events.length) / 3), events.length - 1]
    .filter((i, k, a) => i >= 0 && i < events.length && a.indexOf(i) === k);
  for (const i of spread) {
    const e = events[i];
    out.push({
      question: `Which event does the public timeline of ${name} place on ${e.date}?`,
      answer: oneLine(e.headline), from: where('timeline', i), url: e.urls[0] ?? null,
    });
  }

  for (const source of ['patent', 'sec_filing', 'paper']) {
    const rows = input.records.filter((r) => r.source === source);
    if (!rows.length) continue;
    const ai = rows.filter((r) => r.aiRelated).length;
    out.push({
      question: `How many documents of the kind "${SOURCE_TITLE[source]}" does the public record of ${name} hold, and how many are marked AI-related?`,
      answer: `${rows.length.toLocaleString('en-US')} documents, ${ai.toLocaleString('en-US')} AI-related`, from: 'base', url: null,
    });
  }

  const top = [...input.items].sort((a, b) =>
    (b.significance ?? -1) - (a.significance ?? -1) || (b.date ?? '').localeCompare(a.date ?? '') || a.url.localeCompare(b.url))[0];
  if (top) {
    out.push({
      question: `Which outlet published the tracked story "${oneLine(top.headline)}" about ${name}, and on what date?`,
      answer: `${top.domain ?? 'unknown outlet'}, ${top.date ?? 'undated'}`, from: 'base', url: top.url,
    });
  }
  return out.map((c, i) => ({ ...c, id: `check-${String(i + 1).padStart(2, '0')}`, n: i + 1 }));
}

// ---------------------------------------------------------------- the brief gate

const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (s: string): string[] => (s.match(NUM_RE) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, ''));

export interface GatedBrief { body: string; citeUrls: string[]; dropped: string[] }

// The deterministic gate between a model-written brief and the pack:
//   1. a link survives only when its URL is one of the section's own;
//   2. a sentence is dropped when it states a figure the section never states
//      (integers up to 10 are exempt: "three filings" is prose, not data);
//   3. the brief is capped at BRIEF_MAX_WORDS on a sentence boundary;
//   4. a brief with no surviving link is refused (null).
export function gateBrief(raw: string, allowedUrls: string[], sourceText: string): GatedBrief | null {
  const allowed = new Set(allowedUrls);
  const dropped: string[] = [];
  const text = oneLine(raw.replace(/<[^>]+>/g, ' ')).replace(/\s*\u2014\s*/g, ', ');
  const unlinked = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    if (allowed.has(url)) return m;
    dropped.push(`link: ${url}`);
    return label;
  });

  const known = new Set(numbersIn(sourceText));
  // Split after sentence punctuation that is followed by a space and a capital
  // or a link, so decimals and URLs stay inside their sentence.
  const sentences = unlinked.split(/(?<=[.!?])\s+(?=[A-Z[])/).map((x) => x.trim()).filter(Boolean);
  const kept: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const prose = s.replace(/\]\([^)]*\)/g, ']');
    const bad = numbersIn(prose).find((n) => !known.has(n) && !(Number.isInteger(Number(n)) && Number(n) <= 10));
    if (bad) { dropped.push(`figure ${bad}: ${clip(prose, 80)}`); continue; }
    const w = prose.split(/\s+/).length;
    if (words + w > BRIEF_MAX_WORDS) { dropped.push('over the word cap'); break; }
    kept.push(s); words += w;
  }
  const body = kept.join(' ');
  const citeUrls = [...new Set([...body.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)].map((m) => m[1]))];
  if (!citeUrls.length) return null;
  return { body, citeUrls, dropped };
}

// What the brief writer reads and what the gate checks against: the section
// at brief depth, one numbered line per record with its URLs spelled out.
export function briefSource(input: PackInput, sectionId: string, maxTokens = 6000): { text: string; urls: string[] } | null {
  const b = buildBlocks(input).find((x) => x.id === sectionId);
  if (!b) return null;
  const out: string[] = []; const urls = new Set<string>();
  let run = 0;
  if (b.head) out.push(b.head);
  for (const l of b.lines) {
    const line = `${textAt(l, 'full')}${l.urls.length ? ` <${l.urls.join('> <')}>` : ''}`;
    const c = estimateTokens(line);
    if (run + c > maxTokens) break;
    out.push(line); run += c;
    for (const u of l.urls) urls.add(u);
  }
  if (!urls.size) return null;
  return { text: out.join('\n'), urls: [...urls] };
}

export function briefAddsContent(base: PackDocument, brief: PackDocument): boolean {
  return brief.tokens > base.tokens * 1.15;
}
