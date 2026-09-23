import { one } from '../../db';
import {
  getPipelinePrefs, getDraftBacklogStats, getDedupeScan, getToolingHealth, getToolingNavCount,
  getTickets, listGeneratedReports, getArgumentGapScan, getConceptGapScan, getRuns,
} from '../../data';
import { remedyRef } from '../remedies';
import { daysSince } from '../time';
import type { AgentCheck, FindingInput, Severity } from '../types';

// Queue checks (the plan's Queues table): drafts, tooling, Scout, research
// review, tickets, unpublished reports, stale gap recommendations, and the
// pipeline's own coverage-miss advisory. A check that throws is caught and
// recorded by runChecks, so one bad check never blocks the others and a
// failed check keeps its existing findings.

async function oldestActiveDraftDays(): Promise<number> {
  const row = await one<{ d: number | null }>(
    `select extract(epoch from (now() - min(created_at))) / 86400 as d
       from signals where is_published = false and archived_at is null`
  );
  return row?.d ?? 0;
}

const draftsBacklog: AgentCheck = {
  key: 'drafts.backlog',
  title: 'Draft backlog',
  domain: 'queues',
  run: async () => {
    const prefs = await getPipelinePrefs();
    const stats = await getDraftBacklogStats({ afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from });
    if (stats.active === 0) return [];
    const oldestDays = Math.floor(await oldestActiveDraftDays());
    const high = stats.active > 100 || oldestDays > 14;
    const warn = stats.active > 40 || oldestDays > 7;
    if (!high && !warn) return [];
    const severity: Severity = high ? 'high' : 'warn';
    return [{
      key: 'drafts.backlog',
      checkKey: 'drafts.backlog',
      severity,
      title: `Draft backlog: ${stats.active} active, oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}`,
      detail: `${stats.active} unpublished draft${stats.active === 1 ? '' : 's'} are sitting in the active queue, the oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'} old. ${stats.noTouches} touch no claim and would clear in a sprint.`,
      metric: { active: stats.active, oldestDays, noTouches: stats.noTouches, low: stats.low },
      href: '/signals/drafts',
      remedy: stats.noTouches > 0
        ? remedyRef('drafts.archive_no_touches', `Archive drafts with no claim touches (${stats.noTouches})`)
        : (stats.low > 0 ? remedyRef('drafts.archive_low', `Archive low-significance drafts (${stats.low})`) : null),
    }];
  },
};

const draftsPromotionDue: AgentCheck = {
  key: 'drafts.promotion_due',
  title: 'Drafts due for promotion',
  domain: 'queues',
  run: async () => {
    const prefs = await getPipelinePrefs();
    const stats = await getDraftBacklogStats({ afterHours: prefs.auto_publish_after_hours, from: prefs.auto_publish_from });
    if (stats.dueForPromotion === 0) return [];
    return [{
      key: 'drafts.promotion_due',
      checkKey: 'drafts.promotion_due',
      severity: 'warn',
      title: `${stats.dueForPromotion} draft${stats.dueForPromotion === 1 ? '' : 's'} due for promotion`,
      detail: prefs.auto_publish_high
        ? `${stats.dueForPromotion} high-significance draft(s) with a claim touch are past the veto window; the promotion policy is on, this is the safety net in case a cron window skipped them.`
        : `${stats.dueForPromotion} high-significance draft(s) with a claim touch are past the veto window, but the auto-publish policy is off, so nothing publishes them on its own.`,
      metric: { dueForPromotion: stats.dueForPromotion, policyOn: prefs.auto_publish_high },
      href: '/signals/drafts',
      remedy: remedyRef('signals.promote_due', `Publish ${stats.dueForPromotion} due draft(s)`),
    }];
  },
};

const draftsDedupePending: AgentCheck = {
  key: 'drafts.dedupe_pending',
  title: 'Dedupe review pending',
  domain: 'queues',
  run: async (ctx) => {
    const rec = await getDedupeScan();
    if (!rec || !rec.groups.length) return [];
    const days = Math.floor(daysSince(rec.generated_at, ctx.now));
    if (days <= 3) return [];
    return [{
      key: 'drafts.dedupe_pending',
      checkKey: 'drafts.dedupe_pending',
      severity: 'warn',
      title: `${rec.groups.length} duplicate group${rec.groups.length === 1 ? '' : 's'} awaiting review, ${days} days old`,
      detail: `The last dedupe scan found ${rec.groups.length} duplicate group(s) among the drafts and nobody has reviewed it in ${days} days. Merge or discard on the draft review sprint.`,
      metric: { groups: rec.groups.length, days },
      href: '/signals/drafts',
      remedy: null,
    }];
  },
};

const toolingHeld: AgentCheck = {
  key: 'tooling.held',
  title: 'Tooling review backlog',
  domain: 'queues',
  run: async () => {
    const [health, unreviewed] = await Promise.all([getToolingHealth(8), getToolingNavCount()]);
    const held = health.products.parked;
    if (held <= 60 && unreviewed <= 10) return [];
    return [{
      key: 'tooling.held',
      checkKey: 'tooling.held',
      severity: 'warn',
      title: `Tooling review: ${held} parked, ${unreviewed} unreviewed`,
      detail: `${held} products are parked below the catalog threshold and ${unreviewed} newly-cataloged products from the last week have no admin review yet. Work the queue on the tooling console.`,
      metric: { parked: held, unreviewed },
      href: '/tooling/console',
      remedy: null,
    }];
  },
};

async function scoutQueueStats(): Promise<{ count: number; oldestDays: number | null }> {
  const row = await one<{ n: number; oldest_h: number | null }>(
    `select count(*)::int as n, extract(epoch from (now() - min(created_at))) / 3600 as oldest_h
       from companies where status = 'queued'`
  );
  return { count: row?.n ?? 0, oldestDays: row?.oldest_h != null ? row.oldest_h / 24 : null };
}

const scoutQueue: AgentCheck = {
  key: 'scout.queue',
  title: 'Scout queue',
  domain: 'queues',
  run: async () => {
    const { count, oldestDays } = await scoutQueueStats();
    const oldest = oldestDays != null ? Math.floor(oldestDays) : 0;
    if (count <= 20 && oldest <= 14) return [];
    return [{
      key: 'scout.queue',
      checkKey: 'scout.queue',
      severity: 'warn',
      title: `Scout queue: ${count} companies, oldest ${oldest} day${oldest === 1 ? '' : 's'}`,
      detail: `${count} companies are queued for a verdict, the oldest ${oldest} day${oldest === 1 ? '' : 's'}. The agent scoring chunk can take a pass, or work the queue on the Scout console.`,
      metric: { count, oldestDays: oldest },
      href: '/scout/console',
      remedy: remedyRef('scout.score_chunk', 'Score the next chunk of the Scout queue'),
    }];
  },
};

async function researchReviewStats(): Promise<{ count: number; oldestDays: number | null }> {
  const row = await one<{ n: number; oldest_h: number | null }>(
    `select count(*)::int as n, extract(epoch from (now() - min(created_at))) / 3600 as oldest_h
       from papers where triage_status = 'kept' and review_status = 'pending'`
  );
  return { count: row?.n ?? 0, oldestDays: row?.oldest_h != null ? row.oldest_h / 24 : null };
}

const researchReview: AgentCheck = {
  key: 'research.review',
  title: 'Research review queue',
  domain: 'queues',
  run: async () => {
    const { count, oldestDays } = await researchReviewStats();
    const oldest = oldestDays != null ? Math.floor(oldestDays) : 0;
    if (count <= 30 && oldest <= 14) return [];
    return [{
      key: 'research.review',
      checkKey: 'research.review',
      severity: 'warn',
      title: `Research review queue: ${count} papers, oldest ${oldest} day${oldest === 1 ? '' : 's'}`,
      detail: `${count} kept papers are waiting on a track/note/dismiss decision, the oldest ${oldest} day${oldest === 1 ? '' : 's'}. The queue agent can recommend the next chunk, or work it on the research console.`,
      metric: { count, oldestDays: oldest },
      href: '/research/console',
      remedy: remedyRef('research.agent_chunk', 'Recommend the next chunk of the review queue'),
    }];
  },
};

const ticketsOpen: AgentCheck = {
  key: 'tickets.open',
  title: 'Open tickets',
  domain: 'queues',
  run: async (ctx) => {
    const open = await getTickets({ status: 'open' });
    if (!open.length) return [];
    const oldest = open[open.length - 1]; // ordered newest-first
    const oldestDays = Math.floor(daysSince(oldest.created_at, ctx.now));
    const urgentBug = open.find((t) => t.kind === 'bug' && t.severity === 'blocking' && daysSince(t.created_at, ctx.now) > 2);
    if (oldestDays <= 7 && !urgentBug) return [];
    const severity: Severity = urgentBug ? 'high' : 'warn';
    return [{
      key: 'tickets.open',
      checkKey: 'tickets.open',
      severity,
      title: `${open.length} open ticket${open.length === 1 ? '' : 's'}, oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}`,
      detail: urgentBug
        ? `A blocking bug ticket has sat open for over 2 days ("${urgentBug.title}"). ${open.length} ticket(s) are open in total.`
        : `${open.length} ticket(s) are open, the oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}. Triage them on the tickets desk.`,
      metric: { open: open.length, oldestDays },
      href: '/tickets',
      remedy: null,
    }];
  },
};

const reportsUnpublished: AgentCheck = {
  key: 'reports.unpublished',
  title: 'Unpublished reports',
  domain: 'queues',
  run: async (ctx) => {
    const all = await listGeneratedReports(false);
    const drafts = all.filter((r) => !r.is_published);
    if (!drafts.length) return [];
    const oldest = drafts.reduce((a, b) => (a.generated_at < b.generated_at ? a : b));
    const oldestDays = Math.floor(daysSince(oldest.generated_at, ctx.now));
    if (oldestDays <= 7) return [];
    return [{
      key: 'reports.unpublished',
      checkKey: 'reports.unpublished',
      severity: 'warn',
      title: `${drafts.length} unpublished report${drafts.length === 1 ? '' : 's'}, oldest ${oldestDays} days`,
      detail: `${drafts.length} generated report(s) are still drafts, the oldest ${oldestDays} days old ("${oldest.title}"). Publish or discard them on the Report Portal.`,
      metric: { drafts: drafts.length, oldestDays },
      href: '/reports',
      remedy: null,
    }];
  },
};

async function thesisGapScanStats(days: number, now: Date): Promise<{ id: string; statement: string; generatedAt: string }[]> {
  const rows = await one<{ rows: { id: string; statement: string; generated_at: string }[] }>(
    `select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'statement', statement, 'generated_at', gap_scan->>'generatedAt')), '[]'::jsonb) as rows
       from theses
      where gap_scan is not null and coalesce(jsonb_array_length(gap_scan->'recommendations'), 0) > 0`
  );
  return (rows?.rows ?? [])
    .filter((r) => r.generated_at && daysSince(r.generated_at, now) > days)
    .map((r) => ({ id: r.id, statement: r.statement, generatedAt: r.generated_at }));
}

const gapsStaleRecs: AgentCheck = {
  key: 'gaps.stale_recs',
  title: 'Stale gap recommendations',
  domain: 'queues',
  run: async (ctx) => {
    const findings: FindingInput[] = [];
    const [argScan, conceptScan, staleTheses] = await Promise.all([
      getArgumentGapScan(), getConceptGapScan(), thesisGapScanStats(14, ctx.now),
    ]);
    if (argScan && argScan.recommendations.length && daysSince(argScan.generatedAt, ctx.now) > 14) {
      findings.push({
        key: 'gaps.stale_recs:argument', checkKey: 'gaps.stale_recs', subject: 'argument', severity: 'info',
        title: `${argScan.recommendations.length} argument-map gap recommendation(s) sitting unreviewed`,
        detail: `The last argument-map gap scan is over 14 days old and still has ${argScan.recommendations.length} open recommendation(s). Review them on the map, or re-run the diagnosis.`,
        metric: { count: argScan.recommendations.length }, href: '/map',
        remedy: remedyRef('gaps.diagnose_argument', 'Re-run the argument-map gap diagnosis'),
      });
    }
    if (conceptScan && conceptScan.recommendations.length && daysSince(conceptScan.generatedAt, ctx.now) > 14) {
      findings.push({
        key: 'gaps.stale_recs:concept', checkKey: 'gaps.stale_recs', subject: 'concept', severity: 'info',
        title: `${conceptScan.recommendations.length} concept gap recommendation(s) sitting unreviewed`,
        detail: `The last concept gap scan is over 14 days old and still has ${conceptScan.recommendations.length} open recommendation(s). Review them on /concepts, or re-run the diagnosis.`,
        metric: { count: conceptScan.recommendations.length }, href: '/concepts',
        remedy: remedyRef('gaps.diagnose_concept', 'Re-run the concept gap diagnosis'),
      });
    }
    for (const t of staleTheses.slice(0, 5)) {
      findings.push({
        key: `gaps.stale_recs:thesis:${t.id}`, checkKey: 'gaps.stale_recs', subject: t.id, severity: 'info',
        title: `Thesis gap recommendations over 14 days old`,
        detail: `"${t.statement}" has an unreviewed gap scan from over 14 days ago. Review it on the thesis workflow page.`,
        metric: {}, href: `/theses/${t.id}`, remedy: null,
      });
    }
    return findings;
  },
};

const pipelineCoverageMisses: AgentCheck = {
  key: 'pipeline.coverage_misses',
  title: 'Pipeline coverage misses',
  domain: 'queues',
  run: async () => {
    const runs = await getRuns(1);
    const run = runs.find((r) => r.status === 'completed' && r.coverage);
    if (!run?.coverage) return [];
    const misses = run.coverage.developments.filter((d) => !d.covered);
    if (!misses.length) return [];
    return [{
      key: 'pipeline.coverage_misses',
      checkKey: 'pipeline.coverage_misses',
      severity: 'info',
      title: `${misses.length} possible coverage miss(es) from the last run`,
      detail: `The last completed run's coverage check flagged ${misses.length} development(s) it could not match to a candidate or existing signal: ${misses.slice(0, 3).map((m) => m.headline).join('; ')}${misses.length > 3 ? '…' : ''}.`,
      metric: { misses: misses.length },
      href: '/pipeline',
      remedy: null,
    }];
  },
};

export const QUEUE_CHECKS: AgentCheck[] = [
  draftsBacklog,
  draftsPromotionDue,
  draftsDedupePending,
  toolingHeld,
  scoutQueue,
  researchReview,
  ticketsOpen,
  reportsUnpublished,
  gapsStaleRecs,
  pipelineCoverageMisses,
];
