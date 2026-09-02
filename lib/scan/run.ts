import {
  getActiveScanTopics, getScanRun, getScanPrefs, getPendingFetchItems, getPendingEnrichItems,
  getScanStepCounts,
} from '../data/scan';
import {
  createScanRun, claimScanRun, renewScanLease, releaseScanLease, setScanStep,
  markScanTopicSearched, bumpScanRunCount, completeScanRun, insertScanItems,
  setScanItemFetchResult, setScanItemEnrichment, sweepUnenrichableItems, skipAllPendingEnrichment,
  appendScanRunNotes, failStaleScanRuns,
} from '../mutations/scan';
import { fetchFeed } from './feeds';
import { searchTopicNews, type RawScanItem } from './web';
import { searchTopicNewsTavily } from './search-tavily';
import { searchTopicNewsGdelt, gdeltAvailable } from './search-gdelt';
import { enrichScanItem } from './enrich';
import { pickEnrichModel } from './models';
import { checkScanBudget } from './budget';
import { rateAndStampSources } from './source-rating';
import { lookbackDays, nextSearchTopic, withinWindow } from './core';
import { resolveDateTokens, rotatedQueries, LOW_QUALITY_DOMAINS } from '../pipeline/config';
import { fetchCandidateText, FetchFailure, domainOf } from '../pipeline/web';
import type { ScanProgress, ScanRun, ScanTopic } from '../types';

// The scan's checkpointed step engine, shared by the cron route (270s budget)
// and the console's tick action (45s budget). Every unit of work persists to
// scan_runs/scan_items before the next begins, so an invocation that runs out
// of time (or dies) resumes exactly where it stopped. Model calls stay bounded
// (search 50s, enrich 30s) well under either caller's budget.

const HYDRATE_POOL = 4;
const ENRICH_POOL = 3;

function shiftDay(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getOrCreateTodayRun(): Promise<{ runId: string; day: string; created: boolean }> {
  // Stale-run janitor: fail any prior day's run still marked running before
  // touching today's row (it can never be resumed once its day has passed).
  await failStaleScanRuns().catch(() => {});
  const day = todayUTC();
  const { id, created } = await createScanRun(day);
  return { runId: id, day, created };
}

export { claimScanRun };

function progressOf(run: ScanRun, notes: string[]): ScanProgress {
  return {
    runId: run.id,
    day: run.day,
    step: run.step,
    done: run.status === 'completed',
    counters: {
      feedItems: run.feed_item_count,
      searchItems: run.search_item_count,
      hydrated: run.hydrated_count,
      enriched: run.enriched_count,
      skipped: run.skipped_count,
    },
    notes,
  };
}

// One invocation's worth of work: loop bounded units until the deadline or the
// run completes. The caller holds the lease (claimScanRun) before calling.
export async function advanceScanRun(runId: string, deadlineAt: number): Promise<ScanProgress> {
  const notes: string[] = [];
  try {
    while (Date.now() < deadlineAt) {
      const run = await getScanRun(runId);
      if (!run) throw new Error('scan run not found');
      if (run.status === 'completed') return progressOf(run, notes);
      await renewScanLease(runId);

      if (run.step === 'feeds') {
        await runFeedsStep(run, notes);
        await setScanStep(runId, 'search');
        continue;
      }

      if (run.step === 'search') {
        const topics = await getActiveScanTopics();
        const next = nextSearchTopic(topics, run.searched_topics);
        if (!next) {
          await rateSourcesBeforeHydrate(run, notes);
          await setScanStep(runId, 'hydrate');
          continue;
        }
        const budget = await checkScanBudget();
        if (!budget.ok) {
          notes.push(`budget cap reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}): skipping remaining topic searches`);
          await setScanStep(runId, 'hydrate');
          continue;
        }
        const topicIndex = topics.indexOf(next);
        await runSearchUnit(run, next, topicIndex, notes);
        continue;
      }

      if (run.step === 'hydrate') {
        const counts = await getScanStepCounts(runId);
        if (counts.pendingFetch === 0) {
          await setScanStep(runId, 'enrich');
          continue;
        }
        await runHydrateWave(run, notes);
        continue;
      }

      // step 'enrich' (or a legacy 'complete' with status still running)
      const swept = await sweepUnenrichableItems(runId);
      if (swept) await bumpScanRunCount(runId, 'skipped_count', swept);
      const counts = await getScanStepCounts(runId);
      if (counts.pendingEnrich === 0) {
        await completeScanRun(runId);
        continue;
      }
      const budget = await checkScanBudget();
      if (!budget.ok) {
        const skipped = await skipAllPendingEnrichment(runId);
        if (skipped) await bumpScanRunCount(runId, 'skipped_count', skipped);
        notes.push(`budget cap reached: ${skipped} items shipped without enrichment`);
        await completeScanRun(runId);
        continue;
      }
      await runEnrichWave(run, notes);
    }
    const run = await getScanRun(runId);
    if (!run) throw new Error('scan run not found');
    if (run.status !== 'completed') notes.push('time budget reached: resume to continue');
    return progressOf(run, notes);
  } finally {
    // Persist issue notes for the health panel (0040), including the
    // time-budget line: it is the only DB evidence a window was exhausted.
    await appendScanRunNotes(runId, notes).catch(() => {});
    await releaseScanLease(runId).catch(() => {});
  }
}

// ---- feeds: the free leg. All topic feeds in parallel; a dead feed is a note,
// never a failure. Window = lookbackDays before the run day (one day normally,
// three on Mondays to cover the weekend the crons skip; dateless items pass
// and the dedupe absorbs repeats).
async function runFeedsStep(run: ScanRun, notes: string[]): Promise<void> {
  const topics = await getActiveScanTopics();
  const jobs: { topic: ScanTopic; feedUrl: string }[] = topics.flatMap((t) =>
    t.feed_urls.map((feedUrl) => ({ topic: t, feedUrl }))
  );
  if (!jobs.length) return;
  const since = shiftDay(run.day, -lookbackDays(run.day));
  const results = await Promise.allSettled(jobs.map((j) => fetchFeed(j.feedUrl)));
  for (let i = 0; i < jobs.length; i++) {
    const r = results[i];
    const { topic, feedUrl } = jobs[i];
    if (r.status === 'rejected') {
      notes.push(`feed failed (${topic.slug}): ${domainOf(feedUrl) || feedUrl}: ${String((r.reason as Error)?.message ?? r.reason)}`);
      continue;
    }
    const items = r.value
      .filter((it) => withinWindow(it.publishedISO, since))
      .map((it) => ({
        url: it.url,
        headline: it.title,
        source_domain: domainOf(it.url),
        published_date: it.publishedISO ?? '',
      }));
    const { inserted } = await insertScanItems(run.id, topic.slug, topic.slug, items);
    if (inserted) await bumpScanRunCount(run.id, 'feed_item_count', inserted);
  }
}

// ---- search: one topic per unit, checkpointed in searched_topics so a
// resumed invocation never repeats a topic. Queries rotate over the topic's
// FULL query list day by day (rotatedQueries, the pipeline's daily-rotation
// recipe) instead of always taking the first two. Provider alternates by
// (topicIndex + dayIndex) parity when TAVILY_API_KEY is set, so every topic
// sees both Tavily and GDELT across consecutive days and each free tier only
// carries half the daily load; with no Tavily key every topic goes to GDELT.
// GDELT's circuit breaker (gdeltAvailable/markGdeltDown, see search-gdelt.ts)
// is checked before every GDELT call, and a GDELT call that throws anyway
// falls through to the SAME-invocation fallback: Tavily (free) when
// TAVILY_API_KEY is set, and only when neither free provider is available
// does the original Sonnet + web_search call run as the last resort.
async function searchFallback(
  topic: ScanTopic,
  queries: string[],
  since: string,
  runId: string
): Promise<RawScanItem[]> {
  if (process.env.TAVILY_API_KEY) {
    return searchTopicNewsTavily({ topicName: topic.name, queries, sinceISO: since, scanRunId: runId });
  }
  return searchTopicNews({
    topicName: topic.name,
    topicDescription: topic.description,
    queries,
    sinceISO: since,
    maxUses: 1,
    scanRunId: runId,
    blockedDomains: LOW_QUALITY_DOMAINS,
  });
}

async function runSearchUnit(
  run: ScanRun,
  topic: ScanTopic,
  topicIndex: number,
  notes: string[]
): Promise<void> {
  const since = shiftDay(run.day, -lookbackDays(run.day));
  const oldest = shiftDay(run.day, -7); // wire-pickup lag tolerance for the search leg
  const queries = resolveDateTokens(rotatedQueries(topic.search_queries, run.day), run.day);
  const dayIndex = Math.floor(Date.parse(`${run.day}T00:00:00Z`) / 86_400_000);
  const useTavily = !!process.env.TAVILY_API_KEY && (topicIndex + dayIndex) % 2 === 0;
  try {
    let found: RawScanItem[];
    if (useTavily) {
      found = await searchTopicNewsTavily({
        topicName: topic.name,
        queries,
        sinceISO: since,
        scanRunId: run.id,
      });
    } else if (!gdeltAvailable()) {
      notes.push(`gdelt skipped (${topic.slug}): circuit open`);
      found = await searchFallback(topic, queries, since, run.id);
    } else {
      try {
        found = await searchTopicNewsGdelt({
          topicName: topic.name,
          queries,
          sinceISO: since,
          scanRunId: run.id,
        });
      } catch (e) {
        notes.push(`gdelt failed (${topic.slug}): ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
        found = await searchFallback(topic, queries, since, run.id);
      }
    }
    const fresh = found.filter(
      (it) => !/^\d{4}-\d{2}-\d{2}$/.test(it.published_date) || it.published_date >= oldest
    );
    const { inserted } = await insertScanItems(run.id, topic.slug, 'web_search', fresh);
    if (inserted) await bumpScanRunCount(run.id, 'search_item_count', inserted);
  } catch (e) {
    // A slow or overloaded call (Tavily, or the Sonnet fallback): checkpoint
    // the topic as attempted and move on rather than wedging the run on one
    // topic forever (tomorrow retries it).
    notes.push(`search failed (${topic.slug}): ${String((e as Error)?.message ?? 'error')}`);
  }
  await markScanTopicSearched(run.id, topic.slug);
}

// ---- source tiers (0052): once per run, right at the search-to-hydrate
// boundary, stamp every item's source_tier/source_kind from the rules + the
// model-rated table, then rate whatever the rules don't cover. The step
// transition above guarantees this runs exactly once per run. NOTE: scan_prefs
// has no utility_model column (unlike pipeline_prefs/intel_prefs), so this
// leaves utilityModel unset and rateDomainsWithModel falls back to
// DEFAULT_UTILITY_MODEL. Never blocks hydrate: a thrown error is caught here
// too, as a last resort belt to rateAndStampSources's own internal catch.
async function rateSourcesBeforeHydrate(run: ScanRun, notes: string[]): Promise<void> {
  try {
    const result = await rateAndStampSources('scan_items', run.id, {
      budgetOk: async () => (await checkScanBudget()).ok,
      metadata: { scan_run: run.id },
    });
    if (result.note) notes.push(result.note);
  } catch (e) {
    notes.push(`source rating failed: ${String((e as Error)?.message ?? 'error').slice(0, 160)}`);
  }
}

// ---- hydrate: a small parallel wave over fetchCandidateText. Both terminal
// and transient failures mark 'failed' with the message: the cadence is daily,
// so tomorrow's run is the retry (and the dataset still carries the item).
async function runHydrateWave(run: ScanRun, notes: string[]): Promise<void> {
  const items = await getPendingFetchItems(run.id, HYDRATE_POOL);
  if (!items.length) return;
  let hydrated = 0;
  await Promise.all(
    items.map(async (item) => {
      try {
        const { text, via } = await fetchCandidateText(item.url, { maxChars: 24_000 });
        await setScanItemFetchResult(item.id, { status: 'done', text, via });
        hydrated += 1;
      } catch (e) {
        const msg = e instanceof FetchFailure ? e.message : String((e as Error)?.message ?? 'fetch failed');
        await setScanItemFetchResult(item.id, { status: 'failed', error: msg });
      }
    })
  );
  if (hydrated) await bumpScanRunCount(run.id, 'hydrated_count', hydrated);
  if (hydrated < items.length) notes.push(`hydrate: ${items.length - hydrated} of ${items.length} failed this wave`);
}

// ---- enrich: a small parallel wave of model calls. The /scan picker's
// selection assigns each item a model deterministically (2+ selected =
// the round-robin A/B split; empty = the Haiku fallback), and enriched_by
// stamps the item either way. A per-item model failure gets a one-shot retry
// on the next configured model (a single model's timeout or overload should
// not sink the item for the day); only a second failure marks 'error' (raw
// text still ships). The wave never throws.
async function runEnrichWave(run: ScanRun, notes: string[]): Promise<void> {
  const [topics, prefs] = await Promise.all([getActiveScanTopics(), getScanPrefs()]);
  const items = await getPendingEnrichItems(run.id, ENRICH_POOL);
  if (!items.length) return;
  let enriched = 0;
  await Promise.all(
    items.map(async (item) => {
      const model = pickEnrichModel(prefs.enrich_models, item.id);
      const attempt = async (m: string | null) => {
        const e = await enrichScanItem(item, topics, run.id, m ?? undefined);
        await setScanItemEnrichment(item.id, { status: 'done', ...e, enrichedBy: m ?? 'claude-haiku-4-5' });
      };
      try {
        await attempt(model);
        enriched += 1;
      } catch {
        const models = prefs.enrich_models;
        const alt = models.length > 1 ? models[(models.indexOf(model ?? '') + 1) % models.length] : null;
        try {
          await attempt(alt);
          enriched += 1;
        } catch (err2) {
          await setScanItemEnrichment(item.id, { status: 'error', enrichedBy: alt ?? 'claude-haiku-4-5' });
          notes.push(`enrich failed (${model ?? 'haiku'} then ${alt ?? 'haiku fallback'} · ${item.source_domain ?? 'item'}): ${String((err2 as Error)?.message ?? 'error').slice(0, 120)}`);
        }
      }
    })
  );
  if (enriched) await bumpScanRunCount(run.id, 'enriched_count', enriched);
}
