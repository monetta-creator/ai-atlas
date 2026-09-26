// Story clustering and ranking for the daily edition (pure, Node-testable).
// The engines store the same development three times over (scan, intel,
// pipeline), each from a different outlet. A cluster is one development;
// its coverage count is how many distinct outlets reported it, the Ground
// News idea. Ranking rewards relevance, coverage and source quality.

import { isAiStory } from './desks.ts';

export type StorySource = 'scan' | 'intel' | 'pipeline' | 'signal';

export interface StoryItem {
  id: string;
  source: StorySource;
  headline: string;
  url: string;
  domain: string;              // normalized source domain
  tier: number | null;         // 1 best .. 4 junk, null unknown
  contentKind: string | null;  // news | analysis | data | press_release | marketing | opinion | other
  relevance: number | null;    // 0..1 (scan relevance / intel significance / 0.7 for approved candidates)
  publishedDate: string | null;
  summary: string | null;
  entities: string[];
  tags: string[];
  href: string | null;         // in-app record when one exists (/signals/<id>, /research/<id>)
}

export interface StoryCluster {
  id: string;                  // the lead item's id
  lead: StoryItem;
  items: StoryItem[];
  outlets: string[];           // distinct domains
  tierMix: Record<'1' | '2' | '3' | '4' | 'unknown', number>;
  entities: string[];          // union, most frequent first
  score: number;
  repeat?: boolean;            // stamped by penalizeRepeats (lib/edition/pure.ts) when it echoes a prior front
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from', 'is', 'are',
  'be', 'its', 'it', 'this', 'that', 'new', 'says', 'said', 'after', 'over', 'into', 'up', 'out', 'how', 'why',
  'what', 'will', 'has', 'have', 'amid', 'vs', 'via', 'about', 'more', 'than', 'first', 'report', 'reports',
  'ai', 'artificial', 'intelligence', 'tech', 'technology', 'company', 'companies', 'news', 'update', 'launches',
  'launch', 'announces', 'announced', 'unveils', 'introduces', 'inc', 'ltd', 'plc', 'corp', 'co',
]);

// Trailing outlet suffixes (" - FinTech Futures", " | Reuters", " - MacRumors")
// are stripped before tokenizing: they made three unrelated funding rounds
// from one outlet look like the same story (measured 2026-09-26).
const OUTLET_SUFFIX = /\s+[-|–]\s+[A-Za-z][A-Za-z0-9.&' ]{1,40}$/;

export function stripOutletSuffix(headline: string): string {
  return headline.replace(OUTLET_SUFFIX, '');
}

export function tokens(headline: string): string[] {
  return stripOutletSuffix(headline)
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9$%. ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

export function normalizeEntities(entities: string[]): string[] {
  const out = new Set<string>();
  for (const e of entities) {
    const n = e.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (n.length > 1) out.add(n);
  }
  return [...out];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// Two items are the same story when their headline tokens overlap heavily,
// or when they share two named entities and a weaker headline overlap.
export function sameStory(a: StoryItem, b: StoryItem): boolean {
  const ta = new Set(tokens(a.headline));
  const tb = new Set(tokens(b.headline));
  const j = jaccard(ta, tb);
  if (j >= 0.5) return true;
  const ea = new Set(normalizeEntities(a.entities));
  const eb = new Set(normalizeEntities(b.entities));
  let shared = 0;
  for (const e of ea) if (eb.has(e)) shared += 1;
  // Two shared entities with a light headline overlap, or one shared entity
  // with a firmer one (the replay over 2026-09-22..25 found the Adyen/Klarna
  // CFO move across three outlets and the Anthropic/OpenAI price cut across
  // CNBC and Ars only through the second rule).
  return (shared >= 2 && j >= 0.2) || (shared >= 1 && j >= 0.25);
}

export const TIER_WEIGHT: Record<string, number> = { '1': 1.0, '2': 0.85, '3': 0.6, '4': 0.25, unknown: 0.7 };
export const CONTENT_WEIGHT: Record<string, number> = {
  news: 1.0, analysis: 0.95, data: 1.0, opinion: 0.7, press_release: 0.6, marketing: 0.3, other: 0.8,
};

// The engines' relevance is TOPIC fit (a bank-capital story scores high on a
// banking topic). The edition is an AI paper, so an item earns full weight
// only when its own text says AI; pipeline candidates and published signals
// came through the AI lenses and always count as AI. isAiStory (./desks.ts)
// is the one AI gate, shared with the front/Things-happen filter.
export function aiWeight(it: StoryItem): number {
  return isAiStory(it) ? 1 : 0.45;
}

export function itemWeight(it: StoryItem): number {
  const tier = TIER_WEIGHT[it.tier ? String(it.tier) : 'unknown'] ?? 0.7;
  const kind = CONTENT_WEIGHT[it.contentKind ?? 'other'] ?? 0.8;
  return (it.relevance ?? 0.5) * tier * kind * aiWeight(it);
}

export function clusterStories(items: StoryItem[]): StoryCluster[] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (find(i) !== find(j) && sameStory(items[i], items[j])) union(i, j);
    }
  }
  const groups = new Map<number, StoryItem[]>();
  items.forEach((it, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(it);
    groups.set(r, g);
  });
  const clusters: StoryCluster[] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => itemWeight(b) - itemWeight(a));
    const lead = sorted.find((x) => x.source === 'signal') ?? sorted[0];
    const outlets = [...new Set(g.map((x) => x.domain).filter(Boolean))];
    const tierMix: StoryCluster['tierMix'] = { '1': 0, '2': 0, '3': 0, '4': 0, unknown: 0 };
    for (const x of g) tierMix[(x.tier ? String(x.tier) : 'unknown') as keyof typeof tierMix] += 1;
    const entityCount = new Map<string, number>();
    for (const x of g) for (const e of normalizeEntities(x.entities)) entityCount.set(e, (entityCount.get(e) ?? 0) + 1);
    const entities = [...entityCount.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
    const best = Math.max(...g.map(itemWeight));
    const coverage = Math.max(1, outlets.length);
    const signalBoost = g.some((x) => x.source === 'signal') ? 1.25 : 1;
    const score = best * (1 + Math.log(coverage)) * signalBoost;
    clusters.push({ id: lead.id, lead, items: sorted, outlets, tierMix, entities, score });
  }
  return clusters.sort((a, b) => b.score - a.score);
}

export function coverageLine(c: StoryCluster): string {
  const n = c.outlets.length;
  const notes: string[] = [];
  if (c.tierMix['1']) notes.push(`${c.tierMix['1']} tier 1`);
  if (c.tierMix['4']) notes.push(`${c.tierMix['4']} promo`);
  if (n === 1 && notes.length === 0) return '';
  const label = n === 1 ? `${n} outlet` : `Corroborated by ${n} outlets`;
  return [label, ...notes].join(', ');
}
