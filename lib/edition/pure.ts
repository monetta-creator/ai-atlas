// PLAIN-NODE LOADABLE: the DB-free half of the edition pack
// (scripts/test-edition-pack.mjs and lib/edition/deck.ts import from here);
// every relative import carries an explicit .ts extension and resolves to a
// dependency-light module. Nothing here touches lib/db.

import { lookbackDays } from '../scan/core.ts';
import { coverageLine } from './cluster.ts';
import type { StoryCluster } from './cluster';
import type { EditionPack, EditionFrontItem, EditionThing } from './types';
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

export function windowFor(day: string): { from: string; to: string } {
  const to = new Date(`${day}T${EDITION_PRESS_UTC}Z`);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - lookbackDays(day));
  return { from: from.toISOString(), to: to.toISOString() };
}

// ---------------------------------------------------------------- things happen

// The ranked clusters the front did not take, projected to the Things Happen
// row shape. buildEditionPack calls it against the default 7-item front;
// runDailyEdition calls it again against the model's actual picks.
export function thingsHappenFor(clusters: StoryCluster[], exclude: Set<string>, limit = 23): EditionThing[] {
  return clusters
    .filter((c) => !exclude.has(c.id))
    .slice(0, limit)
    .map((c) => ({ headline: c.lead.headline, url: c.lead.url, domain: c.lead.domain, tier: c.lead.tier, href: c.lead.href }));
}

// ---------------------------------------------------------------- citation gate

// Every url/href the front + column legs may cite: every story item's
// external url, every signal/paper/tool/claim in-app href. Pure, DB-free —
// safe for scripts/test-edition-pack.mjs.
export function allowlistForEdition(pack: EditionPack): CitationAllowlist {
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
export function deterministicFront(pack: EditionPack, n: number): EditionFrontItem[] {
  return pack.clusters.slice(0, Math.max(0, n)).map((c) => {
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
