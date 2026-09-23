// The Atlas Agent's shared contract (2026-09-22): the resident operator that
// watches every queue, engine and editorial surface, files findings, runs the
// reversible fixes itself and tees up the rest. Pure types, importable from
// client components; the tables live in migration 0056.

export type Severity = 'info' | 'warn' | 'high';
export type FindingState = 'open' | 'acked' | 'snoozed' | 'resolved';
export type RemedyTier = 'auto' | 'propose' | 'never';
export type Actor = 'agent' | 'kevin' | 'kevin_chat';
export type JobKey = 'scan' | 'pipeline' | 'intel' | 'research' | 'tooling';
export const JOB_KEYS: JobKey[] = ['scan', 'pipeline', 'intel', 'research', 'tooling'];

// A remedy reference carried ON a finding: what the agent can do about it.
// `tier` is copied from the remedy registry at check time so the card can
// say "I can do this" / "Needs your tap" / "Yours alone" without a lookup.
export interface RemedyRef {
  key: string;                      // registry key, e.g. 'drafts.archive_no_touches'
  args?: Record<string, unknown>;
  tier: RemedyTier;
  label: string;                    // imperative, e.g. 'Archive 19 drafts with no claim touches'
  costsModel: boolean;
}

// What a check returns. The runner upserts by `key`.
export interface FindingInput {
  key: string;                      // '<check>[:<subject>]', stable across runs
  checkKey: string;
  subject?: string | null;
  severity: Severity;
  title: string;                    // one line, no em dashes
  detail: string;                   // two or three sentences: the metric, since when, what it means
  metric?: Record<string, unknown>;
  href?: string | null;             // where to look in the app
  remedy?: RemedyRef | null;
}

export interface AgentFinding extends FindingInput {
  id: string;
  subject: string | null;
  metric: Record<string, unknown>;
  href: string | null;
  remedy: RemedyRef | null;
  state: FindingState;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  snoozed_until: string | null;
  seen_at: string | null;
  acked_at: string | null;
  last_action_at: string | null;
}

export type CheckDomain = 'queues' | 'engines' | 'editorial';

export interface AgentCheck {
  key: string;                      // e.g. 'drafts.backlog'
  title: string;
  domain: CheckDomain;
  run(ctx: CheckContext): Promise<FindingInput[]>;
}

export interface CheckContext {
  now: Date;
  weekday: boolean;                 // Mon-Fri in UTC
  hourUtc: number;
}

export interface AgentAction {
  id: string;
  finding_id: string | null;
  finding_key: string | null;
  remedy_key: string;
  args: Record<string, unknown>;
  tier: RemedyTier;
  actor: Actor;
  ok: boolean;
  result: unknown;
  error: string | null;
  cost_usd: number;
  created_at: string;
}

export interface BriefMemo {
  headline: string;
  sections: { title: string; body: string }[];
  proposals: { findingKey: string; text: string }[];
  willDo: { findingKey: string; text: string }[];
}

export interface AgentBrief {
  id: string;
  day: string;                      // YYYY-MM-DD
  memo: BriefMemo;
  findings_snapshot: unknown;
  actions_snapshot: unknown;
  emailed_at: string | null;
  model: string | null;
  created_at: string;
}

export interface AgentPrefs {
  enabled: boolean;                 // gates the cron leg only
  auto_enabled: boolean;            // master switch for the auto tier
  chat_model: string;
  brief_model: string;
  steering: string;
  email_to: string | null;
  updated_at: string | null;
}

export const DEFAULT_AGENT_MODEL = 'z-ai/glm-5.3-flash';

// GET /api/agent/pulse
export interface AgentPulse {
  unread: number;                   // open findings never seen
  open: number;                     // open findings, seen or not
  high: number;                     // open findings at severity high
  briefHeadline: string | null;
  briefDay: string | null;
  newSince: { key: string; severity: Severity; title: string }[];
}

// POST /api/agent/chat wire: NDJSON events
export type AgentChatEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'cost'; cost_usd: number; input_tokens: number; output_tokens: number; rounds: number; model: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// The result of one remedy execution (registry + audit log agree on this).
export interface RemedyResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  summary: string;                  // one line for the audit log and the finding's detail
}
