import {
  getActiveScanTopics, getScanRun, getPendingFetchItems, getPendingEnrichItems, getScanStepCounts,
} from '../data/scan';
import {
  createScanRun, claimScanRun, renewScanLease, releaseScanLease, setScanStep,
  markScanTopicSearched, bumpScanRunCount, completeScanRun, insertScanItems,
  setScanItemFetchResult, setScanItemEnrichment, sweepUnenrichableItems, skipAllPendingEnrichment,
} from '../mutations/scan';
import { fetchFeed } from './feeds';
import { searchTopicNews } from './web';
import { enrichScanItem } from './enrich';
import { checkScanBudget } from './budget';
import { nextSearchTopic, withinWindow } from './core';
import { resolveDateTokens, LOW_QUALITY_DOMAINS } from '../pipeline/config';
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
          await setScanStep(runId, 'hydrate');
          continue;
        }
        const budget = await checkScanBudget();
        if (!budget.ok) {
          notes.push(`budget cap reached ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}): skipping remaining topic searches`);
          await setScanStep(runId, 'hydrate');
          continue;
        }
        await runSearchUnit(run, next, notes);
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
    await releaseScanLease(runId).catch(() => {});
  }
}

// ---- feeds: the free leg. All topic feeds in parallel; a dead feed is a note,
// never a failure. Window = the day before the run day (press feeds publish
// same-day; dateless items pass and the dedupe absorbs repeats).
async function runFeedsStep(run: ScanRun, notes: string[]): Promise<void> {
  const topics = await getActiveScanTopics();
  const jobs: { topic: ScanTopic; feedUrl: string }[] = topics.flatMap((t) =>
    t.feed_urls.map((feedUrl) => ({ topic: t, feedUrl }))
  );
  if (!jobs.length) return;
  const since = shiftDay(run.day, -1);
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

// ---- search: one topic per unit (one web_search call, ~35-50s), checkpointed
// in searched_topics so a resumed invocation never repeats a topic.
async function runSearchUnit(run: ScanRun, topic: ScanTopic, notes: string[]): Promise<void> {
  const since = shiftDay(run.day, -1);
  const oldest = shiftDay(run.day, -7); // wire-pickup lag tolerance for the search leg
  try {
    const found = await searchTopicNews({
      topicName: topic.name,
      topicDescription: topic.description,
      queries: resolveDateTokens(topic.search_queries, run.day).slice(0, 2),
      sinceISO: since,
      maxUses: 1,
      scanRunId: run.id,
      blockedDomains: LOW_QUALITY_DOMAINS,
    });
    const fresh = found.filter(
      (it) => !/^\d{4}-\d{2}-\d{2}$/.test(it.published_date) || it.published_date >= oldest
    );
    const { inserted } = await insertScanItems(run.id, topic.slug, 'web_search', fresh);
    if (inserted) await bumpScanRunCount(run.id, 'search_item_count', inserted);
  } catch (e) {
    // A slow or overloaded call: checkpoint the topic as attempted and move on
    // rather than wedging the run on one topic forever (tomorrow retries it).
    notes.push(`search failed (${topic.slug}): ${String((e as Error)?.message ?? 'error')}`);
  }
  await markScanTopicSearched(run.id, topic.slug);
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

// ---- enrich: a small parallel wave of Haiku calls. A per-item model failure
// marks 'error' (raw text still ships); the wave never throws.
async function runEnrichWave(run: ScanRun, notes: string[]): Promise<void> {
  const topics = await getActiveScanTopics();
  const items = await getPendingEnrichItems(run.id, ENRICH_POOL);
  if (!items.length) return;
  let enriched = 0;
  await Promise.all(
    items.map(async (item) => {
      try {
        const e = await enrichScanItem(item, topics, run.id);
        await setScanItemEnrichment(item.id, { status: 'done', ...e });
        enriched += 1;
      } catch (err) {
        await setScanItemEnrichment(item.id, { status: 'error' });
        notes.push(`enrich failed (${item.source_domain ?? 'item'}): ${String((err as Error)?.message ?? 'error').slice(0, 120)}`);
      }
    })
  );
  if (enriched) await bumpScanRunCount(run.id, 'enriched_count', enriched);
}
