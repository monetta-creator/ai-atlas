import { recordApiCall } from '../cost';
import { tavilyQuery } from '../scan/search-tavily';
import { gdeltQuery, mapGdeltResults } from '../scan/search-gdelt';
import { mapTavilyResults } from '../scan/core';
import { chatJSONOpenRouter } from '../scan/llm';
import { getZeroYieldDomains } from '../data';
import {
  LOW_QUALITY_DOMAINS, BREAKING_SWEEP_DOMAINS, DEFAULT_UTILITY_MODEL,
} from './config';
import { SIGNAL_LENS_SLUGS } from '../format';
import type { RawCandidate } from './web';
import type { SignalLens } from '../types';

// Pipeline 2.0's cheap search legs. The Sonnet + web_search discovery call's
// own prompt forbade judgment and returned only url/headline/date lists, so
// the lens leg is LLM-free Tavily (the scan's proven recipe, unchanged here).
// The breaking sweep and coverage check DO carry judgment (significance, lens
// assignment, covered-vs-missed): their web half is GDELT DOC 2.0 (free,
// keyless, halving Tavily's free-tier burn) restricted post-fetch to the same
// quality-outlet allowlist Tavily's include_domains used to enforce
// server-side, and their judgment half stays one small utility-model call.
// Callers branch on OPENROUTER_API_KEY (the judgment call's requirement;
// GDELT itself needs no key); without it the original Sonnet paths (web.ts /
// coverage.ts) run unchanged.

const num = (v: string | null | undefined): string => String(v ?? '');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Politeness between consecutive GDELT calls in a loop (search-gdelt.ts's
// scan leg uses the same figure).
const GDELT_BETWEEN_QUERIES_MS = 5100; // GDELT's documented anonymous limit: 1 request per 5 seconds

// GDELT DOC 2.0 has no server-side "restrict to these domains" param the way
// Tavily's include_domains does, so the quality-outlet allowlist is enforced
// client-side after the fetch (suffix-matched, same shape as the deny-list
// filters elsewhere in this file).
function onlyAllowedDomains<T extends { source_domain: string }>(
  items: T[],
  allowedDomains: string[]
): T[] {
  return items.filter((it) =>
    allowedDomains.some((d) => it.source_domain === d || it.source_domain.endsWith(`.${d}`))
  );
}

function daysSince(sinceISO: string): number {
  return Math.max(1, Math.ceil((Date.now() - Date.parse(`${sinceISO}T00:00:00Z`)) / 86_400_000));
}

// arXiv IDs encode the submission month (same inference as web.ts, duplicated
// one line deep rather than exporting a micro-helper across the boundary).
function inferDate(url: string, date: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date;
  const m = /arxiv\.org\/(?:abs|pdf|html)\/(\d{2})(\d{2})\./i.exec(url);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `20${m[1]}-${m[2]}-01`;
  return date;
}

// The lens discovery leg: one Tavily call per query, mapped and deny-listed
// client-side (curated LOW_QUALITY_DOMAINS + the learned zero-yield list;
// suffix matching, replacing the web_search blocked_domains param). Logs one
// $0 row per batch (model 'tavily-search'; pipelineRunId is valid here, this
// IS a pipeline run) so run history and analytics keep their call counts.
export async function searchCandidatesTavily(opts: {
  lens: SignalLens;
  queries: string[];
  sinceISO: string;
  pipelineRunId?: string;
}): Promise<RawCandidate[]> {
  if (!opts.queries.length) return [];
  const learned = await getZeroYieldDomains().catch(() => [] as string[]);
  const blocked = Array.from(new Set([...LOW_QUALITY_DOMAINS, ...learned]));
  const days = daysSince(opts.sinceISO);

  const t0 = Date.now();
  const byUrl = new Map<string, RawCandidate>();
  for (const query of opts.queries) {
    // One in-call retry per query: a lost query is a lens-day of coverage.
    let results;
    try {
      results = await tavilyQuery({ query, days });
    } catch {
      results = await tavilyQuery({ query, days });
    }
    for (const item of mapTavilyResults(results, blocked)) {
      const mapped: RawCandidate = {
        ...item,
        published_date: inferDate(item.url, item.published_date),
      };
      if (!byUrl.has(mapped.url)) byUrl.set(mapped.url, mapped);
    }
  }
  await recordApiCall({
    feature: 'pipeline_discovery',
    model: 'tavily-search',
    usage: null,
    wallMs: Date.now() - t0,
    pipelineRunId: opts.pipelineRunId,
    metadata: { lens: opts.lens, queries: opts.queries.length, provider: 'tavily' },
  });
  return [...byUrl.values()];
}

interface SweepDevelopment extends RawCandidate {
  lens: SignalLens;
}

// The breaking sweep, restructured: GDELT fetches what the quality outlets
// reported (post-fetch filtered to the curated allowlist, replacing Tavily's
// server-side include_domains), then ONE utility-model call picks the
// genuinely significant developments and assigns each a lens. Mistakes are
// cheap: everything it returns enters the same triage funnel.
export async function searchBreakingSweepGdelt(opts: {
  queries: string[];
  sinceISO: string;
  pipelineRunId?: string;
  utilityModel?: string | null;
}): Promise<SweepDevelopment[]> {
  if (!opts.queries.length) return [];
  const days = daysSince(opts.sinceISO);
  const t0 = Date.now();
  const byUrl = new Map<string, RawCandidate>();
  for (let i = 0; i < opts.queries.length; i++) {
    if (i > 0) await sleep(GDELT_BETWEEN_QUERIES_MS);
    const query = opts.queries[i];
    let articles;
    try {
      articles = await gdeltQuery({ query, days, maxRecords: 100 });
    } catch {
      await sleep(GDELT_BETWEEN_QUERIES_MS);
      articles = await gdeltQuery({ query, days, maxRecords: 100 });
    }
    for (const item of onlyAllowedDomains(mapGdeltResults(articles), BREAKING_SWEEP_DOMAINS)) {
      if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    }
  }
  await recordApiCall({
    feature: 'pipeline_discovery',
    model: 'gdelt-doc',
    usage: null,
    wallMs: Date.now() - t0,
    pipelineRunId: opts.pipelineRunId,
    metadata: { sweep: true, provider: 'gdelt', queries: opts.queries.length },
  });
  const found = [...byUrl.values()];
  if (!found.length) return [];

  const list = found
    .map((c, i) => `[${i}] ${num(c.source_domain)}${c.published_date ? ` · ${c.published_date}` : ''} — ${c.headline || c.url}`)
    .join('\n');
  const out = await chatJSONOpenRouter<{ picks?: { index?: number; lens?: string }[] }>({
    model: opts.utilityModel || DEFAULT_UTILITY_MODEL,
    system: `You screen headlines for an AI-economy intelligence board. From the numbered list, pick every item reporting a SIGNIFICANT AI development: a frontier or open-weight model release or major capability jump, a major AI lab or government announcement, a major regulatory or export-control action, or a major AI market or infrastructure event. Skip routine coverage, opinion, and minor product news. When unsure, include it: a later step filters. Reply with ONLY a JSON object: {"picks": [{"index": <number>, "lens": "<one of: ${SIGNAL_LENS_SLUGS.join(', ')}>"}]}. lens is the single best fit: market (money and valuations), labor (jobs and productivity), geopolitics (national competition and supply chains), regulatory (rules and enforcement), capability (what models can do), society (public attitudes and culture). Never use an em dash.`,
    user: `HEADLINES since ${opts.sinceISO}:\n${list}`,
    maxTokens: 900,
    timeoutMs: 45_000,
    feature: 'pipeline_discovery',
    pipelineRunId: opts.pipelineRunId ?? null,
    metadata: { sweep_judge: true, items: found.length },
  });

  const validLens = new Set<string>(SIGNAL_LENS_SLUGS);
  const seen = new Set<number>();
  const picks: SweepDevelopment[] = [];
  for (const p of out.picks ?? []) {
    const i = Number(p?.index);
    if (!Number.isInteger(i) || i < 0 || i >= found.length || seen.has(i)) continue;
    seen.add(i);
    // Some open-weight models copy display brackets around enum values.
    const lens = String(p?.lens ?? '').trim().replace(/^\[/, '').replace(/\]$/, '');
    picks.push({
      ...found[i],
      published_date: inferDate(found[i].url, found[i].published_date),
      lens: validLens.has(lens) ? (lens as SignalLens) : 'capability',
    });
  }
  return picks;
}

// The coverage half of the same recipe: GDELT re-derives "what did the
// serious press report" with the independent COVERAGE_QUERIES phrasing; the
// utility model does the covered-vs-missed comparison against the tracked
// list. Returns the same development shape coverage.ts validates and persists.
export async function coverageDevelopmentsGdelt(opts: {
  queries: string[];
  sinceISO: string;
  tracked: string[];
  pipelineRunId?: string;
  utilityModel?: string | null;
}): Promise<{ headline: string; url: string; covered: boolean; matched: string }[]> {
  const days = daysSince(opts.sinceISO);
  const byUrl = new Map<string, RawCandidate>();
  for (let i = 0; i < opts.queries.length; i++) {
    if (i > 0) await sleep(GDELT_BETWEEN_QUERIES_MS);
    const query = opts.queries[i];
    let articles;
    try {
      articles = await gdeltQuery({ query, days, maxRecords: 100 });
    } catch {
      await sleep(GDELT_BETWEEN_QUERIES_MS);
      articles = await gdeltQuery({ query, days, maxRecords: 100 });
    }
    for (const item of onlyAllowedDomains(mapGdeltResults(articles), BREAKING_SWEEP_DOMAINS)) {
      if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    }
  }
  const found = [...byUrl.values()];
  if (!found.length) return [];

  const list = found
    .map((c, i) => `[${i}] ${num(c.source_domain)} — ${c.headline || c.url}\n    ${c.url}`)
    .join('\n');
  const out = await chatJSONOpenRouter<{
    developments?: { index?: number; covered?: boolean; matched?: string }[];
  }>({
    model: opts.utilityModel || DEFAULT_UTILITY_MODEL,
    system: `You audit an AI-economy intelligence pipeline run for coverage gaps. From the numbered FOUND headlines, pick the 5 to 8 most significant AI developments (model releases, major lab or government announcements, major regulatory actions, major market or infrastructure events). For each, decide whether any TRACKED item clearly reports the same story. Reply with ONLY a JSON object: {"developments": [{"index": <number>, "covered": <boolean>, "matched": "<the tracked item's text, or empty string>"}]}. covered is true only on a clear same-story match. Never use an em dash.`,
    user: `FOUND (published since ${opts.sinceISO}):\n${list}\n\nTRACKED ITEMS:\n${opts.tracked.map((t) => `- ${t}`).join('\n')}`,
    maxTokens: 1200,
    timeoutMs: 45_000,
    feature: 'pipeline_coverage',
    pipelineRunId: opts.pipelineRunId ?? null,
    metadata: { tracked: opts.tracked.length, provider: 'gdelt' },
  });

  const seen = new Set<number>();
  const developments: { headline: string; url: string; covered: boolean; matched: string }[] = [];
  for (const d of out.developments ?? []) {
    const i = Number(d?.index);
    if (!Number.isInteger(i) || i < 0 || i >= found.length || seen.has(i)) continue;
    seen.add(i);
    developments.push({
      headline: (found[i].headline || found[i].url).slice(0, 300),
      url: found[i].url,
      covered: !!d?.covered,
      matched: String(d?.matched ?? '').trim().slice(0, 300),
    });
  }
  return developments;
}
