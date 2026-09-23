import { cache } from 'react';
import { q, one } from '../db';
import {
  DEFAULT_AGENT_MODEL,
  type AgentAction, type AgentBrief, type AgentFinding, type AgentPrefs, type AgentPulse,
  type FindingState, type Severity, type RemedyRef, type BriefMemo,
} from '../agent/types';

// ---- The Atlas Agent's reads (migration 0056) -------------------------------
// Every table here is admin-only in practice (nothing routes to a guest
// surface); the routes/actions that call these still gate on requireAdmin.

interface RawFindingRow {
  id: string;
  key: string;
  check_key: string;
  subject: string | null;
  severity: string;
  title: string;
  detail: string;
  metric: Record<string, unknown> | null;
  href: string | null;
  remedy: RemedyRef | null;
  state: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  seen_at: string | null;
  acked_at: string | null;
  last_action_at: string | null;
}

const FINDING_COLUMNS = `
  id, key, check_key, subject, severity, title, detail,
  coalesce(metric, '{}'::jsonb) as metric, href, remedy, state,
  first_seen::text as first_seen, last_seen::text as last_seen,
  resolved_at::text as resolved_at, snoozed_until::text as snoozed_until,
  seen_at::text as seen_at, acked_at::text as acked_at, last_action_at::text as last_action_at`;

function mapFinding(r: RawFindingRow): AgentFinding {
  return {
    id: r.id,
    key: r.key,
    checkKey: r.check_key,
    subject: r.subject,
    severity: r.severity as Severity,
    title: r.title,
    detail: r.detail,
    metric: r.metric ?? {},
    href: r.href,
    remedy: r.remedy ?? null,
    state: r.state as FindingState,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    resolved_at: r.resolved_at,
    snoozed_until: r.snoozed_until,
    seen_at: r.seen_at,
    acked_at: r.acked_at,
    last_action_at: r.last_action_at,
  };
}

export async function getAgentPrefs(): Promise<AgentPrefs> {
  const row = await one<{
    enabled: boolean; auto_enabled: boolean; chat_model: string; brief_model: string;
    steering: string; email_to: string | null; updated_at: string | null;
  }>(
    `select enabled, auto_enabled, chat_model, brief_model, steering, email_to,
            updated_at::text as updated_at
       from agent_prefs where id = true`
  );
  return {
    enabled: row?.enabled ?? true,
    auto_enabled: row?.auto_enabled ?? true,
    chat_model: row?.chat_model ?? DEFAULT_AGENT_MODEL,
    brief_model: row?.brief_model ?? DEFAULT_AGENT_MODEL,
    steering: row?.steering ?? '',
    email_to: row?.email_to ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

const SEVERITY_ORDER = `case severity when 'high' then 0 when 'warn' then 1 else 2 end`;

// Default states: open + acked (the drawer's normal view). Snoozed findings
// stay hidden until snoozed_until passes; includeSnoozedDue surfaces those
// that are now due (the runner is what actually flips them back to open).
export async function listFindings(opts: {
  states?: FindingState[]; severity?: Severity[]; includeSnoozedDue?: boolean; limit?: number;
} = {}): Promise<AgentFinding[]> {
  const states = opts.states && opts.states.length ? opts.states : (['open', 'acked'] as FindingState[]);
  const params: unknown[] = [states];
  let where = `state = any($1::text[])`;
  if (opts.includeSnoozedDue) {
    where = `((${where}) or (state = 'snoozed' and snoozed_until <= now()))`;
  }
  if (opts.severity && opts.severity.length) {
    params.push(opts.severity);
    where = `(${where}) and severity = any($${params.length}::text[])`;
  }
  params.push(Math.max(1, Math.min(500, opts.limit ?? 200)));
  const rows = await q<RawFindingRow>(
    `select ${FINDING_COLUMNS} from agent_findings
      where ${where}
      order by ${SEVERITY_ORDER}, last_seen desc
      limit $${params.length}`,
    params
  );
  return rows.map(mapFinding);
}

export async function getFindingByKey(key: string): Promise<AgentFinding | null> {
  const row = await one<RawFindingRow>(`select ${FINDING_COLUMNS} from agent_findings where key = $1`, [key]);
  return row ? mapFinding(row) : null;
}

async function loadAgentPulse(): Promise<AgentPulse> {
  const [counts, brief, newSince] = await Promise.all([
    one<{ unread: number; open: number; high: number }>(
      `select
         count(*) filter (where state = 'open' and seen_at is null)::int as unread,
         count(*) filter (where state = 'open')::int as open,
         count(*) filter (where state = 'open' and severity = 'high')::int as high
       from agent_findings`
    ),
    one<{ day: string; memo: BriefMemo }>(
      `select day::text as day, memo from agent_briefs order by day desc limit 1`
    ),
    q<{ key: string; severity: Severity; title: string }>(
      `select key, severity, title from agent_findings
        where state = 'open' and seen_at is null
        order by ${SEVERITY_ORDER}, last_seen desc
        limit 8`
    ),
  ]);
  return {
    unread: counts?.unread ?? 0,
    open: counts?.open ?? 0,
    high: counts?.high ?? 0,
    briefHeadline: brief?.memo?.headline ?? null,
    briefDay: brief?.day ?? null,
    newSince,
  };
}

// Wrapped in React cache() to mirror getNavCounts. Header reads it once per
// layout render and /api/agent/pulse once per poll, so today the wrapper
// dedupes nothing, but it costs nothing and keeps a second same-request
// reader free.
export const getAgentPulse = cache(loadAgentPulse);

export async function listAgentActions(limit = 50): Promise<AgentAction[]> {
  return q<AgentAction>(
    `select id, finding_id, finding_key, remedy_key, args, tier, actor, ok, result, error, cost_usd,
            created_at::text as created_at
       from agent_actions
      order by created_at desc
      limit $1`,
    [Math.max(1, Math.min(500, limit))]
  );
}

export async function getLatestBrief(): Promise<AgentBrief | null> {
  return one<AgentBrief>(
    `select id, day::text as day, memo, findings_snapshot, actions_snapshot,
            emailed_at::text as emailed_at, model, created_at::text as created_at
       from agent_briefs order by day desc limit 1`
  );
}

export async function getBriefForDay(day: string): Promise<AgentBrief | null> {
  return one<AgentBrief>(
    `select id, day::text as day, memo, findings_snapshot, actions_snapshot,
            emailed_at::text as emailed_at, model, created_at::text as created_at
       from agent_briefs where day = $1::date`,
    [day]
  );
}

export async function listBriefs(limit = 30): Promise<AgentBrief[]> {
  return q<AgentBrief>(
    `select id, day::text as day, memo, findings_snapshot, actions_snapshot,
            emailed_at::text as emailed_at, model, created_at::text as created_at
       from agent_briefs order by day desc limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
}

// The one definition of today's agent spend (checkAgentBudget and the /agent
// page both read it). Remedy spend never carries an agent_* feature (callees
// log under their own tags), so it is counted from agent_actions.cost_usd
// instead; no double count.
const SPEND_FEATURES = ['agent_brief', 'agent_chat'];

export async function getAgentSpendToday(): Promise<{ usd: number; calls: number }> {
  const row = await one<{ usd: number; calls: number }>(
    `select (select coalesce(sum(cost_usd), 0) from ai_cost_log
               where feature = any($1::text[]) and created_at >= date_trunc('day', now() at time zone 'utc'))
          + (select coalesce(sum(cost_usd), 0) from agent_actions
               where created_at >= date_trunc('day', now() at time zone 'utc')) as usd,
            (select count(*)::int from ai_cost_log
               where feature = any($1::text[]) and created_at >= date_trunc('day', now() at time zone 'utc'))
          + (select count(*)::int from agent_actions
               where cost_usd > 0 and created_at >= date_trunc('day', now() at time zone 'utc')) as calls`,
    [SPEND_FEATURES]
  );
  return { usd: row?.usd ?? 0, calls: row?.calls ?? 0 };
}
