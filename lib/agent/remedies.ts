import { one, q } from '../db';
import * as m from '../mutations';
import {
  getPipelinePrefs, getDedupeScan,
  getScoutQueueIds, getUnrecommendedPaperIds, getQuestionSummaryInput,
  getAllDomainRows, getRecentReports, getSignals, getConceptGraph, getTargets,
  getToolingRunByKey, getToolingPrefs,
} from '../data';
import { getFindingByKey } from '../data/agent';
import { isBlackout, hoursSince, mondayUtc, isWeekdayUtc, lastFridayUtc } from './time';
import { checkAgentBudget } from './budget';
import type { Actor, JobKey, RemedyResult, RemedyRef, RemedyTier } from './types';
import { JOB_KEYS } from './types';

import { dedupeAllDrafts } from '../pipeline/dedupe';
import { refetchMissingText } from '../pipeline/hydrate';

import { getOrCreateTodayRun as scanGetOrCreate, claimScanRun, advanceScanRun } from '../scan/run';
import { getOrCreateDailyRun as pipelineGetOrCreate, advancePipelineRun } from '../pipeline/engine';
import { getOrCreateTodayIntelRun as intelGetOrCreate, claimIntelRun, advanceIntelRun } from '../intel/engine';
import { getOrCreateTodayResearchRun as researchGetOrCreate, claimResearchRun, advanceResearchRun } from '../research/engine';
import { getOrCreateToolingRun as toolingGetOrCreate, claimToolingRun, advanceToolingRun } from '../tooling/engine';

import { runWeeklyRoundup } from '../research/roundup';
import { runWeeklyEntrantsReport } from '../tooling/reports';
import { runIntelDeck } from '../intel/deck-run';
import { generateQuestionSummary } from '../summary';
import { diagnoseArgumentGaps, htmlToText } from '../argument-gaps';
import { validateGapRecommendations } from '../gaps-core';
import { diagnoseConceptGaps } from '../concepts';
import { recommendQueueChunk } from '../research/queue-agent';
import { scoreScoutChunk } from '../scout/agent';
import { countMissingEmbeddings, type EmbedKind } from '../embed/sources';
import { embedModel } from '../embed/client';
import { indexKind } from '../embed';
import { checkEmbedBudget } from '../embed/hooks';
import type { ArgumentGapScan, ConceptGapScan } from '../types';

// ---- Hands: the remedy allow-list -------------------------------------------
// Every entry calls an EXISTING library function, never a server action
// (actions redirect/revalidate, which an agent-driven call has no use for),
// and never a getOrCreate* unless createsRun is true. `tier` decides who may
// run it: 'auto' the agent itself on the hourly tick, 'propose' the maintainer (the
// drawer's Do it button, or the chat's run_remedy tool), 'never' nobody but a
// human clicking somewhere else in the app.

export interface Remedy {
  key: string;
  label: string;
  tier: RemedyTier;
  costsModel: boolean;
  reversible: boolean;
  createsRun: boolean;
  run(args: Record<string, unknown>, ctx: { actor: Actor; now: Date }): Promise<RemedyResult>;
}

// Measures the model spend a remedy's own call incurs by comparing
// ai_cost_log over the callee's known feature tags before/after the call.
// The callees below don't take a custom feature tag, so this time-bounded
// delta is the practical equivalent of the "agent_remedy-tagged rows" idea in
// the plan: it isolates exactly the rows this invocation wrote.
async function measureCost<T>(features: string[], fn: () => Promise<T>): Promise<{ value: T; costUsd: number }> {
  const since = new Date().toISOString();
  const value = await fn();
  const row = await one<{ usd: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
      where feature = any($1::text[]) and created_at >= $2::timestamptz`,
    [features, since]
  );
  return { value, costUsd: row?.usd ?? 0 };
}

function shiftDayIso(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isJobKey(v: unknown): v is JobKey {
  return typeof v === 'string' && (JOB_KEYS as string[]).includes(v);
}

const CLAIMERS: Record<JobKey, (runId: string) => Promise<boolean>> = {
  scan: claimScanRun,
  pipeline: m.claimPipelineRun,
  intel: claimIntelRun,
  research: claimResearchRun,
  tooling: claimToolingRun,
};

type AdvanceFn = (runId: string, deadlineAt: number) => Promise<{ done: boolean }>;

const ADVANCERS: Record<JobKey, AdvanceFn> = {
  scan: advanceScanRun,
  pipeline: advancePipelineRun,
  intel: advanceIntelRun,
  research: advanceResearchRun,
  tooling: advanceToolingRun,
};

// The most recent FAILED run row for a job, today-or-yesterday. Never
// creates a row: engine.resume only ever advances something that already
// exists, which is what makes it safe as an auto-tier remedy.
async function findFailedRunId(job: JobKey): Promise<string | null> {
  if (job === 'pipeline') {
    const row = await one<{ id: string }>(
      `select id::text as id from pipeline_runs
        where cadence = 'daily' and created_at >= now() - interval '2 days' and status = 'failed'
        order by created_at desc limit 1`
    );
    return row?.id ?? null;
  }
  const table = job === 'scan' ? 'scan_runs' : job === 'intel' ? 'intel_runs'
    : job === 'research' ? 'research_runs' : 'tooling_runs';
  const dayFilter = job === 'research' ? 'day is not null and ' : '';
  const row = await one<{ id: string }>(
    `select id::text as id from ${table}
      where ${dayFilter}day >= (now() at time zone 'utc')::date - 1 and status = 'failed'
      order by day desc limit 1`
  );
  return row?.id ?? null;
}

async function getOrCreateRunId(job: JobKey): Promise<string> {
  switch (job) {
    case 'scan': return (await scanGetOrCreate()).runId;
    case 'pipeline': return (await pipelineGetOrCreate()).runId;
    case 'intel': return (await intelGetOrCreate()).runId;
    case 'research': return (await researchGetOrCreate()).runId;
    case 'tooling': return (await toolingGetOrCreate('weekly')).runId;
  }
}

async function setJobEnabled(job: JobKey): Promise<void> {
  if (job === 'scan') await m.setScanEnabled(true);
  else if (job === 'pipeline') await m.setPipelineEnabled(true);
  else if (job === 'intel') await m.setIntelEnabled(true);
  else if (job === 'research') await m.setResearchEnabled(true);
  else await m.saveToolingPrefs({ enabled: true });
}

// A "yours alone" entry: exists so a finding's card can name the remedy and
// say why there is no button, and so a stray run_remedy call gets a clean
// refusal instead of a missing-key error.
function neverRemedy(key: string, label: string): Remedy {
  return {
    key, label, tier: 'never', costsModel: false, reversible: false, createsRun: false,
    run: async () => ({ ok: false, error: `${label} is yours alone.`, summary: `${label} is yours alone.` }),
  };
}

export const REMEDIES: Record<string, Remedy> = {
  // ---- Auto tier ------------------------------------------------------------
  'drafts.archive_no_touches': {
    key: 'drafts.archive_no_touches',
    label: 'Archive drafts with no claim touches, 3+ days old',
    tier: 'auto', costsModel: false, reversible: true, createsRun: false,
    run: async () => {
      const n = await m.archiveDraftsBulk('no_touches', 45, 3);
      return { ok: true, result: { archived: n }, summary: `Archived ${n} draft${n === 1 ? '' : 's'} with no claim touches, all at least 3 days old.` };
    },
  },

  'signals.promote_due': {
    key: 'signals.promote_due',
    label: 'Publish drafts due under the promotion policy',
    tier: 'auto', costsModel: false, reversible: true, createsRun: false,
    run: async () => {
      const prefs = await getPipelinePrefs();
      if (!prefs.auto_publish_high) {
        return { ok: true, result: { published: 0 }, summary: 'The promotion policy is off; nothing to publish.' };
      }
      const ids = await m.publishDueDrafts({ afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from });
      return { ok: true, result: { published: ids.length }, summary: `Published ${ids.length} draft${ids.length === 1 ? '' : 's'} due under the standing promotion policy.` };
    },
  },

  'text.refetch_missing': {
    key: 'text.refetch_missing',
    label: 'Refetch missing article text, up to 5 signals',
    tier: 'auto', costsModel: false, reversible: true, createsRun: false,
    run: async () => {
      const result = await refetchMissingText(5);
      return {
        ok: true, result,
        summary: `Retained text for ${result.retained} of ${result.attempted} attempted; coverage now ${result.coverage.with_text}/${result.coverage.total}.`,
      };
    },
  },

  'drafts.dedupe_scan': {
    key: 'drafts.dedupe_scan',
    label: 'Scan the draft queue for duplicates',
    tier: 'auto', costsModel: true, reversible: true, createsRun: false,
    run: async () => {
      const existing = await getDedupeScan();
      if (existing?.generated_at && hoursSince(existing.generated_at, new Date()) < 20) {
        return { ok: true, result: { skipped: true }, summary: 'Skipped: a dedupe scan already ran in the last 20 hours.' };
      }
      const { value, costUsd } = await measureCost(['draft_dedupe'], async () => {
        const rec = await dedupeAllDrafts();
        await m.saveDedupeScan(rec);
        return rec;
      });
      return {
        ok: true, result: { groups: value.groups.length, scanned: value.scanned, costUsd },
        summary: `Scanned ${value.scanned} drafts, found ${value.groups.length} duplicate group${value.groups.length === 1 ? '' : 's'}.`,
      };
    },
  },

  'embeddings.backfill': {
    key: 'embeddings.backfill',
    label: 'Backfill missing embeddings',
    tier: 'auto', costsModel: true, reversible: true, createsRun: false,
    run: async () => {
      const model = embedModel();
      const missing = await countMissingEmbeddings(q, model);
      const kinds = (Object.entries(missing) as [EmbedKind, number][])
        .filter(([, n]) => n > 0).map(([kind]) => kind);
      if (!kinds.length) {
        return { ok: true, result: { indexed: 0 }, summary: 'Nothing missing.' };
      }
      let indexed = 0;
      let costUsd = 0;
      for (const kind of kinds) {
        const budget = await checkEmbedBudget();
        if (!budget.ok) break; // daily embed budget spent; the rest waits for tomorrow
        const { value, costUsd: c } = await measureCost(['embed_index'], () =>
          indexKind(kind, { model, limit: 500 })
        );
        indexed += value.chunks;
        costUsd += c;
      }
      return {
        ok: true, result: { indexed, costUsd },
        summary: `Embedded ${indexed} chunk${indexed === 1 ? '' : 's'} across ${kinds.length} kind${kinds.length === 1 ? '' : 's'}.`,
      };
    },
  },

  'engine.resume': {
    key: 'engine.resume',
    label: 'Resume the failed engine run',
    tier: 'auto', costsModel: false, reversible: true, createsRun: false,
    run: async (args, { now }) => {
      if (!isJobKey(args.job)) return { ok: false, error: 'Unknown job.', summary: 'Unknown job.' };
      const job = args.job;
      // Resuming is safe only inside the engines' own working window: a
      // weekday between 09:00 and 22:00 UTC. Outside it the failed row waits
      // for the next morning's cron, which resumes it anyway.
      const h = now.getUTCHours();
      if (!isWeekdayUtc(now) || h < 9 || h >= 22) {
        return { ok: false, error: 'Outside engine hours.', summary: `Left the failed ${job} run for the next weekday window.` };
      }
      const runId = await findFailedRunId(job);
      if (!runId) return { ok: false, error: 'No failed run to resume.', summary: `No failed ${job} run in the last two days.` };
      if (!(await CLAIMERS[job](runId))) {
        return { ok: false, error: 'Run is busy.', summary: `The ${job} run is already claimed by another invocation.` };
      }
      const progress = await ADVANCERS[job](runId, Date.now() + 50_000);
      return { ok: true, result: progress, summary: `Resumed the failed ${job} run; ${progress.done ? 'now complete.' : 'still in progress.'}` };
    },
  },

  // ---- Propose tier -----------------------------------------------------------
  'drafts.archive_low': {
    key: 'drafts.archive_low',
    label: 'Archive active low-significance drafts',
    tier: 'propose', costsModel: false, reversible: true, createsRun: false,
    run: async () => {
      const n = await m.archiveDraftsBulk('low');
      return { ok: true, result: { archived: n }, summary: `Archived ${n} low-significance draft${n === 1 ? '' : 's'}.` };
    },
  },

  'drafts.archive_stale': {
    key: 'drafts.archive_stale',
    label: 'Archive drafts older than the stale cutoff',
    tier: 'propose', costsModel: false, reversible: true, createsRun: false,
    run: async (args) => {
      const staleDays = typeof args.staleDays === 'number' && Number.isFinite(args.staleDays) ? args.staleDays : 45;
      const n = await m.archiveDraftsBulk('stale', staleDays);
      return { ok: true, result: { archived: n }, summary: `Archived ${n} draft${n === 1 ? '' : 's'} older than ${staleDays} days.` };
    },
  },

  'engine.kick': {
    key: 'engine.kick',
    label: "Start today's run",
    tier: 'propose', costsModel: false, reversible: false, createsRun: true,
    run: async (args) => {
      if (!isJobKey(args.job)) return { ok: false, error: 'Unknown job.', summary: 'Unknown job.' };
      const job = args.job;
      const runId = await getOrCreateRunId(job);
      if (!(await CLAIMERS[job](runId))) {
        return { ok: false, error: 'Run is busy.', summary: `The ${job} run is already in progress elsewhere.` };
      }
      const progress = await ADVANCERS[job](runId, Date.now() + 50_000);
      return { ok: true, result: progress, summary: `Started the ${job} run; ${progress.done ? 'already complete.' : 'in progress.'}` };
    },
  },

  'engine.enable': {
    key: 'engine.enable',
    label: 'Turn the engine back on',
    tier: 'propose', costsModel: false, reversible: true, createsRun: false,
    run: async (args) => {
      if (!isJobKey(args.job)) return { ok: false, error: 'Unknown job.', summary: 'Unknown job.' };
      await setJobEnabled(args.job);
      return { ok: true, result: { job: args.job }, summary: `Turned ${args.job} back on.` };
    },
  },

  'reports.roundup': {
    key: 'reports.roundup',
    label: 'Generate the weekly research roundup',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      // Key the roundup to the Friday the reports.roundup_missing finding asks
      // for, so a weekend tap fills that week instead of a Saturday-keyed one.
      const { value, costUsd } = await measureCost(['roundup_sections', 'roundup_close'], () =>
        runWeeklyRoundup(lastFridayUtc(new Date()))
      );
      if ('skipped' in value) return { ok: true, result: { skipped: value.skipped }, summary: `Skipped: ${value.skipped}.` };
      return { ok: true, result: { reportId: value.reportId, costUsd }, summary: 'Generated the weekly research roundup.' };
    },
  },

  'reports.entrants': {
    key: 'reports.entrants',
    label: "Generate this week's tooling entrants report",
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const monday = mondayUtc(new Date());
      const run = await getToolingRunByKey('weekly', monday);
      if (!run) {
        return { ok: false, error: 'No weekly tooling run for this week yet.', summary: 'No weekly tooling run for this week yet; kick the engine first.' };
      }
      const prefs = await getToolingPrefs();
      const today = new Date().toISOString().slice(0, 10);
      const weekTo = today > run.day ? today : run.day;
      const weekFrom = shiftDayIso(run.day, -6);
      const { value, costUsd } = await measureCost(
        ['tooling_report_sections', 'tooling_report_close'],
        () => runWeeklyEntrantsReport(run.id, weekFrom, weekTo, prefs.auto_publish_entrants)
      );
      if ('skipped' in value) return { ok: true, result: { skipped: value.skipped }, summary: `Skipped: ${value.skipped}.` };
      return { ok: true, result: { reportId: value.reportId, costUsd }, summary: "Generated this week's tooling entrants report." };
    },
  },

  'reports.intel_deck': {
    key: 'reports.intel_deck',
    label: "Generate today's company intel deck",
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const day = new Date().toISOString().slice(0, 10);
      const { value, costUsd } = await measureCost(['intel_deck_sentence'], () => runIntelDeck(day));
      if ('skipped' in value) return { ok: true, result: { skipped: value.skipped }, summary: `Skipped: ${value.skipped}.` };
      return { ok: true, result: { reportId: value.id, companies: value.companies, costUsd }, summary: "Generated today's company intel deck." };
    },
  },

  'editorial.summarize': {
    key: 'editorial.summarize',
    label: 'Summarize this question\'s state',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async (args) => {
      const questionId = String(args.questionId ?? '');
      if (!questionId) return { ok: false, error: 'Missing questionId.', summary: 'Missing questionId.' };
      const input = await getQuestionSummaryInput(questionId);
      if (!input) return { ok: false, error: 'Question not found.', summary: 'Question not found.' };
      const { value: summary, costUsd } = await measureCost(['question_summary'], () => generateQuestionSummary(input));
      await m.createQuestionSummary(questionId, summary, input.metrics);
      return { ok: true, result: { costUsd }, summary: 'Wrote a new state summary for the question.' };
    },
  },

  'gaps.diagnose_argument': {
    key: 'gaps.diagnose_argument',
    label: 'Diagnose gaps in the argument map',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const [{ questions, stances, claims, bridges }, recentReports] = await Promise.all([
        getAllDomainRows(), getRecentReports(2),
      ]);
      const slugByQid = new Map(questions.map((qn) => [qn.id, qn.slug]));
      const nonFrameClaims = claims.filter((c) => !c.is_frame);
      const sinceISO = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const recentSignals = (await getSignals({ publishedOnly: true, since: sinceISO })).slice(0, 40);

      if (!recentReports.length && !recentSignals.length) {
        await m.saveArgumentGapScan(null);
        const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations: [] };
        return { ok: true, result: scan, summary: 'No recent reports or signals to ground on; recommended nothing.' };
      }

      const reportByLabel = new Map<string, { id: string; title: string }>();
      const groundingReports = recentReports.map((r, i) => {
        const label = `R${i + 1}`;
        reportByLabel.set(label, { id: r.id, title: r.title });
        const n = r.data?.narrative;
        const text = htmlToText(
          [n?.macroSurvey, ...(n?.perLens ? Object.values(n.perLens) : []), n?.claimsRecap].filter(Boolean).join(' ')
        );
        return { label, title: r.title, text };
      });
      const signalByLabel = new Map<string, string>();
      const groundingSignals = recentSignals.map((s, i) => {
        const label = `S${i + 1}`;
        signalByLabel.set(label, s.id);
        return { label, title: s.title, summary: s.summary ?? '', touches: s.claim_touches ?? [] };
      });

      const mapContext = {
        questions: questions.map((qn) => ({ slug: qn.slug, sort: qn.sort_order, title: qn.title })),
        stances: stances.map((s) => ({ code: s.code, title: s.title, question_slug: slugByQid.get(s.question_id) ?? '' })),
        claims: nonFrameClaims.map((c) => ({ code: c.code, statement: c.statement, test: c.test, domain: c.domain })),
        bridges: bridges.map((b) => ({ code: b.code, statement: b.statement, domain_from: b.domain_from, domain_to: b.domain_to })),
      };

      const { value: recommendations, costUsd } = await measureCost(['argument_gaps'], async () => {
        const raw = await diagnoseArgumentGaps(mapContext, { reports: groundingReports, signals: groundingSignals });
        return validateGapRecommendations(raw, {
          liveCodes: new Set([...nonFrameClaims, ...bridges].map((t) => t.code)),
          stanceCodes: new Set(stances.map((s) => s.code)),
          bridgeCodes: new Set(bridges.map((b) => b.code)),
          claimCodes: new Set(nonFrameClaims.map((c) => c.code)),
          questionSlugByStance: new Map(stances.map((s) => [s.code, slugByQid.get(s.question_id) ?? ''])),
          liveStatements: [...nonFrameClaims.map((c) => c.statement), ...bridges.map((b) => b.statement)],
          reportByLabel, signalByLabel,
        });
      });

      const scan: ArgumentGapScan = { generatedAt: new Date().toISOString(), recommendations };
      await m.saveArgumentGapScan(scan);
      return {
        ok: true, result: { recommendations: recommendations.length, costUsd },
        summary: `Found ${recommendations.length} argument-map gap recommendation${recommendations.length === 1 ? '' : 's'}.`,
      };
    },
  },

  'gaps.diagnose_concept': {
    key: 'gaps.diagnose_concept',
    label: 'Diagnose gaps in the concept scaffold',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const [{ concepts, edges }, { claims, bridges }] = await Promise.all([getConceptGraph(), getTargets()]);
      const slugById = new Map(concepts.map((c) => [c.id, c.slug]));
      const existing = concepts.map((c) => ({
        slug: c.slug, name: c.name, short_definition: c.short_definition, status: c.status,
        prereq_slugs: edges.filter((e) => e.concept_id === c.id).map((e) => slugById.get(e.prerequisite_id)).filter((s): s is string => !!s),
      }));
      const targets = [...claims, ...bridges].map((t) => ({ code: t.code, statement: t.statement, type: t.type }));

      const { value: recommendations, costUsd } = await measureCost(['concept_gaps'], async () => {
        const raw = await diagnoseConceptGaps(existing, targets);
        const liveSlugs = new Set(concepts.map((c) => c.slug));
        const validCodes = new Set(targets.map((t) => t.code));
        const seen = new Set<string>();
        const out: ConceptGapScan['recommendations'] = [];
        for (const r of raw) {
          const slug = String(r.slug ?? '').toLowerCase().trim();
          const name = String(r.name ?? '').trim().slice(0, 120);
          const short_definition = String(r.short_definition ?? '').trim().slice(0, 500);
          const argument = String(r.argument ?? '').trim().slice(0, 1500);
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) continue;
          if (liveSlugs.has(slug) || seen.has(slug)) continue;
          if (!name || !short_definition || !argument) continue;
          seen.add(slug);
          out.push({
            slug, name, short_definition,
            explanation: String(r.explanation ?? '').trim().slice(0, 4000),
            status: r.status === 'contested' ? 'contested' : 'settled',
            prerequisite_slugs: Array.from(new Set((Array.isArray(r.prerequisite_slugs) ? r.prerequisite_slugs : []).filter((s: string) => liveSlugs.has(s)))),
            claim_codes: Array.from(new Set((Array.isArray(r.claim_codes) ? r.claim_codes : []).filter((c: string) => validCodes.has(c)))),
            argument,
          });
          if (out.length >= 5) break;
        }
        return out;
      });

      const scan: ConceptGapScan = { generatedAt: new Date().toISOString(), recommendations };
      await m.saveConceptGapScan(scan);
      return {
        ok: true, result: { recommendations: recommendations.length, costUsd },
        summary: `Found ${recommendations.length} concept gap recommendation${recommendations.length === 1 ? '' : 's'}.`,
      };
    },
  },

  'research.agent_chunk': {
    key: 'research.agent_chunk',
    label: 'Score the next chunk of the research review queue',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const ids = await getUnrecommendedPaperIds(12);
      if (!ids.length) return { ok: true, result: { processed: 0 }, summary: 'Nothing unrecommended in the review queue.' };
      const { value, costUsd } = await measureCost(['research_agent'], () => recommendQueueChunk(ids));
      return { ok: true, result: { ...value, costUsd }, summary: `Recommended ${value.processed} paper${value.processed === 1 ? '' : 's'} in the review queue.` };
    },
  },

  'scout.score_chunk': {
    key: 'scout.score_chunk',
    label: 'Score the next chunk of the Scout queue',
    tier: 'propose', costsModel: true, reversible: false, createsRun: false,
    run: async () => {
      const rows = await getScoutQueueIds(10);
      if (!rows.length) return { ok: true, result: { processed: 0 }, summary: 'Nothing queued in Scout.' };
      const { value, costUsd } = await measureCost(['scout_agent'], () => scoreScoutChunk(rows.map((r) => r.id)));
      return { ok: true, result: { ...value, costUsd }, summary: `Scored ${value.processed} compan${value.processed === 1 ? 'y' : 'ies'} in the Scout queue.` };
    },
  },

  'tickets.resolve': {
    key: 'tickets.resolve',
    label: 'Mark the ticket resolved',
    tier: 'propose', costsModel: false, reversible: true, createsRun: false,
    run: async (args) => {
      const id = String(args.id ?? '');
      if (!id) return { ok: false, error: 'Missing ticket id.', summary: 'Missing ticket id.' };
      await m.setTicketStatus(id, 'resolved');
      return { ok: true, result: { id }, summary: 'Marked the ticket resolved.' };
    },
  },

  // ---- Never tier: yours alone ------------------------------------------------
  'confidence.move': neverRemedy('confidence.move', 'Moving a confidence'),
  'signals.publish': neverRemedy('signals.publish', 'Publishing a signal'),
  'signals.merge': neverRemedy('signals.merge', 'Merging signals'),
  'anything.delete': neverRemedy('anything.delete', 'Deleting anything'),
};

export function remedyRef(key: string, label: string, args?: Record<string, unknown>): RemedyRef {
  const remedy = REMEDIES[key];
  if (!remedy) throw new Error(`Unknown remedy: ${key}`);
  return { key, args, tier: remedy.tier, label, costsModel: remedy.costsModel };
}

// ---- The guarded executor ----------------------------------------------------
// Every call (auto tick, drawer click, or chat tool) goes through here. Never
// throws: every failure comes back as { ok: false, ... } and is still logged.
export async function executeRemedy(opts: {
  findingKey: string | null;
  remedyKey: string;
  args?: Record<string, unknown>;
  actor: Actor;
  now?: Date;
}): Promise<RemedyResult> {
  const now = opts.now ?? new Date();
  const args = opts.args ?? {};
  const remedy = REMEDIES[opts.remedyKey];

  const refuse = async (error: string, tier: RemedyTier = remedy?.tier ?? 'never'): Promise<RemedyResult> => {
    const result: RemedyResult = { ok: false, error, summary: error };
    await m.logAgentAction({
      finding_id: null, finding_key: opts.findingKey, remedy_key: opts.remedyKey, args,
      tier, actor: opts.actor, ok: false, result: null, error, cost_usd: 0,
    }).catch(() => {});
    return result;
  };

  if (!remedy) return refuse(`Unknown remedy: ${opts.remedyKey}`);
  if (remedy.tier === 'never') return refuse(`${remedy.label} is yours alone.`);
  if (opts.actor === 'agent' && remedy.tier !== 'auto') {
    return refuse('The agent may only run auto-tier remedies on its own.');
  }
  if (remedy.createsRun && isBlackout(now)) {
    return refuse('Refused: creating a run between 00:00 and 09:00 UTC would consume tomorrow\'s run key.');
  }
  if (remedy.costsModel) {
    const budget = await checkAgentBudget();
    if (!budget.ok) {
      return refuse(`Refused: today's agent budget is spent ($${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)}).`);
    }
  }

  const finding = opts.findingKey ? await getFindingByKey(opts.findingKey) : null;
  if (remedy.tier === 'auto' && finding?.last_action_at && hoursSince(finding.last_action_at, now) < 12) {
    return refuse('Refused: this finding\'s auto remedy already ran in the last 12 hours.');
  }

  let result: RemedyResult;
  try {
    result = await remedy.run(args, { actor: opts.actor, now });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Remedy failed.';
    result = { ok: false, error: msg, summary: msg };
  }

  const costUsd = (() => {
    const r = result.result;
    if (r && typeof r === 'object' && 'costUsd' in r) {
      const v = (r as { costUsd?: unknown }).costUsd;
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
    return 0;
  })();

  await m.logAgentAction({
    finding_id: finding?.id ?? null, finding_key: opts.findingKey, remedy_key: opts.remedyKey, args,
    tier: remedy.tier, actor: opts.actor, ok: result.ok, result: result.result ?? null,
    error: result.error ?? null, cost_usd: costUsd,
  }).catch(() => {});

  if (opts.findingKey) {
    const who = opts.actor === 'agent' ? 'Agent' : 'The maintainer';
    const stamp = now.toISOString().slice(11, 16);
    await m.stampFindingAction(opts.findingKey, `${who} ran "${remedy.label}" at ${stamp} UTC: ${result.summary}`).catch(() => {});
  }

  return result;
}
