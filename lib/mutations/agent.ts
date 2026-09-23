import { one, exec, withTx } from '../db';
import { isScanEnrichModel } from '../scan/models';
import { reconcileFindings, type ExistingFindingLite } from '../agent/reconcile';
import {
  DEFAULT_AGENT_MODEL,
  type AgentAction, type AgentPrefs, type BriefMemo, type FindingInput, type FindingState,
} from '../agent/types';

// ---- The Atlas Agent's writers (migration 0056) -----------------------------
// The pure reconciliation decision (insert / reopen / update / resolve) lives
// in lib/agent/reconcile.ts so scripts/test-agent.mjs can exercise it without
// a database; this file is the DB execution of that plan.

// One transaction: locks every row this run either mentions or that is
// currently active (so the "resolve what nobody fired on" pass sees a
// consistent snapshot), plans via reconcileFindings, then writes each bucket.
export async function upsertFindings(
  inputs: FindingInput[],
  now: Date = new Date()
): Promise<{ opened: number; reopened: number; updated: number; resolved: number }> {
  return withTx(async (c) => {
    const keys = Array.from(new Set(inputs.map((i) => i.key)));
    const existingRes = await c.query(
      `select key, state, snoozed_until::text as snoozed_until
         from agent_findings
        where key = any($1::text[]) or state in ('open', 'acked', 'snoozed')`,
      [keys]
    );
    const existing = existingRes.rows as ExistingFindingLite[];
    const plan = reconcileFindings(existing, inputs, now);
    const nowIso = now.toISOString();

    for (const input of plan.insert) {
      await c.query(
        `insert into agent_findings
           (key, check_key, subject, severity, title, detail, metric, href, remedy, state, first_seen, last_seen)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, 'open', $10::timestamptz, $10::timestamptz)`,
        [
          input.key, input.checkKey, input.subject ?? null, input.severity, input.title, input.detail,
          JSON.stringify(input.metric ?? {}), input.href ?? null,
          input.remedy ? JSON.stringify(input.remedy) : null, nowIso,
        ]
      );
    }

    for (const input of plan.reopen) {
      await c.query(
        `update agent_findings set
           check_key = $2, subject = $3, severity = $4, title = $5, detail = $6,
           metric = $7::jsonb, href = $8, remedy = $9::jsonb,
           state = 'open', resolved_at = null, seen_at = null,
           first_seen = $10::timestamptz, last_seen = $10::timestamptz
         where key = $1`,
        [
          input.key, input.checkKey, input.subject ?? null, input.severity, input.title, input.detail,
          JSON.stringify(input.metric ?? {}), input.href ?? null,
          input.remedy ? JSON.stringify(input.remedy) : null, nowIso,
        ]
      );
    }

    for (const { input, unsnooze } of plan.update) {
      await c.query(
        `update agent_findings set
           check_key = $2, subject = $3, severity = $4, title = $5, detail = $6,
           metric = $7::jsonb, href = $8, remedy = $9::jsonb, last_seen = $10::timestamptz
           ${unsnooze ? `, state = 'open', snoozed_until = null` : ''}
         where key = $1`,
        [
          input.key, input.checkKey, input.subject ?? null, input.severity, input.title, input.detail,
          JSON.stringify(input.metric ?? {}), input.href ?? null,
          input.remedy ? JSON.stringify(input.remedy) : null, nowIso,
        ]
      );
    }

    if (plan.resolveKeys.length) {
      await c.query(
        `update agent_findings set state = 'resolved', resolved_at = $2::timestamptz
          where state in ('open', 'acked', 'snoozed') and key = any($1::text[])`,
        [plan.resolveKeys, nowIso]
      );
    }

    return {
      opened: plan.insert.length,
      reopened: plan.reopen.length,
      updated: plan.update.length,
      resolved: plan.resolveKeys.length,
    };
  });
}

export async function setFindingState(
  key: string,
  state: FindingState,
  opts: { snoozeDays?: number } = {}
): Promise<void> {
  if (state === 'snoozed') {
    const days = Math.max(1, Math.min(90, Math.floor(opts.snoozeDays ?? 3)));
    await exec(
      `update agent_findings
          set state = 'snoozed', snoozed_until = now() + ($2::int * interval '1 day'), acked_at = null
        where key = $1`,
      [key, days]
    );
  } else if (state === 'acked') {
    await exec(`update agent_findings set state = 'acked', acked_at = now() where key = $1`, [key]);
  } else if (state === 'open') {
    await exec(
      `update agent_findings set state = 'open', snoozed_until = null, acked_at = null, resolved_at = null where key = $1`,
      [key]
    );
  } else {
    await exec(`update agent_findings set state = 'resolved', resolved_at = now() where key = $1`, [key]);
  }
}

export async function markFindingsSeen(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await exec(
    `update agent_findings set seen_at = now() where key = any($1::text[]) and seen_at is null`,
    [keys]
  );
}

// Appends one line to a finding's detail (capped so the card never grows
// unbounded across repeated auto runs) and stamps the cooldown anchor.
export async function stampFindingAction(key: string, line: string): Promise<void> {
  await exec(
    `update agent_findings
        set last_action_at = now(),
            detail = left(coalesce(detail, '') || E'\n' || $2, 1200)
      where key = $1`,
    [key, line]
  );
}

export async function logAgentAction(input: Omit<AgentAction, 'id' | 'created_at'>): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into agent_actions
       (finding_id, finding_key, remedy_key, args, tier, actor, ok, result, error, cost_usd)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10)
     returning id`,
    [
      input.finding_id, input.finding_key, input.remedy_key, JSON.stringify(input.args ?? {}),
      input.tier, input.actor, input.ok, JSON.stringify(input.result ?? null), input.error ?? null,
      input.cost_usd ?? 0,
    ]
  );
  return row!.id;
}

export async function saveBrief(
  day: string,
  memo: BriefMemo,
  findingsSnapshot: unknown,
  actionsSnapshot: unknown,
  model: string
): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into agent_briefs (day, memo, findings_snapshot, actions_snapshot, model)
     values ($1::date, $2::jsonb, $3::jsonb, $4::jsonb, $5)
     on conflict (day) do update set
       memo = excluded.memo, findings_snapshot = excluded.findings_snapshot,
       actions_snapshot = excluded.actions_snapshot, model = excluded.model
     returning id`,
    [day, JSON.stringify(memo), JSON.stringify(findingsSnapshot ?? null), JSON.stringify(actionsSnapshot ?? null), model]
  );
  return row!.id;
}

export async function markBriefEmailed(id: string): Promise<void> {
  await exec(`update agent_briefs set emailed_at = now() where id = $1`, [id]);
}

function validAgentModel(id: string | undefined, fallback: string): string {
  if (id === undefined) return fallback;
  const v = id.trim();
  if (!v) return fallback;
  return v.startsWith('claude-') || isScanEnrichModel(v) ? v : fallback;
}

export async function saveAgentPrefs(patch: Partial<AgentPrefs>): Promise<void> {
  const current = await one<{
    enabled: boolean; auto_enabled: boolean; chat_model: string; brief_model: string;
    steering: string; email_to: string | null;
  }>(
    `select enabled, auto_enabled, chat_model, brief_model, steering, email_to from agent_prefs where id = true`
  );

  const next = {
    enabled: patch.enabled ?? current?.enabled ?? true,
    auto_enabled: patch.auto_enabled ?? current?.auto_enabled ?? true,
    chat_model: validAgentModel(patch.chat_model, current?.chat_model ?? DEFAULT_AGENT_MODEL),
    brief_model: validAgentModel(patch.brief_model, current?.brief_model ?? DEFAULT_AGENT_MODEL),
    steering: patch.steering !== undefined ? patch.steering.slice(0, 2000) : current?.steering ?? '',
    email_to: patch.email_to !== undefined ? (patch.email_to?.trim() || null) : current?.email_to ?? null,
  };

  await exec(
    `insert into agent_prefs (id, enabled, auto_enabled, chat_model, brief_model, steering, email_to)
     values (true, $1, $2, $3, $4, $5, $6)
     on conflict (id) do update set
       enabled = excluded.enabled, auto_enabled = excluded.auto_enabled,
       chat_model = excluded.chat_model, brief_model = excluded.brief_model,
       steering = excluded.steering, email_to = excluded.email_to, updated_at = now()`,
    [next.enabled, next.auto_enabled, next.chat_model, next.brief_model, next.steering, next.email_to]
  );
}
