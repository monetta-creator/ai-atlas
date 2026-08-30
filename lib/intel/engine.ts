import {
  getActiveIntelCompanies, getIntelRun, getIntelPrefs,
  getPendingIntelFetchItems, getPendingIntelEnrichItems, getIntelStepCounts,
} from '../data/intel';
import {
  createIntelRun, claimIntelRun, renewIntelLease, releaseIntelLease, setIntelStep,
  markIntelUnitSwept, bumpIntelRunCount, completeIntelRun, insertIntelItems,
  setIntelItemFetchResult, setIntelItemEnrichment, insertIntelFacts, upsertIntelMetrics,
  sweepUnenrichableIntelItems, skipAllPendingIntelEnrichment, appendIntelRunNotes,
} from '../mutations/intel';
import { fetchFeed } from '../scan/feeds';
import { lookbackDays, withinWindow } from '../scan/core';
import { fetchCandidateText, FetchFailure, domainOf } from '../pipeline/web';
import { pickEnrichModel } from '../scan/models';
import { searchCompanyNewsTavily } from './search';
import { fetchRecentFilings } from './edgar';
import { fetchEdgarMetrics, fetchFdicMetrics, fetchCfpbComplaints } from './metrics';
import { enrichIntelItem } from './enrich';
import { synthesizeCompanyDossier } from './synthesis';
import { checkIntelBudget } from './budget';
import { searchDueSlugs, nextUnsweptSlug, sweepUnit, unwrapNewsUrl } from './core';
import type { IntelCompany, IntelProgress, IntelRun } from '../types';

// The intel desk's checkpointed step engine (the scan engine pattern), shared
// by the cron route and the console's tick action. Every unit persists to
// intel_runs/intel_items before the next begins, so an invocation that runs
// out of time resumes exactly where it stopped. Legs in order: feeds (free,
// all companies at once), search (Tavily, one company per unit on a 3-day
// ring), filings (EDGAR per company; Mondays also pull the structured
// metrics), hydrate (full-text waves), enrich (cheap-model waves + fact
// extraction, budget-guarded).

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

export async function getOrCreateTodayIntelRun(): Promise<{ runId: string; day: string; created: boolean }> {
  const day = todayUTC();
  const { id, created } = await createIntelRun(day);
  return { runId: id, day, created };
}

export { claimIntelRun };

function progressOf(run: IntelRun, notes: string[]): IntelProgress {
  return {
    runId: run.id,
    day: run.day,
    step: run.step,
    done: run.status === 'completed',
    counters: {
      feedItems: run.feed_item_count,
      searchItems: run.search_item_count,
      filingItems: run.filing_item_count,
      hydrated: run.hydrated_count,
      enriched: run.enriched_count,
      skipped: run.skipped_count,
      facts: run.fact_count,
      metrics: run.metric_count,
    },
    notes,
  };
}

// One invocation's worth of work: loop bounded units until the deadline or
// the run completes. The caller holds the lease (claimIntelRun) first.
export async function advanceIntelRun(runId: string, deadlineAt: number): Promise<IntelProgress> {
  const notes: string[] = [];
  try {
    while (Date.now() < deadlineAt) {
      const run = await getIntelRun(runId);
      if (!run) throw new Error('intel run not found');
      if (run.status === 'completed') return progressOf(run, notes);
      await renewIntelLease(runId);

      if (run.step === 'feeds') {
        await runFeedsStep(run, notes);
        await setIntelStep(runId, 'search');
        continue;
      }

      if (run.step === 'search') {
        if (!process.env.TAVILY_API_KEY) {
          notes.push('search skipped: TAVILY_API_KEY unset (feeds and filings still ran)');
          await setIntelStep(runId, 'filings');
          continue;
        }
        const companies = await getActiveIntelCompanies();
        const due = searchDueSlugs(companies.map((c) => c.slug), run.day);
        const next = nextUnsweptSlug(due, 'search', run.swept_units);
        if (!next) {
          await setIntelStep(runId, 'filings');
          continue;
        }
        await runSearchUnit(run, companies.find((c) => c.slug === next) as IntelCompany, notes);
        continue;
      }

      if (run.step === 'filings') {
        const companies = await getActiveIntelCompanies();
        const next = nextUnsweptSlug(companies.map((c) => c.slug), 'filings', run.swept_units);
        if (!next) {
          await setIntelStep(runId, 'hydrate');
          continue;
        }
        await runFilingsUnit(run, companies.find((c) => c.slug === next) as IntelCompany, notes);
        continue;
      }

      if (run.step === 'hydrate') {
        const counts = await getIntelStepCounts(runId);
        if (counts.pendingFetch === 0) {
          await setIntelStep(runId, 'enrich');
          continue;
        }
        await runHydrateWave(run, notes);
        continue;
      }

      // step 'enrich' (or a legacy 'complete' with status still running)
      const swept = await sweepUnenrichableIntelItems(runId);
      if (swept) await bumpIntelRunCount(runId, 'skipped_count', swept);
      const counts = await getIntelStepCounts(runId);
      if (counts.pendingEnrich === 0) {
        // Monday runs close with the weekly dossier synthesis, one company
        // per unit, checkpointed like every other leg and budget-guarded.
        if (lookbackDays(run.day) > 1) {
          const companies = await getActiveIntelCompanies();
          const next = nextUnsweptSlug(companies.map((c) => c.slug), 'synthesis', run.swept_units);
          if (next) {
            const budget = await checkIntelBudget();
            if (budget.ok) {
              await runSynthesisUnit(run, companies.find((c) => c.slug === next) as IntelCompany, notes);
              continue;
            }
            notes.push('budget cap reached: remaining dossier syntheses skipped');
          }
        }
        await completeIntelRun(runId);
        continue;
      }
      const budget = await checkIntelBudget();
      if (!budget.ok) {
        const skipped = await skipAllPendingIntelEnrichment(runId);
        if (skipped) await bumpIntelRunCount(runId, 'skipped_count', skipped);
        notes.push(`budget cap reached: ${skipped} items shipped without enrichment`);
        await completeIntelRun(runId);
        continue;
      }
      await runEnrichWave(run, notes);
    }
    const run = await getIntelRun(runId);
    if (!run) throw new Error('intel run not found');
    if (run.status !== 'completed') notes.push('time budget reached: resume to continue');
    return progressOf(run, notes);
  } finally {
    await appendIntelRunNotes(
      runId,
      notes.filter((n) => !n.startsWith('time budget reached'))
    ).catch(() => {});
    await releaseIntelLease(runId).catch(() => {});
  }
}

// ---- feeds: the free leg. Every active company's feeds in parallel; a dead
// feed is a note, never a failure. Window = lookbackDays before the run day
// (three on Mondays for the weekend).
async function runFeedsStep(run: IntelRun, notes: string[]): Promise<void> {
  const companies = await getActiveIntelCompanies();
  const jobs: { company: IntelCompany; feedUrl: string }[] = companies.flatMap((c) =>
    c.feed_urls.map((feedUrl) => ({ company: c, feedUrl }))
  );
  if (!jobs.length) return;
  const since = shiftDay(run.day, -lookbackDays(run.day));
  const results = await Promise.allSettled(jobs.map((j) => fetchFeed(j.feedUrl)));
  for (let i = 0; i < jobs.length; i++) {
    const r = results[i];
    const { company, feedUrl } = jobs[i];
    if (r.status === 'rejected') {
      notes.push(`feed failed (${company.slug}): ${domainOf(feedUrl) || feedUrl}: ${String((r.reason as Error)?.message ?? r.reason)}`);
      continue;
    }
    const items = r.value
      .filter((it) => withinWindow(it.publishedISO, since))
      .map((it) => {
        const url = unwrapNewsUrl(it.url);
        return {
          url,
          headline: it.title,
          source_domain: domainOf(url),
          published_date: it.publishedISO ?? '',
        };
      });
    const { inserted } = await insertIntelItems(run.id, company.slug, 'feed', items);
    if (inserted) await bumpIntelRunCount(run.id, 'feed_item_count', inserted);
  }
}

// ---- search: one company per unit on the 3-day ring, checkpointed in
// swept_units so a resumed invocation never repeats a company.
async function runSearchUnit(run: IntelRun, company: IntelCompany, notes: string[]): Promise<void> {
  const since = shiftDay(run.day, -lookbackDays(run.day));
  const oldest = shiftDay(run.day, -7); // wire-pickup lag tolerance
  try {
    const found = await searchCompanyNewsTavily({
      company, sinceISO: since, dayISO: run.day, intelRunId: run.id,
    });
    const fresh = found.filter(
      (it) => !/^\d{4}-\d{2}-\d{2}$/.test(it.published_date) || it.published_date >= oldest
    );
    const { inserted } = await insertIntelItems(run.id, company.slug, 'search', fresh);
    if (inserted) await bumpIntelRunCount(run.id, 'search_item_count', inserted);
  } catch (e) {
    notes.push(`search failed (${company.slug}): ${String((e as Error)?.message ?? 'error')}`);
  }
  await markIntelUnitSwept(run.id, sweepUnit('search', company.slug));
}

// ---- filings: one company per unit. EDGAR submissions daily for filers;
// Mondays additionally pull the structured metrics (EDGAR XBRL + FDIC +
// CFPB) — quarterly data does not move daily and the upsert is idempotent.
async function runFilingsUnit(run: IntelRun, company: IntelCompany, notes: string[]): Promise<void> {
  const since = shiftDay(run.day, -lookbackDays(run.day));
  try {
    if (company.cik) {
      const filings = await fetchRecentFilings(company.cik, since, run.id);
      if (filings.length) {
        const { inserted } = await insertIntelItems(
          run.id, company.slug, 'edgar',
          filings.map((f) => ({
            url: f.url, headline: f.headline, source_domain: 'sec.gov',
            published_date: f.published_date, doc_type: 'filing' as const,
          }))
        );
        if (inserted) await bumpIntelRunCount(run.id, 'filing_item_count', inserted);
      }
    }
    if (lookbackDays(run.day) > 1) {
      const results = await Promise.allSettled([
        fetchEdgarMetrics(company, run.id),
        fetchFdicMetrics(company, run.id),
        fetchCfpbComplaints(company, run.day, run.id),
      ]);
      const rows = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      for (const r of results) {
        if (r.status === 'rejected') {
          notes.push(`metrics failed (${company.slug}): ${String((r.reason as Error)?.message ?? 'error').slice(0, 120)}`);
        }
      }
      if (rows.length) {
        const written = await upsertIntelMetrics(rows);
        if (written) await bumpIntelRunCount(run.id, 'metric_count', written);
      }
    }
  } catch (e) {
    notes.push(`filings failed (${company.slug}): ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
  }
  await markIntelUnitSwept(run.id, sweepUnit('filings', company.slug));
}

// ---- synthesis: the weekly dossier refresh (Monday runs only), one company
// per unit. A per-company failure is a note; the unit checkpoints either way
// so a wedged company cannot loop the run.
async function runSynthesisUnit(run: IntelRun, company: IntelCompany, notes: string[]): Promise<void> {
  try {
    const prefs = await getIntelPrefs();
    await synthesizeCompanyDossier(company, run.id, prefs.utility_model);
  } catch (e) {
    notes.push(`synthesis failed (${company.slug}): ${String((e as Error)?.message ?? 'error').slice(0, 120)}`);
  }
  await markIntelUnitSwept(run.id, sweepUnit('synthesis', company.slug));
}

// ---- hydrate: a small parallel wave over fetchCandidateText. Failures mark
// 'failed' with the message; the daily cadence is the retry.
async function runHydrateWave(run: IntelRun, notes: string[]): Promise<void> {
  const items = await getPendingIntelFetchItems(run.id, HYDRATE_POOL);
  if (!items.length) return;
  let hydrated = 0;
  await Promise.all(
    items.map(async (item) => {
      try {
        const { text, via } = await fetchCandidateText(item.url, { maxChars: 24_000 });
        await setIntelItemFetchResult(item.id, { status: 'done', text, via });
        hydrated += 1;
      } catch (e) {
        const msg = e instanceof FetchFailure ? e.message : String((e as Error)?.message ?? 'fetch failed');
        await setIntelItemFetchResult(item.id, { status: 'failed', error: msg });
      }
    })
  );
  if (hydrated) await bumpIntelRunCount(run.id, 'hydrated_count', hydrated);
  if (hydrated < items.length) notes.push(`hydrate: ${items.length - hydrated} of ${items.length} failed this wave`);
}

// ---- enrich: cheap-model waves + fact extraction. The picker's selection
// assigns each item a model deterministically; enriched_by stamps success
// AND error so A/B error rates stay measurable. Facts insert after the item
// write so a fact always points at an enriched item.
async function runEnrichWave(run: IntelRun, notes: string[]): Promise<void> {
  const [companies, prefs] = await Promise.all([getActiveIntelCompanies(), getIntelPrefs()]);
  const items = await getPendingIntelEnrichItems(run.id, ENRICH_POOL);
  if (!items.length) return;
  let enriched = 0;
  let factsWritten = 0;
  await Promise.all(
    items.map(async (item) => {
      const model = pickEnrichModel(prefs.enrich_models, item.id);
      try {
        const e = await enrichIntelItem(item, companies, run.id, model ?? undefined);
        await setIntelItemEnrichment(item.id, {
          status: 'done',
          summary: e.summary,
          companySlugs: e.companySlugs,
          dimensions: e.dimensions,
          entities: e.entities,
          significance: e.significance,
          enrichedBy: model ?? 'claude-haiku-4-5',
        });
        if (e.facts.length) {
          factsWritten += await insertIntelFacts(e.facts.map((f) => ({ ...f, item_id: item.id })));
        }
        enriched += 1;
      } catch (err) {
        await setIntelItemEnrichment(item.id, { status: 'error', enrichedBy: model ?? 'claude-haiku-4-5' });
        notes.push(`enrich failed (${model ?? 'haiku'} · ${item.source_domain ?? 'item'}): ${String((err as Error)?.message ?? 'error').slice(0, 120)}`);
      }
    })
  );
  if (enriched) await bumpIntelRunCount(run.id, 'enriched_count', enriched);
  if (factsWritten) await bumpIntelRunCount(run.id, 'fact_count', factsWritten);
}
