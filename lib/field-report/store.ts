import { exec, one, q } from '../db';
import type { FieldReportPlan, FieldReportSize } from './core';

// Field Report's database layer (mig 0079): the settings singleton, today's
// spend for the keyholder caps, and the run rows whose `legs` park each
// finished leg so a run resumes after a deadline. Server-only.

export type Role = 'research' | 'writer' | 'editor' | 'figures';
export interface FieldReportPrefs {
  enabled: boolean;
  models: Record<FieldReportSize, Record<Role, string>>;
  effort: Record<FieldReportSize, 'low' | 'medium' | 'high'>;
  webSearches: Record<FieldReportSize, number>;
  keyDailyUsd: number;
  allKeysDailyUsd: number;
}

const DEFAULT_MODELS: Record<FieldReportSize, Record<Role, string>> = {
  brief: { research: 'claude-sonnet-5', writer: 'claude-sonnet-5', editor: 'claude-sonnet-5', figures: 'claude-sonnet-5' },
  full: { research: 'claude-sonnet-5', writer: 'claude-opus-5-5', editor: 'claude-sonnet-5', figures: 'claude-sonnet-5' },
};

export async function getFieldReportPrefs(): Promise<FieldReportPrefs> {
  const r = await one<{
    enabled: boolean; models: Partial<Record<FieldReportSize, Partial<Record<Role, string>>>>;
    effort: Partial<Record<FieldReportSize, string>>; web_searches: Partial<Record<FieldReportSize, number>>;
    key_daily_usd: number; all_keys_daily_usd: number;
  }>(`select enabled, models, effort, web_searches, key_daily_usd::float, all_keys_daily_usd::float from field_report_prefs where id`);
  const eff = (v: unknown, d: 'low' | 'medium' | 'high') => (v === 'low' || v === 'medium' || v === 'high' ? v : d);
  return {
    enabled: r?.enabled ?? true,
    models: {
      brief: { ...DEFAULT_MODELS.brief, ...(r?.models?.brief ?? {}) },
      full: { ...DEFAULT_MODELS.full, ...(r?.models?.full ?? {}) },
    },
    effort: { brief: eff(r?.effort?.brief, 'medium'), full: eff(r?.effort?.full, 'high') },
    webSearches: {
      brief: Math.max(0, Math.min(10, Number(r?.web_searches?.brief ?? 4))),
      full: Math.max(0, Math.min(25, Number(r?.web_searches?.full ?? 12))),
    },
    keyDailyUsd: Number(r?.key_daily_usd ?? 5),
    allKeysDailyUsd: Number(r?.all_keys_daily_usd ?? 20),
  };
}

// The desk's settings save (app/field-reports/desk/page.tsx via
// lib/actions/field-reports.ts saveFieldReportPrefsAction, which validates
// every field before this ever runs).
export async function saveFieldReportPrefs(input: FieldReportPrefs): Promise<void> {
  await exec(
    `update field_report_prefs
        set enabled = $1, models = $2::jsonb, effort = $3::jsonb, web_searches = $4::jsonb,
            key_daily_usd = $5, all_keys_daily_usd = $6
      where id`,
    [input.enabled, JSON.stringify(input.models), JSON.stringify(input.effort), JSON.stringify(input.webSearches), input.keyDailyUsd, input.allKeysDailyUsd]
  );
}

// ---- caps (keyholders only; admin is uncapped) --------------------------------------
const TODAY = `created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
export async function fieldReportSpendToday(keyId: string | null): Promise<{ key: number; allKeys: number }> {
  const r = await one<{ key: number; all_keys: number }>(
    `select coalesce(sum(cost_usd) filter (where metadata->>'portal_key_id' = $1), 0)::float as key,
            coalesce(sum(cost_usd) filter (where metadata ? 'portal_key_id'), 0)::float as all_keys
       from ai_cost_log where feature like 'field\\_report\\_%' and ${TODAY}`,
    [keyId ?? '']
  );
  return { key: r?.key ?? 0, allKeys: r?.all_keys ?? 0 };
}

// ---- runs ---------------------------------------------------------------------------
export interface FieldReportRunRow {
  id: string;
  created_by: string;
  question: string;
  plan: FieldReportPlan;
  size: FieldReportSize;
  status: 'planned' | 'running' | 'paused' | 'done' | 'failed';
  legs: Record<string, unknown>;
  report_id: string | null;
  job_id: string | null;
  error: string | null;
  cost_usd: number;
}

export async function createRun(input: { id: string; createdBy: string; question: string; plan: FieldReportPlan }): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into field_report_runs (id, created_by, question, plan) values ($1, $2, $3, $4::jsonb) returning id`,
    [input.id, input.createdBy, input.question, JSON.stringify(input.plan)]
  );
  return r!.id;
}

export async function getRun(id: string): Promise<FieldReportRunRow | null> {
  return one<FieldReportRunRow>(
    `select id, created_by, question, plan, size, status, legs, report_id, job_id, error, cost_usd::float from field_report_runs where id = $1`,
    [id]
  );
}

export async function updateRunPlan(id: string, plan: FieldReportPlan): Promise<void> {
  await exec(`update field_report_runs set plan = $2::jsonb where id = $1 and status = 'planned'`, [id, JSON.stringify(plan)]);
}

// Claims the run for a start or a resume: only a planned, paused or failed run
// can be claimed, so two tabs cannot run the same report twice.
export async function claimRun(id: string, fields: { plan?: FieldReportPlan; size?: FieldReportSize; jobId: string }): Promise<boolean> {
  const r = await one<{ id: string }>(
    `update field_report_runs
        set status = 'running', error = null, job_id = $4,
            plan = coalesce($2::jsonb, plan), size = coalesce($3, size)
      where id = $1 and status in ('planned', 'paused', 'failed')
      returning id`,
    [id, fields.plan ? JSON.stringify(fields.plan) : null, fields.size ?? null, fields.jobId]
  );
  return Boolean(r);
}

export async function parkLeg(id: string, key: string, value: unknown): Promise<void> {
  await exec(`update field_report_runs set legs = jsonb_set(legs, $2::text[], $3::jsonb, true) where id = $1`,
    [id, [key], JSON.stringify(value)]);
}

export async function setRunStatus(id: string, status: FieldReportRunRow['status'], extra: { error?: string | null; reportId?: string | null } = {}): Promise<void> {
  await exec(
    `update field_report_runs
        set status = $2, error = $3, report_id = coalesce($4::uuid, report_id),
            cost_usd = (select coalesce(sum(cost_usd), 0) from ai_cost_log where metadata->>'field_report_run' = $1::text)
      where id = $1`,
    [id, status, extra.error ?? null, extra.reportId ?? null]
  );
}

export async function runCostUsd(id: string): Promise<number> {
  const r = await one<{ usd: number }>(`select coalesce(sum(cost_usd), 0)::float as usd from ai_cost_log where metadata->>'field_report_run' = $1`, [id]);
  return r?.usd ?? 0;
}

export async function getModelRates(models: string[]): Promise<Map<string, { input: number; output: number }>> {
  const rows = await q<{ model: string; input: number; output: number }>(
    `select model, input_per_mtok::float as input, output_per_mtok::float as output
       from ai_rate_cards where model = any($1)`,
    [models]
  ).catch(() => [] as { model: string; input: number; output: number }[]);
  return new Map(rows.map((r) => [r.model, { input: r.input, output: r.output }]));
}
