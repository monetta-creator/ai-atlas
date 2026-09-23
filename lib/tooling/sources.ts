import { tavilyQuery, tavilyAvailable, TAVILY_QUOTA_NOTE } from '../scan/search-tavily';
import { recordApiCall } from '../cost';
import { assertPublicHttpUrl } from '../pipeline/web';
import { mapHnHits, mapGithubRepos, mapProductHuntPosts, mapTavilyHits, resolveToolingTokens } from './core';
import type { ToolingCategory, RawHit } from '../types';

// The AI Tooling Monitor's discovery sources: Tavily (news + evergreen
// general search), Hacker News (Algolia, keyless), GitHub search (optional
// token), and Product Hunt (GraphQL, optional token, off entirely when
// unset). Every function here is best-effort: one retry, then degrade to an
// empty hit list plus a diagnostic note. NEVER throws — a dead source must
// not fail the whole discovery unit.

const FETCH_TIMEOUT_MS = 15_000;
const REDIRECT_TIMEOUT_MS = 8_000;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

// One retry: a lost call is a whole source's coverage for this unit, and the
// retry is cheap next to burning the unit. Any thrown error (network,
// timeout, or a deliberate non-2xx throw inside `fn`) is retried exactly once.
async function runOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fn();
  }
}

// ISO 8601 week number (Monday-start weeks, week 1 contains the year's first
// Thursday) — the standard algorithm, used only to rotate the weekly Tavily
// query deterministically through a category's search_queries list.
function isoWeekNumber(dayISO: string): number {
  const parsed = new Date(`${dayISO}T00:00:00Z`);
  const d = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1 .. Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// ---- Tavily -------------------------------------------------------------------

// Weekly: ONE query, rotated by ISO week number over the category's
// search_queries (news-shaped, 7-day window). Pull: up to 3 evergreen
// pull_queries, topic 'general' (no day window), capped at 20 results each.
// One $0 recordApiCall row either way, carrying tooling_run + category so
// the Tavily monthly-quota tile (getTavilyQuota) can count these queries.
export async function searchTavilyForCategory(opts: {
  category: ToolingCategory;
  mode: 'weekly' | 'pull';
  runId: string;
  dayISO?: string;
}): Promise<{ hits: RawHit[]; note: string | null }> {
  const dayISO = opts.dayISO ?? new Date().toISOString().slice(0, 10);
  const rawQueries =
    opts.mode === 'weekly'
      ? pickWeeklyQuery(opts.category.search_queries ?? [], dayISO)
      : (opts.category.pull_queries ?? []).slice(0, 3);
  const queries = rawQueries.map((q) => resolveToolingTokens(q, dayISO)).filter((q) => q.trim());
  if (!queries.length) return { hits: [], note: null };
  // Tavily's quota breaker (lib/scan/tavily-breaker.ts): after one 432 this
  // month's credits are gone for every category; skip with one note and let
  // HN + GitHub carry the discovery unit.
  if (!tavilyAvailable()) return { hits: [], note: `tavily (${opts.category.slug}): skipped, ${TAVILY_QUOTA_NOTE}` };

  const t0 = Date.now();
  const byUrl = new Map<string, RawHit>();
  let lastError: string | null = null;
  for (const query of queries) {
    try {
      const results = await runOnce(() =>
        tavilyQuery({
          query,
          topic: opts.mode === 'weekly' ? 'news' : 'general',
          ...(opts.mode === 'weekly' ? { days: 7 } : {}),
          maxResults: 20,
        })
      );
      for (const hit of mapTavilyHits(results)) {
        if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
      }
    } catch (e) {
      lastError = errMsg(e);
    }
  }
  await recordApiCall({
    feature: 'tooling_search',
    model: 'tavily-search',
    usage: null,
    wallMs: Date.now() - t0,
    metadata: { queries: queries.length, tooling_run: opts.runId, category: opts.category.slug },
  });
  const hits = [...byUrl.values()];
  return {
    hits,
    note: lastError
      ? `tavily (${opts.category.slug}): ${hits.length ? 'partial failure: ' : ''}${lastError}`
      : null,
  };
}

function pickWeeklyQuery(queries: string[], dayISO: string): string[] {
  if (!queries.length) return [];
  const week = isoWeekNumber(dayISO);
  return [queries[week % queries.length]];
}

// ---- Hacker News (Algolia, keyless) --------------------------------------------

// Weekly: search_by_date (freshest first) restricted to stories/Show HN,
// created after `sinceUnix`, points above the (low) discovery bar. Pull:
// relevance search with a much higher points bar (the undated big pull).
export async function searchHn(opts: {
  query: string;
  sinceUnix?: number;
  minPoints: number;
  mode: 'date' | 'relevance';
}): Promise<{ hits: RawHit[]; note: string | null }> {
  const query = String(opts.query ?? '').trim();
  if (!query) return { hits: [], note: null };
  const base = opts.mode === 'date'
    ? 'https://hn.algolia.com/api/v1/search_by_date'
    : 'https://hn.algolia.com/api/v1/search';
  const filters = [`points>${opts.minPoints}`];
  if (opts.mode === 'date' && opts.sinceUnix != null) filters.unshift(`created_at_i>${opts.sinceUnix}`);
  const params = new URLSearchParams({
    query,
    tags: '(story,show_hn)',
    numericFilters: filters.join(','),
    hitsPerPage: '30',
  });
  const url = `${base}?${params.toString()}`;
  const t0 = Date.now();
  try {
    const data = await runOnce(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { hits?: unknown[] };
    });
    await recordApiCall({
      feature: 'tooling_search', model: 'hn-algolia', usage: null, wallMs: Date.now() - t0,
      metadata: { query },
    });
    return { hits: mapHnHits(data.hits ?? []), note: null };
  } catch (e) {
    return { hits: [], note: `hn search failed: ${errMsg(e)}` };
  }
}

// ---- GitHub search (optional token) --------------------------------------------

// `q` is the FULLY composed query text (the caller appends the mode's
// qualifiers: weekly '<github_query> pushed:>YYYY-MM-DD stars:>200', pull
// '<github_query> stars:>500'). Works keyless; a token just raises the rate
// limit.
export async function searchGithub(opts: {
  q: string;
  perPage?: number;
  token?: string;
}): Promise<{ hits: RawHit[]; note: string | null }> {
  const q = String(opts.q ?? '').trim();
  if (!q) return { hits: [], note: null };
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  const url = `https://api.github.com/search/repositories?${new URLSearchParams({
    q,
    per_page: String(opts.perPage ?? 30),
  }).toString()}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = Date.now();
  try {
    const data = await runOnce(async () => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { items?: unknown[] };
    });
    await recordApiCall({
      feature: 'tooling_search', model: 'github-search', usage: null, wallMs: Date.now() - t0,
      metadata: { q },
    });
    return { hits: mapGithubRepos(data.items ?? []), note: null };
  } catch (e) {
    return { hits: [], note: `github search failed: ${errMsg(e)}` };
  }
}

// ---- Product Hunt (GraphQL, optional token; off entirely when unset) ---------

const PH_ENDPOINT = 'https://api.producthunt.com/v2/api/graphql';
const PH_QUERY = `
query ToolingPosts($postedAfter: DateTime, $cursor: String) {
  posts(first: 50, order: NEWEST, postedAfter: $postedAfter, after: $cursor, topic: "artificial-intelligence") {
    edges {
      node {
        id
        name
        tagline
        description
        url
        website
        votesCount
        createdAt
        topics {
          edges {
            node { slug }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`;

interface PhPostsResponse {
  data?: {
    posts?: {
      edges?: { node: Record<string, unknown> }[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: { message: string }[];
}

// Product Hunt's API terms restrict commercial use without their consent;
// this source is off entirely (a clean note, never a failure) when
// PRODUCTHUNT_TOKEN is unset. `website` (the vendor's own homepage) is a PH
// redirect link resolved before mapping — resolveRedirect below.
export async function fetchProductHuntPosts(opts: {
  token?: string;
  postedAfter: string; // ISO date
}): Promise<{ hits: RawHit[]; note: string | null }> {
  const token = opts.token ?? process.env.PRODUCTHUNT_TOKEN;
  if (!token) return { hits: [], note: 'Product Hunt: PRODUCTHUNT_TOKEN not set, skipped' };

  const nodes: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  let note: string | null = null;
  const t0 = Date.now();
  for (let page = 0; page < 2; page++) {
    try {
      const json = await runOnce(async () => {
        const res = await fetch(PH_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: PH_QUERY, variables: { postedAfter: opts.postedAfter, cursor } }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = (await res.json()) as PhPostsResponse;
        if (parsed.errors?.length) throw new Error(parsed.errors[0].message);
        return parsed;
      });
      const edges = json.data?.posts?.edges ?? [];
      for (const edge of edges) nodes.push(edge.node);
      const pageInfo = json.data?.posts?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      cursor = pageInfo.endCursor;
    } catch (e) {
      note = `product hunt: ${errMsg(e)}`;
      break;
    }
  }
  await recordApiCall({
    feature: 'tooling_search', model: 'producthunt', usage: null, wallMs: Date.now() - t0,
    metadata: { postedAfter: opts.postedAfter },
  });

  const resolved: Record<string, unknown>[] = [];
  for (const node of nodes) {
    const website = typeof node.website === 'string' ? node.website : '';
    if (!website) {
      resolved.push(node);
      continue;
    }
    resolved.push({ ...node, website: await resolveRedirect(website) });
  }
  return { hits: mapProductHuntPosts(resolved), note };
}

// Follow a redirect chain up to 3 hops via HEAD, validating every hop is a
// public http(s) host. Falls back to the ORIGINAL url (the PH-provided
// website link) on any failure — an unresolved redirect is still a usable
// link, just possibly a tracking wrapper.
async function resolveRedirect(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    try {
      assertPublicHttpUrl(current);
    } catch {
      return url;
    }
    try {
      const res = await fetch(current, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(REDIRECT_TIMEOUT_MS),
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return current;
    } catch {
      return url;
    }
  }
  return current;
}
