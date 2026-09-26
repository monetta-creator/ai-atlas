// PLAIN-NODE LOADABLE: the DB-free half of the edition pack
// (scripts/test-edition-pack.mjs and lib/edition/deck.ts import from here);
// every relative import carries an explicit .ts extension and resolves to a
// dependency-light module. Nothing here touches lib/db.

import { lookbackDays } from '../scan/core.ts';
import { coverageLine, tokens } from './cluster.ts';
import { isAiStory, deskFor } from './desks.ts';
import type { StoryCluster } from './cluster';
import type { EditionPack, EditionFrontItem, EditionThing, SavedEdition } from './types';
import type { CitationAllowlist } from '../citations';

// Belt-and-braces on the no-em-dash rule, same as lib/research/roundup.ts's
// deDash: the model is instructed never to use one, this is the backstop.
export const deDash = (s: string): string => s.replace(/\s*—\s*/g, ', ');

// ---------------------------------------------------------------- window

// The edition's window is "since the last edition": half-open [from, to) in
// UTC, closing at press time (EDITION_PRESS_UTC on the edition's day) and
// opening at the previous weekday's press time, so the 20:30 UTC late feed
// sweep lands in the next morning's paper instead of falling between two
// calendar days. Monday reaches back to Friday's press time (lookbackDays
// returns 3 on a Monday, 1 otherwise, the same catch-up rule the
// scan/intel/pipeline engines use).
export const EDITION_PRESS_UTC = '16:45:00';

// `pressUtc` lets another daily product (the company intel deck, 16:20 UTC)
// reuse the press-to-press semantics with its own press time.
export function windowFor(day: string, pressUtc: string = EDITION_PRESS_UTC): { from: string; to: string } {
  const to = new Date(`${day}T${pressUtc}Z`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - lookbackDays(day));
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------- things happen

// The ranked clusters the front did not take, projected to the Things Happen
// row shape. buildEditionPack calls it against the default 7-item front;
// runDailyEdition calls it again against the model's actual picks. onlyAi
// (default true) keeps this an AI newspaper's briefs page: a cluster earns a
// slot only when its lead or one of its corroborating items reads as AI
// (isAiStory), the same gate aiWeight applies to ranking. Each thing is
// desk-stamped (deskFor) so the render groups them like a newspaper section.
export function thingsHappenFor(
  clusters: StoryCluster[],
  exclude: Set<string>,
  limit = 23,
  opts: { onlyAi?: boolean } = {}
): EditionThing[] {
  const onlyAi = opts.onlyAi ?? true;
  return clusters
    .filter((c) => !exclude.has(c.id))
    .filter((c) => !onlyAi || isAiStory(c.lead) || c.items.some((it) => isAiStory(it)))
    .slice(0, limit)
    .map((c) => {
      const tags = new Set<string>();
      const entities = new Set<string>();
      for (const it of c.items) {
        for (const t of it.tags) tags.add(t);
        for (const e of it.entities) entities.add(e);
      }
      return {
        headline: c.lead.headline, url: c.lead.url, domain: c.lead.domain, tier: c.lead.tier, href: c.lead.href,
        desk: deskFor({ headline: c.lead.headline, summary: c.lead.summary, tags: [...tags], entities: [...entities] }),
      };
    });
}

// The strongest non-AI financial-services developments, for "The industry"
// strip: topically relevant to the desk's audience but never AI (isAiStory
// on the lead or any corroborating item excludes it), a real news/analysis/
// data story (not marketing or opinion), from a source good enough to lead
// with (tier 1, 2, or unrated). Clusters arrive already ranked by score.
export function industryFor(clusters: StoryCluster[], exclude: Set<string>, limit = 4): EditionThing[] {
  return clusters
    .filter((c) => !exclude.has(c.id))
    .filter((c) => !isAiStory(c.lead) && !c.items.some((it) => isAiStory(it)))
    .filter((c) => c.lead.tier === null || c.lead.tier === 1 || c.lead.tier === 2)
    .filter((c) => c.lead.contentKind === null || ['news', 'analysis', 'data'].includes(c.lead.contentKind))
    .slice(0, limit)
    .map((c) => ({ headline: c.lead.headline, url: c.lead.url, domain: c.lead.domain, tier: c.lead.tier, href: c.lead.href }));
}

// ---------------------------------------------------------------- citation gate

// Every url/href the front + column legs may cite: every story item's
// external url, every signal/paper/tool/claim in-app href. Pure, DB-free —
// safe for scripts/test-edition-pack.mjs.
// A stored source URL and its query-less twin both pass the gate: the model
// copies "…/eu-warns" from a stored "…/eu-warns?amp=1" often enough that the
// 09-25 column lost its EU link to the stripped tracking parameter. Same
// page, so the twin is allowed; a different path still is not.
export function urlForms(url: string): string[] {
  const out = [url];
  if (/^https?:\/\//i.test(url)) {
    const bare = url.replace(/[?#].*$/, '');
    if (bare !== url) out.push(bare);
  }
  return out;
}

export function allowlistForEdition(pack: EditionPack): CitationAllowlist {
  const hrefs = new Set<string>();
  const tagByHref = new Map<string, string>();
  const addUrl = (u: string) => { for (const f of urlForms(u)) hrefs.add(f); };
  for (const c of pack.clusters) {
    for (const it of c.items) {
      addUrl(it.url);
      if (it.href) hrefs.add(it.href);
    }
  }
  for (const t of pack.thingsHappen) {
    addUrl(t.url);
    if (t.href) hrefs.add(t.href);
  }
  for (const t of pack.industry ?? []) {
    addUrl(t.url);
    if (t.href) hrefs.add(t.href);
  }
  for (const p of pack.papers) hrefs.add(p.href);
  for (const r of pack.builders?.reads ?? []) {
    if (r.url) addUrl(r.url);
    addUrl(r.hnUrl);
    if (r.catalogHref) hrefs.add(r.catalogHref);
  }
  for (const r of pack.builders?.releases ?? []) {
    if (r.url) addUrl(r.url);
    hrefs.add(r.productHref);
  }
  for (const t of pack.tools) hrefs.add(t.href);
  for (const c of pack.claimsTouched) {
    hrefs.add(c.href);
    for (const h of c.signalHrefs) hrefs.add(h);
    tagByHref.set(c.href, c.code);
  }
  for (const co of pack.companies ?? []) for (const f of co.facts) if (f.url) addUrl(f.url);
  for (const b of pack.blindSpots) if (b.url) addUrl(b.url);
  return { hrefs, tagByHref };
}

// ---------------------------------------------------------------- front validation

// What the model's submit_front tool returns, before validation: every field
// is untrusted input (the tool schema only guarantees the shape, not that
// clusterId names a real cluster or that goDeeperHref is one of its urls).
export interface RawFrontItem {
  clusterId?: unknown;
  headline?: unknown;
  why?: unknown;
  numbers?: unknown;
  goDeeperHref?: unknown;
}

export function goDeeperLabel(href: string): string {
  if (href.startsWith('/signals/')) return 'Read the signal';
  if (href.startsWith('/research/')) return 'Read the paper';
  if (href.startsWith('/tooling/')) return 'Read the product page';
  return 'Read the source';
}

// The deterministic backstop between the model's front-item picks and the
// rendered page (lib/edition/generate.ts's generateFront calls this after
// the model call; scripts/test-edition-pack.mjs exercises it directly, no
// model or DB involved). Drops items naming a cluster outside `clusters`,
// substitutes a goDeeperHref that is not one of that cluster's own item
// urls/hrefs with the cluster's lead href, and clamps the result to `n`.
export function validateFrontItems(
  clusters: StoryCluster[], raw: RawFrontItem[], n: number
): EditionFrontItem[] {
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const out: EditionFrontItem[] = [];
  for (const it of raw) {
    const c = byId.get(typeof it.clusterId === 'string' ? it.clusterId : '');
    if (!c) continue;
    const allow = new Set<string>();
    for (const item of c.items) {
      allow.add(item.url);
      if (item.href) allow.add(item.href);
    }
    const leadHref = c.lead.href ?? c.lead.url;
    let href = typeof it.goDeeperHref === 'string' ? it.goDeeperHref : '';
    if (!allow.has(href)) href = leadHref;
    // A signal's own /signals/<id> page beats an external url whenever the
    // cluster has one: the model was given the external url as one option
    // among several, and a signal never 404s for a guest once published.
    if (!href.startsWith('/')) {
      const signalItem = c.items.find((item) => item.href?.startsWith('/signals/'));
      if (signalItem?.href) href = signalItem.href;
    }
    const numbersRaw = typeof it.numbers === 'string' ? deDash(it.numbers).trim() : '';
    out.push({
      clusterId: c.id,
      headline: deDash(typeof it.headline === 'string' && it.headline ? it.headline : c.lead.headline).trim(),
      why: deDash(typeof it.why === 'string' ? it.why : '').trim(),
      numbers: numbersRaw || null,
      goDeeperHref: href,
      goDeeperLabel: goDeeperLabel(href),
      coverage: coverageLine(c),
    });
    if (out.length >= n) break;
  }
  return out;
}

// The no-budget / no-model fallback (lib/edition/run.ts): the top n clusters
// by score, headline = lead headline, why = the lead's summary first
// sentence (or empty), numbers always null (never invented without a model).
// Clusters penalizeRepeats flagged (`repeat: true`) are skipped so a quiet
// day doesn't re-run yesterday's front page verbatim, unless there are not
// enough fresh clusters to fill n, in which case the repeats backfill the
// remainder in their existing (penalized) rank order.
export function deterministicFront(pack: EditionPack, n: number): EditionFrontItem[] {
  const nCount = Math.max(0, n);
  const fresh = pack.clusters.filter((c) => !c.repeat);
  const pool = fresh.length >= nCount ? fresh : [...fresh, ...pack.clusters.filter((c) => c.repeat)];
  return pool.slice(0, nCount).map((c) => {
    const href = c.lead.href ?? c.lead.url;
    const firstSentence = c.lead.summary ? c.lead.summary.split(/(?<=[.!?])\s/)[0] : '';
    return {
      clusterId: c.id,
      headline: c.lead.headline,
      why: firstSentence,
      numbers: null,
      goDeeperHref: href,
      goDeeperLabel: goDeeperLabel(href),
      coverage: coverageLine(c),
    };
  });
}

// ---------------------------------------------------------------- repeat penalty

// Every url/href and headline from the recent front pages, so today's ranking
// can penalize a cluster that only rehashes one of them. Reads front items
// (goDeeperHref + headline) and, for each front item's cluster, every item's
// own url/href (a story often gets a fresh outlet the next day, so matching
// on the cluster's full item set catches a re-cover, not just an exact link).
export function priorFrontFrom(editions: SavedEdition[]): { urls: Set<string>; headlines: string[] } {
  const urls = new Set<string>();
  const headlines: string[] = [];
  for (const e of editions) {
    const clusterIds = new Set(e.narrative.front.map((f) => f.clusterId));
    for (const f of e.narrative.front) {
      if (f.goDeeperHref) urls.add(f.goDeeperHref);
      headlines.push(f.headline);
    }
    for (const c of e.pack.clusters) {
      if (!clusterIds.has(c.id)) continue;
      for (const it of c.items) {
        urls.add(it.url);
        if (it.href) urls.add(it.href);
      }
    }
  }
  return { urls, headlines };
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

// A cluster is a repeat when one of its items shares a url/href with a recent
// front page, or its lead headline overlaps a recent front headline heavily
// (token Jaccard >= 0.4: catches the same story re-covered by a new outlet
// with a rephrased headline). Repeats are demoted (score * 0.35, well below
// a fresh story of similar underlying weight) and flagged `repeat: true` so
// deterministicFront and generateFront's candidate list can skip them; the
// list is re-sorted by score after the penalty.
export function penalizeRepeats(clusters: StoryCluster[], prior: { urls: Set<string>; headlines: string[] }): StoryCluster[] {
  const priorTokenSets = prior.headlines.map((h) => new Set(tokens(h)));
  const out = clusters.map((c) => {
    const urlHit = c.items.some((it) => prior.urls.has(it.url) || (it.href != null && prior.urls.has(it.href)));
    const headlineHit = !urlHit && priorTokenSets.some((pt) => tokenOverlap(new Set(tokens(c.lead.headline)), pt) >= 0.4);
    if (!urlHit && !headlineHit) return c;
    return { ...c, score: c.score * 0.35, repeat: true };
  });
  return out.sort((a, b) => b.score - a.score);
}
