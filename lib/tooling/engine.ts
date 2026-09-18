import {
  getToolingCategories, getToolingPrefs, getToolingRun,
  getPendingHydrate, getPendingEnrich, getUnscoredIds, getNewlyCataloged, getFeedProducts, getDeepDiveCandidates,
} from '../data/tooling';
import {
  createToolingRun, claimToolingRun, renewToolingLease, releaseToolingLease, setToolingStep,
  markToolingUnitSwept, bumpToolingRunCount, appendToolingRunNotes, completeToolingRun,
  failStaleToolingRuns, setToolingRunReport, insertProducts, setProductFetchResult,
} from '../mutations/tooling';
import { toolingPlan, nextUnswept, weekKey, sweepUnit } from './core';
import { searchTavilyForCategory, searchHn, searchGithub, fetchProductHuntPosts } from './sources';
import { triageHits } from './triage';
import { enumerateCategory } from './enumerate';
import { enrichProduct } from './enrich';
import { scoreChunk } from './score';
import { finishProduct } from './finish';
import { pollProductFeed } from './events';
import { runDeepDive } from './deepdive';
import { checkToolingBudget } from './budget';
import { runWeeklyEntrantsReport } from './reports';
import { fetchCandidateText, FetchFailure } from '../pipeline/web';
import { runPool } from '../pool';
import type { ToolingCategory, ToolingPrefs, ToolingProgress, ToolingRun, ToolingRunKind, RawHit, ToolingOrigin } from '../types';

// The AI Tooling Monitor's checkpointed step engine (the intel/scan pattern):
// discover -> hydrate -> enrich -> score -> finish -> events -> deepdive ->
// report -> complete. Shared by the cron route and the console's tick
// action. Every unit persists before the next begins, so an invocation that
// runs out of time resumes exactly where it stopped.
//
// The full set of unit keys this engine ever writes to swept_units:
//   discover: 'cat:<slug>', 'ph', and (pull runs only) 'enum:<slug>:leaders' / 'enum:<slug>:emerging'
//   deepdive: 'dd:<id>'
//   report:   'report'
// (hydrate/enrich/score/finish/events are page-based, checked against a DB
// predicate each pass rather than swept_units — a product's own
// raw_content/enriched_at/agent_at/feed_checked_at IS the checkpoint.)

const HYDRATE_PAGE = 4;
const HYDRATE_POOL = 4;
const ENRICH_PAGE = 12;
const ENRICH_POOL = 3;
const SCORE_CHUNK_SIZE = 10;
const FINISH_PAGE = 8;
const EVENTS_PAGE = 12;
const EVENTS_POOL = 6;
const DEEPDIVE_POOL = 2;

function shiftDay(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toUnixSeconds(dayISO: string): number {
  return Math.floor(new Date(`${dayISO}T00:00:00Z`).getTime() / 1000);
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const arr = map.get(k);
    if (arr) arr.push(item); else map.set(k, [item]);
  }
  return map;
}

export function weekKeyToday(): string {
  return weekKey(new Date());
}

export async function getOrCreateToolingRun(
  kind: ToolingRunKind
): Promise<{ runId: string; day: string; created: boolean }> {
  // Stale-run janitor first: a weekly run left running from a prior week (or
  // a pull run untouched for 3 days) can never be resumed cleanly.
  await failStaleToolingRuns().catch(() => {});
  const day = kind === 'weekly' ? weekKeyToday() : new Date().toISOString().slice(0, 10);
  const { id, created } = await createToolingRun(kind, day);
  return { runId: id, day, created };
}

export { claimToolingRun };

export function progressOf(run: ToolingRun, notes: string[]): ToolingProgress {
  return {
    runId: run.id,
    kind: run.kind,
    day: run.day,
    step: run.step,
    done: run.status === 'completed',
    counters: {
      found: run.found_count,
      inserted: run.inserted_count,
      hydrated: run.hydrated_count,
      enriched: run.enriched_count,
      scored: run.scored_count,
      cataloged: run.cataloged_count,
      deepDived: run.deep_dived_count,
      events: run.event_count,
    },
    notes,
  };
}

// One invocation's worth of work: loop bounded units until the deadline or
// the run completes. The caller holds the lease (claimToolingRun) first.
export async function advanceToolingRun(runId: string, deadlineAt: number): Promise<ToolingProgress> {
  const notes: string[] = [];
  // Products whose enrich/score call failed in THIS invocation. Nothing is
  // stamped on the row (the next invocation retries), so without this the
  // page-based picks would return the same rows every iteration and spin
  // the window away on repeated model calls.
  const skipEnrich = new Set<string>();
  const skipScore = new Set<string>();
  try {
    while (Date.now() < deadlineAt) {
      const run = await getToolingRun(runId);
      if (!run) throw new Error('tooling run not found');
      if (run.status === 'completed') return progressOf(run, notes);
      await renewToolingLease(runId);

      if (run.step === 'discover') {
        await runDiscoverStep(run, notes);
        continue;
      }
      if (run.step === 'hydrate') {
        const pending = await getPendingHydrate(HYDRATE_PAGE);
        if (!pending.length) { await setToolingStep(runId, 'enrich'); continue; }
        await runHydrateWave(pending, runId, notes, deadlineAt);
        continue;
      }
      if (run.step === 'enrich') {
        const pending = (await getPendingEnrich(ENRICH_PAGE + skipEnrich.size))
          .filter((p) => !skipEnrich.has(p.id))
          .slice(0, ENRICH_PAGE);
        if (!pending.length) {
          if (skipEnrich.size) notes.push(`enrich: ${skipEnrich.size} product(s) left for the next invocation after failed calls`);
          await setToolingStep(runId, 'score');
          continue;
        }
        const [prefs, categories] = await Promise.all([getToolingPrefs(), getToolingCategories(true)]);
        await runEnrichWave(pending, categories, prefs, runId, notes, deadlineAt, skipEnrich);
        continue;
      }
      if (run.step === 'score') {
        const ids = (await getUnscoredIds(SCORE_CHUNK_SIZE + skipScore.size))
          .filter((id) => !skipScore.has(id))
          .slice(0, SCORE_CHUNK_SIZE);
        if (!ids.length) {
          if (skipScore.size) notes.push(`score: ${skipScore.size} product(s) left for the next invocation after failed calls`);
          await setToolingStep(runId, 'finish');
          continue;
        }
        try {
          const result = await scoreChunk(ids, runId);
          if (result.processed) await bumpToolingRunCount(runId, 'scored_count', result.processed);
          if (result.cataloged) await bumpToolingRunCount(runId, 'cataloged_count', result.cataloged);
        } catch (e) {
          for (const id of ids) skipScore.add(id);
          notes.push(`score failed: ${String((e as Error)?.message ?? 'error').slice(0, 150)}`);
        }
        continue;
      }
      if (run.step === 'finish') {
        const pending = await getNewlyCataloged(FINISH_PAGE);
        if (!pending.length) { await setToolingStep(runId, 'events'); continue; }
        await Promise.all(pending.map(async (p) => {
          try {
            await finishProduct(p);
          } catch (e) {
            notes.push(`finish failed (${p.id}): ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
          }
        }));
        continue;
      }
      if (run.step === 'events') {
        const pending = await getFeedProducts(EVENTS_PAGE);
        if (!pending.length) { await setToolingStep(runId, 'deepdive'); continue; }
        await runEventsWave(pending, runId, notes, deadlineAt);
        continue;
      }
      if (run.step === 'deepdive') {
        await runDeepdiveStep(run, notes, deadlineAt);
        continue;
      }
      // step 'report' (or a legacy 'complete' with status still running)
      await runReportStep(run, notes);
    }
    const run = await getToolingRun(runId);
    if (!run) throw new Error('tooling run not found');
    if (run.status !== 'completed') notes.push('time budget reached: resume to continue');
    return progressOf(run, notes);
  } finally {
    await appendToolingRunNotes(runId, notes).catch(() => {});
    await releaseToolingLease(runId).catch(() => {});
  }
}

// ---- discover ------------------------------------------------------------

async function runDiscoverStep(run: ToolingRun, notes: string[]): Promise<void> {
  const categories = await getToolingCategories(true);
  const activeCategories = categories.filter((c) => c.active);
  const units = toolingPlan(activeCategories, run.kind);
  const next = nextUnswept(units, run.swept_units);
  if (!next) {
    await setToolingStep(run.id, 'hydrate');
    return;
  }
  const prefs = await getToolingPrefs();
  try {
    if (next === 'ph') {
      await runPhDiscoverUnit(run, prefs, activeCategories, notes);
    } else if (next.startsWith('enum:')) {
      const [, slug, pass] = next.split(':');
      const category = activeCategories.find((c) => c.slug === slug);
      const budget = await checkToolingBudget(run.id, run.kind);
      if (!budget.ok) {
        notes.push(`budget cap reached: enumeration ${slug}:${pass} skipped ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`);
      } else if (category) {
        await runEnumDiscoverUnit(run, category, pass as 'leaders' | 'emerging', notes);
      }
    } else if (next.startsWith('cat:')) {
      const slug = next.slice(4);
      const category = activeCategories.find((c) => c.slug === slug);
      if (category) await runCategoryDiscoverUnit(run, category, prefs, activeCategories, notes);
    }
  } catch (e) {
    notes.push(`discover unit failed (${next}): ${String((e as Error)?.message ?? 'error').slice(0, 150)}`);
  }
  await markToolingUnitSwept(run.id, next);
}

async function insertGrouped(
  runId: string,
  categorySlug: string,
  origin: ToolingOrigin,
  candidates: Awaited<ReturnType<typeof triageHits>>
): Promise<number> {
  const res = await insertProducts(runId, categorySlug, origin, candidates);
  return res.inserted;
}

async function runCategoryDiscoverUnit(
  run: ToolingRun,
  category: ToolingCategory,
  prefs: ToolingPrefs,
  activeCategories: { slug: string; name: string }[],
  notes: string[]
): Promise<void> {
  const mode = run.kind; // 'weekly' | 'pull'
  const [tavilyRes, hnRes, ghRes] = await Promise.all([
    searchTavilyForCategory({ category, mode, runId: run.id, dayISO: run.day }),
    category.hn_query
      ? searchHn(
          mode === 'weekly'
            ? { query: category.hn_query, sinceUnix: toUnixSeconds(shiftDay(run.day, -7)), minPoints: 10, mode: 'date' }
            : { query: category.hn_query, minPoints: 50, mode: 'relevance' }
        )
      : Promise.resolve({ hits: [] as RawHit[], note: null as string | null }),
    category.github_query
      ? searchGithub({
          q: mode === 'weekly'
            ? `${category.github_query} pushed:>${shiftDay(run.day, -7)} stars:>200`
            : `${category.github_query} stars:>500`,
        })
      : Promise.resolve({ hits: [] as RawHit[], note: null as string | null }),
  ]);
  for (const r of [tavilyRes, hnRes, ghRes]) if (r.note) notes.push(r.note);

  const merged = new Map<string, RawHit>();
  for (const hit of [...tavilyRes.hits, ...hnRes.hits, ...ghRes.hits]) {
    if (!merged.has(hit.url)) merged.set(hit.url, hit);
  }
  const hits = [...merged.values()];
  if (!hits.length) return;

  const triaged = await triageHits({
    hits, categories: activeCategories, model: prefs.utility_model, runId: run.id, categoryHint: category.slug,
  });
  if (!triaged.length) return;
  await bumpToolingRunCount(run.id, 'found_count', triaged.length);

  const byOrigin = groupBy(triaged, (p) => p.origin);
  let inserted = 0;
  for (const [origin, group] of byOrigin) {
    inserted += await insertGrouped(run.id, category.slug, origin, group);
  }
  if (inserted) await bumpToolingRunCount(run.id, 'inserted_count', inserted);
}

async function runPhDiscoverUnit(
  run: ToolingRun,
  prefs: ToolingPrefs,
  activeCategories: { slug: string; name: string }[],
  notes: string[]
): Promise<void> {
  // PH is a launch-tracking site with no entrenched incumbents anyway, so
  // its "recent" framing fits both cadences: a week for the weekly run, ~18
  // months (matching the enumeration pass's "emerging" window) for the pull.
  const lookbackDays = run.kind === 'pull' ? 548 : 7;
  const postedAfter = `${shiftDay(new Date().toISOString().slice(0, 10), -lookbackDays)}T00:00:00Z`;
  const ph = await fetchProductHuntPosts({ postedAfter });
  if (ph.note) notes.push(ph.note);
  if (!ph.hits.length) return;

  const triaged = await triageHits({
    hits: ph.hits, categories: activeCategories, model: prefs.utility_model, runId: run.id, categoryHint: null,
  });
  if (!triaged.length) return;
  await bumpToolingRunCount(run.id, 'found_count', triaged.length);

  const byCategory = groupBy(triaged, (p) => p.category);
  let inserted = 0;
  for (const [categorySlug, group] of byCategory) {
    inserted += await insertGrouped(run.id, categorySlug, 'producthunt', group);
  }
  if (inserted) await bumpToolingRunCount(run.id, 'inserted_count', inserted);
}

async function runEnumDiscoverUnit(
  run: ToolingRun,
  category: ToolingCategory,
  pass: 'leaders' | 'emerging',
  notes: string[]
): Promise<void> {
  try {
    const products = await enumerateCategory({ category, pass, runId: run.id });
    if (!products.length) return;
    await bumpToolingRunCount(run.id, 'found_count', products.length);
    const { inserted } = await insertProducts(run.id, category.slug, 'enumeration', products);
    if (inserted) await bumpToolingRunCount(run.id, 'inserted_count', inserted);
  } catch (e) {
    notes.push(`enumeration failed (${category.slug}:${pass}): ${String((e as Error)?.message ?? 'error').slice(0, 150)}`);
  }
}

// ---- hydrate --------------------------------------------------------------

async function runHydrateWave(
  items: { id: string; url: string }[],
  runId: string,
  notes: string[],
  deadlineAt: number
): Promise<void> {
  const { results } = await runPool(
    items,
    HYDRATE_POOL,
    async (item) => {
      try {
        const { text, via } = await fetchCandidateText(item.url, { maxChars: 24_000, timeoutMs: 15_000 });
        await setProductFetchResult(item.id, { text, via });
        return true;
      } catch (e) {
        const msg = e instanceof FetchFailure ? e.message : String((e as Error)?.message ?? 'fetch failed');
        await setProductFetchResult(item.id, { error: msg });
        return false;
      }
    },
    () => Date.now() < deadlineAt
  );
  const hydrated = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  if (hydrated) await bumpToolingRunCount(runId, 'hydrated_count', hydrated);
  if (results.length && hydrated < results.length) {
    notes.push(`hydrate: ${results.length - hydrated} of ${results.length} failed this wave`);
  }
}

// ---- enrich -----------------------------------------------------------------

async function runEnrichWave(
  items: { id: string; name: string; category: string; raw_content: string }[],
  categories: { slug: string; name: string }[],
  prefs: ToolingPrefs,
  runId: string,
  notes: string[],
  deadlineAt: number,
  skip: Set<string>
): Promise<void> {
  const { results } = await runPool(
    items,
    ENRICH_POOL,
    async (item) => {
      try {
        await enrichProduct(item, categories, prefs.enrich_model, runId);
        return true;
      } catch (e) {
        skip.add(item.id);
        notes.push(`enrich failed (${item.name}): ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
        return false;
      }
    },
    () => Date.now() < deadlineAt
  );
  const enriched = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
  if (enriched) await bumpToolingRunCount(runId, 'enriched_count', enriched);
}

// ---- events -----------------------------------------------------------------

async function runEventsWave(
  items: { id: string; feed_url: string; last_seen: string }[],
  runId: string,
  notes: string[],
  deadlineAt: number
): Promise<void> {
  const { results } = await runPool(
    items,
    EVENTS_POOL,
    async (p) => {
      const { added, note } = await pollProductFeed(p);
      if (note) notes.push(note);
      return added;
    },
    () => Date.now() < deadlineAt
  );
  const eventsAdded = results.reduce((sum, r) => (r.status === 'fulfilled' ? sum + r.value : sum), 0);
  if (eventsAdded) await bumpToolingRunCount(runId, 'event_count', eventsAdded);
}

// ---- deepdive ---------------------------------------------------------------

async function runDeepdiveStep(run: ToolingRun, notes: string[], deadlineAt: number): Promise<void> {
  const budget = await checkToolingBudget(run.id, run.kind);
  if (!budget.ok) {
    notes.push(`budget cap reached: remaining deep dives skipped ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`);
    await setToolingStep(run.id, 'report');
    return;
  }
  const prefs = await getToolingPrefs();
  const candidates = await getDeepDiveCandidates(run.id, prefs.deep_dive_threshold, prefs.deep_dive_cap);
  const pending = candidates.filter((c) => !run.swept_units.includes(sweepUnit('dd', c.id)));
  if (!pending.length) {
    await setToolingStep(run.id, 'report');
    return;
  }

  let deepDived = 0;
  let eventsAdded = 0;
  const { results } = await runPool(
    pending,
    DEEPDIVE_POOL,
    async (c) => {
      const result = await runDeepDive(c.id, null, 'tooling_deepdive', { runId: run.id });
      await markToolingUnitSwept(run.id, sweepUnit('dd', c.id));
      if (!result.ok) {
        notes.push(`deep dive failed (${c.name}): ${result.error}`);
        return null;
      }
      return result.eventsAdded;
    },
    () => Date.now() < deadlineAt
  );
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value !== null) {
      deepDived += 1;
      eventsAdded += r.value;
    }
  }
  if (deepDived) await bumpToolingRunCount(run.id, 'deep_dived_count', deepDived);
  if (eventsAdded) await bumpToolingRunCount(run.id, 'event_count', eventsAdded);
}

// ---- report (weekly only) ----------------------------------------------------

async function runReportStep(run: ToolingRun, notes: string[]): Promise<void> {
  if (run.swept_units.includes('report')) {
    await completeToolingRun(run.id);
    return;
  }
  if (run.kind !== 'weekly') {
    notes.push('report skipped: pull runs do not generate the weekly entrants report');
    await markToolingUnitSwept(run.id, 'report');
    await completeToolingRun(run.id);
    return;
  }
  const budget = await checkToolingBudget(run.id, run.kind);
  if (!budget.ok) {
    notes.push(`budget cap reached: entrants report skipped ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)})`);
    await markToolingUnitSwept(run.id, 'report');
    await completeToolingRun(run.id);
    return;
  }
  const prefs = await getToolingPrefs();
  try {
    // The seven days ending on the run day: this Monday's discoveries carry
    // first_seen = run.day, and anything added by hand during the week
    // before is in the window too. Idempotent per Monday (scope_to = run.day).
    const result = await runWeeklyEntrantsReport(run.id, shiftDay(run.day, -6), run.day, prefs.auto_publish_entrants);
    if ('reportId' in result) {
      await setToolingRunReport(run.id, result.reportId);
    } else {
      notes.push(`entrants report: ${result.skipped}`);
    }
  } catch (e) {
    notes.push(`entrants report failed: ${String((e as Error)?.message ?? 'error').slice(0, 150)}`);
  }
  await markToolingUnitSwept(run.id, 'report');
  await completeToolingRun(run.id);
}
