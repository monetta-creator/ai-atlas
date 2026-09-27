import { cache } from 'react';
import { one, q } from '../db';
import {
  canSeeJob, jobFromEngineRun, withStaleRule,
  type EngineName, type FeatureStats, type JobStep, type UiJob,
} from '../jobs/core';

// ---- The model-run registry (migration 0072) -------------------------------
// Reads for the run panel, the rail indicator and the completion toasts.
// Visibility is the caller's: pass the viewer and the reads filter with
// canSeeJob (admin sees every job; a keyholder only the jobs they started).

export interface JobViewer { admin: boolean; keyId: string | null }

const JOB_COLS = `id::text as id, kind, subject, label, status, steps,
  to_char(started_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
  to_char(finished_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as finished_at,
  result_href, error, actor, cost_usd::float8 as cost_usd,
  to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at`;

interface JobRow {
  id: string; kind: string; subject: string | null; label: string; status: UiJob['status']; steps: JobStep[];
  started_at: string | null; finished_at: string | null; result_href: string | null; error: string | null;
  actor: string; cost_usd: number | null; created_at: string; updated_at: string;
}

function toJob(r: JobRow): UiJob {
  return withStaleRule({
    id: r.id, kind: r.kind, subject: r.subject, label: r.label, status: r.status, steps: r.steps ?? [],
    startedAt: r.started_at, finishedAt: r.finished_at, resultHref: r.result_href, error: r.error,
    actor: r.actor, costUsd: r.cost_usd == null ? null : Number(r.cost_usd), createdAt: r.created_at, updatedAt: r.updated_at,
  }, Date.now());
}

function actorClause(viewer: JobViewer, param: number): { sql: string; value: string | null } {
  if (viewer.admin) return { sql: 'true', value: null };
  return { sql: `actor = $${param}`, value: viewer.keyId ? `key:${viewer.keyId}` : '__nobody__' };
}

export async function getUiJob(id: string, viewer: JobViewer): Promise<UiJob | null> {
  const r = await one<JobRow>(`select ${JOB_COLS} from ui_jobs where id = $1`, [id]);
  if (!r || !canSeeJob(r.actor, viewer)) return null;
  return toJob(r);
}

// The newest job for a (kind, subject): the panel resumes from it when its
// page is opened again mid-run, or shows how the last run ended.
export async function getLatestJobFor(kind: string, subject: string | null, viewer: JobViewer): Promise<UiJob | null> {
  const r = await one<JobRow>(
    `select ${JOB_COLS} from ui_jobs
      where kind = $1 and subject is not distinct from $2
      order by created_at desc limit 1`,
    [kind, subject]
  );
  if (!r || !canSeeJob(r.actor, viewer)) return null;
  return toJob(r);
}

// Engines that hold their lease right now are working this minute: they show
// as synthetic running jobs (admin only).
async function activeEngineJobs(): Promise<UiJob[]> {
  const rows = await q<{ engine: EngineName; id: string; day: string | null; step: string | null; started_at: string | null; updated_at: string | null }>(
    `select 'scan' as engine, id::text as id, day::text as day, step::text as step,
            to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as started_at,
            to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
       from scan_runs where status = 'running' and lease_until > now()
     union all
     select 'intel', id::text, day::text, step::text,
            to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       from intel_runs where status = 'running' and lease_until > now()
     union all
     select 'research', id::text, day::text, step::text,
            to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       from research_runs where status = 'running' and lease_until > now()
     union all
     select 'pipeline', id::text, null, step::text,
            to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       from pipeline_runs where status = 'running' and lease_until > now()
     union all
     select 'tooling', id::text, day::text, step::text,
            to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            to_char(updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       from tooling_runs where status = 'running' and lease_until > now()`
  ).catch(() => []);
  return rows.map((r) => jobFromEngineRun(r.engine, r));
}

// What the rail shows: every running job the viewer may see (stale rows read
// as failed and drop out), plus, for the admin, the engines at work.
export async function getActiveUiJobs(viewer: JobViewer): Promise<UiJob[]> {
  const a = actorClause(viewer, 1);
  const rows = await q<JobRow>(
    `select ${JOB_COLS} from ui_jobs
      where status in ('queued', 'running') and ${a.sql}
      order by created_at desc limit 20`,
    a.value ? [a.value] : []
  );
  const jobs = rows.map(toJob).filter((j) => j.status === 'running' || j.status === 'queued');
  if (viewer.admin) {
    // An engine run a console is driving is already a registered job (kind
    // engine:<name>, subject = the run id): skip its synthetic twin.
    const driven = new Set(jobs.filter((j) => j.kind.startsWith('engine:')).map((j) => `${j.kind}:${j.subject}`));
    jobs.push(...(await activeEngineJobs()).filter((e) => !driven.has(`${e.kind}:${e.subject}`)));
  }
  return jobs;
}

// Jobs that finished (or went stale) since a moment: the toast source.
export async function getRecentFinishedJobs(sinceIso: string, viewer: JobViewer): Promise<UiJob[]> {
  const a = actorClause(viewer, 2);
  const rows = await q<JobRow>(
    `select ${JOB_COLS} from ui_jobs
      where ((finished_at >= $1::timestamptz)
          or (status = 'running' and updated_at < now() - interval '10 minutes'
              and updated_at >= $1::timestamptz - interval '10 minutes'))
        and ${a.sql}
      order by coalesce(finished_at, updated_at) desc limit 10`,
    a.value ? [sinceIso, a.value] : [sinceIso]
  );
  return rows.map(toJob).filter((j) => j.status === 'done' || j.status === 'failed');
}

export async function getRecentJobs(limit: number, viewer: JobViewer): Promise<UiJob[]> {
  const a = actorClause(viewer, 2);
  const rows = await q<JobRow>(
    `select ${JOB_COLS} from ui_jobs where ${a.sql} order by created_at desc limit $1`,
    a.value ? [limit, a.value] : [limit]
  );
  return rows.map(toJob);
}

// ---- Typical time and cost per feature -------------------------------------
// Medians of wall time and cost per ai_cost_log feature over the last 180
// days (report features run a few times a month, so a short window has no
// history for them): the run panel's "about 2 min, about $0.35". Cached for five minutes
// across requests (the numbers move slowly) and deduped within a request.

let memo: { at: number; value: FeatureStats } | null = null;
const MEMO_MS = 5 * 60_000;

// Also per feature AND leg (`savant_lead:final`), for the features whose
// calls are tagged metadata.leg: a leg is a steadier unit than a call when
// one feature mixes short tool rounds with one long write.
async function readFeatureStats(days: number): Promise<FeatureStats> {
  const rows = await q<{ feature: string; p50_ms: number; p90_ms: number; p50_usd: number; n: number }>(
    `with base as (
       select feature, metadata->>'leg' as leg, wall_ms, cost_usd from ai_cost_log
        where created_at > now() - ($1::int * interval '1 day')
          and wall_ms > 0 and feature is not null
     )
     select feature,
            percentile_cont(0.5) within group (order by wall_ms)::float8 as p50_ms,
            percentile_cont(0.9) within group (order by wall_ms)::float8 as p90_ms,
            percentile_cont(0.5) within group (order by cost_usd)::float8 as p50_usd,
            count(*)::int as n
       from base group by feature
     union all
     select feature || ':' || leg,
            percentile_cont(0.5) within group (order by wall_ms)::float8,
            percentile_cont(0.9) within group (order by wall_ms)::float8,
            percentile_cont(0.5) within group (order by cost_usd)::float8,
            count(*)::int
       from base where leg is not null group by feature, leg`,
    [days]
  );
  const out: FeatureStats = {};
  for (const r of rows) out[r.feature] = { p50Ms: Number(r.p50_ms), p90Ms: Number(r.p90_ms), p50Usd: Number(r.p50_usd), n: r.n };
  return out;
}

export const getFeatureStats = cache(async (days = 180): Promise<FeatureStats> => {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.value;
  const value = await readFeatureStats(days).catch(() => memo?.value ?? {});
  memo = { at: Date.now(), value };
  return value;
});

// The newest job of a kind (optionally for one subject) started within the
// last `withinMin` minutes: a console page passes it to its panel so a run
// that is still going, or just ended, shows again when the reader returns.
export async function getRecentJobOfKind(
  kind: string, viewer: JobViewer, opts: { subject?: string | null; withinMin?: number } = {}
): Promise<UiJob | null> {
  const a = actorClause(viewer, 4);
  const params: unknown[] = [kind, opts.subject ?? null, opts.withinMin ?? 30];
  if (a.value) params.push(a.value);
  const r = await one<JobRow>(
    `select ${JOB_COLS} from ui_jobs
      where kind = $1 and ($2::text is null or subject = $2)
        and created_at > now() - ($3::int * interval '1 minute') and ${a.sql}
      order by created_at desc limit 1`,
    params
  );
  return r ? toJob(r) : null;
}
