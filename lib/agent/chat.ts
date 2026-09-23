import { q, one } from '../db';
import { routedStructured, resolvedModel } from '../model-route';
import { searchAtlas } from '../ask/search';
import {
  getAgentPrefs, listFindings, getFindingByKey, listAgentActions, getNavCounts,
  getDraftBacklogStats, getPipelinePrefs, getDailyJobStatus, getRuns,
  getScanHealth, getIntelHealth, getResearchHealth, getToolingHealth,
} from '../data';
import { checkAgentBudget } from './budget';
import { checkScanBudget } from '../scan/budget';
import { checkPipelineBudget } from '../pipeline/budget';
import { checkIntelBudget } from '../intel/budget';
import { checkResearchBudget } from '../research/budget';
import { checkPortalBudget } from '../portal/budget';
import { executeRemedy } from './remedies';
import { buildToolCatalog, parseStep, renderTranscript, type ChatMessage, type ToolMeta } from './chat-core';
import { scrubDashes } from './brief-core';
import type { AgentChatEvent, AgentChatMessage, FindingState, Severity } from './types';

const FINDING_STATES: FindingState[] = ['open', 'acked', 'snoozed', 'resolved'];
const SEVERITIES: Severity[] = ['info', 'warn', 'high'];

// The chat's JSON step loop: no native tool-calling on the cheap open-weight
// models, so each step asks the model for {thought, calls, answer} via
// routedStructured (the pipeline's schema-in-the-prompt trick) and the loop
// feeds tool results back in as plain text. Read-only except run_remedy,
// which only ever fires a propose-tier remedy the human just asked for.

const MAX_STEPS = 4;
const DEADLINE_MS = 100_000;
const RESULT_CAP = 2500;

const clip = (s: string, cap = RESULT_CAP): string => (s.length > cap ? `${s.slice(0, cap)} ...` : s);
const j = (v: unknown): string => clip(JSON.stringify(v));

// -------------------------------------------------------------- tools

interface AgentTool extends ToolMeta {
  run(args: Record<string, unknown>): Promise<string>;
}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : '';
}
function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const n = Number(args[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const RUN_NOTE_TABLES: Record<string, { table: string; dayCol: boolean }> = {
  scan: { table: 'scan_runs', dayCol: true },
  intel: { table: 'intel_runs', dayCol: true },
  research: { table: 'research_runs', dayCol: true },
  tooling: { table: 'tooling_runs', dayCol: true },
  pipeline: { table: 'pipeline_runs', dayCol: false },
};

async function runNotes(job: string, days: number): Promise<string> {
  const cfg = RUN_NOTE_TABLES[job];
  if (!cfg) return `Unknown job "${job}". Use scan, intel, research, tooling, or pipeline.`;
  const rows = cfg.dayCol
    ? await q<{ day: string; notes: string[] }>(
        `select day::text as day, notes from ${cfg.table}
          where day > current_date - $1::interval and coalesce(array_length(notes, 1), 0) > 0
          order by day desc`,
        [`${days} days`]
      )
    : await q<{ day: string; notes: string[] }>(
        `select to_char(created_at, 'YYYY-MM-DD') as day, notes from ${cfg.table}
          where cadence = 'daily' and created_at > now() - $1::interval and coalesce(array_length(notes, 1), 0) > 0
          order by created_at desc`,
        [`${days} days`]
      );
  if (!rows.length) return `No notes in the last ${days} days for ${job}.`;
  return rows.map((r) => `${r.day}: ${r.notes.join('; ')}`).join('\n');
}

async function health(job: string, days: number): Promise<string> {
  if (job === 'scan') return j(await getScanHealth(days));
  if (job === 'intel') return j(await getIntelHealth(days));
  if (job === 'research') return j(await getResearchHealth(days));
  if (job === 'tooling') return j(await getToolingHealth(Math.max(1, Math.round(days / 7))));
  if (job === 'pipeline') {
    const runs = await getRuns(10);
    return j(
      runs.map((r) => ({
        day: r.triggered_at, status: r.status, step: r.step,
        candidates: r.candidate_count, signals: r.signal_count, error: r.error,
      }))
    );
  }
  return `Unknown job "${job}". Use scan, intel, research, tooling, or pipeline.`;
}

function buildTools(): AgentTool[] {
  return [
    {
      name: 'list_findings',
      description: 'List open (and optionally acked) findings, filterable by severity.',
      args: 'state?: open|acked|snoozed|resolved, severity?: info|warn|high',
      async run(args) {
        const state = str(args, 'state');
        const severity = str(args, 'severity');
        const states: FindingState[] = FINDING_STATES.includes(state as FindingState) ? [state as FindingState] : [];
        const severities: Severity[] = SEVERITIES.includes(severity as Severity) ? [severity as Severity] : [];
        const findings = await listFindings({
          states: states.length ? states : undefined,
          severity: severities.length ? severities : undefined,
          limit: 60,
        });
        if (!findings.length) return 'No findings match.';
        return clip(findings.map((f) => `${f.key} [${f.severity}/${f.state}] ${f.title}`).join('\n'));
      },
    },
    {
      name: 'get_finding',
      description: 'Read one finding in full, including its remedy and metric.',
      args: 'key: the finding key',
      async run(args) {
        const key = str(args, 'key');
        if (!key) return 'get_finding needs a key.';
        const f = await getFindingByKey(key);
        if (!f) return `No finding with key ${key}.`;
        return clip(
          `${f.key} [${f.severity}/${f.state}] ${f.title}\n${f.detail}\nmetric: ${JSON.stringify(f.metric)}\nhref: ${f.href ?? 'none'}\nremedy: ${
            f.remedy ? `${f.remedy.key} (${f.remedy.tier}): ${f.remedy.label}` : 'none'
          }\nfirst seen ${f.first_seen}, last seen ${f.last_seen}`
        );
      },
    },
    {
      name: 'engine_status',
      description: "Today's status for the four daily engines (scan, pipeline, intel, research).",
      args: '(none)',
      async run() {
        return j(await getDailyJobStatus());
      },
    },
    {
      name: 'health',
      description: '30 day health for one engine: run/miss counts, coverage, spend.',
      args: 'job: scan|intel|research|tooling|pipeline, days?: window in days, default 30',
      async run(args) {
        return health(str(args, 'job'), num(args, 'days', 30));
      },
    },
    {
      name: 'run_notes',
      description: "An engine's persisted per-run issue notes over the last N days.",
      args: 'job: scan|intel|research|tooling|pipeline, days?: default 3',
      async run(args) {
        return runNotes(str(args, 'job'), num(args, 'days', 3));
      },
    },
    {
      name: 'queue_counts',
      description: 'Current queue depths across the desk: pipeline, drafts, papers, scout, tickets, tooling, plus the draft-backlog breakdown.',
      args: '(none)',
      async run() {
        const [nav, pipelinePrefs] = await Promise.all([getNavCounts(), getPipelinePrefs()]);
        const backlog = await getDraftBacklogStats({
          afterHours: pipelinePrefs.auto_publish_after_hours,
          from: pipelinePrefs.auto_publish_from,
        });
        return j({ nav, backlog });
      },
    },
    {
      name: 'spend',
      description: 'AI spend grouped by feature over the last N days, top 15 by cost.',
      args: 'days?: default 7',
      async run(args) {
        const days = num(args, 'days', 7);
        const rows = await q<{ feature: string; usd: number; calls: number }>(
          `select feature, coalesce(sum(cost_usd), 0)::numeric as usd, count(*)::int as calls
             from ai_cost_log
            where created_at > now() - $1::interval
            group by feature
            order by usd desc
            limit 15`,
          [`${days} days`]
        );
        return j(rows);
      },
    },
    {
      name: 'budget',
      description: "Today's spend vs. cap for the agent and the other engines (scan, pipeline, intel, research, portal).",
      args: '(none)',
      async run() {
        const [agent, scan, pipeline, intel, research, portal] = await Promise.all([
          checkAgentBudget(), checkScanBudget(), checkPipelineBudget(), checkIntelBudget(), checkResearchBudget(),
          checkPortalBudget(),
        ]);
        return j({ agent, scan, pipeline, intel, research, portal });
      },
    },
    {
      name: 'search_atlas',
      description: 'Full text search over claims, bridges, stances, concepts, signals, papers, and threads.',
      args: 'q: search terms',
      async run(args) {
        const query = str(args, 'q') || str(args, 'query');
        if (!query) return 'search_atlas needs a query.';
        const hits = await searchAtlas(q, query, {
          kinds: ['claim', 'bridge', 'stance', 'concept', 'signal', 'paper', 'thread'],
          limit: 6,
          admin: true,
          tagFor: (id) => id,
          paperTagFor: (id) => id,
        });
        if (!hits.length) return 'No records matched.';
        return clip(hits.map((h) => `[${h.kind} ${h.id}] ${h.snippet}`).join('\n'));
      },
    },
    {
      name: 'recent_actions',
      description: 'The most recent remedy actions the agent (or Kevin) has taken.',
      args: 'n?: default 15',
      async run(args) {
        const actions = await listAgentActions(num(args, 'n', 15));
        if (!actions.length) return 'No actions logged yet.';
        return clip(
          actions
            .map((a) => `${a.created_at} ${a.actor} ran ${a.remedy_key} (${a.tier}): ${a.ok ? 'ok' : `failed (${a.error ?? 'no detail'})`}`)
            .join('\n')
        );
      },
    },
    {
      name: 'run_remedy',
      description:
        "Run a finding's remedy, but ONLY when its tier is propose and Kevin just asked for it in this conversation. Auto-tier remedies already run on their own; never-tier ones are Kevin's alone.",
      args: 'findingKey: the finding key, reason: quote what Kevin asked for',
      async run(args) {
        const findingKey = str(args, 'findingKey');
        const reason = str(args, 'reason');
        if (!findingKey) return 'run_remedy needs a findingKey.';
        if (!reason) return 'run_remedy needs a reason quoting what Kevin asked for.';
        const finding = await getFindingByKey(findingKey);
        if (!finding) return `No finding with key ${findingKey}.`;
        if (!finding.remedy) return `${findingKey} has no remedy attached.`;
        if (finding.remedy.tier === 'never') return `${findingKey}'s remedy is yours alone; the agent will not run it.`;
        if (finding.remedy.tier === 'auto') return `${findingKey}'s remedy runs on its own on the next tick; no need to trigger it here.`;
        const result = await executeRemedy({
          findingKey,
          remedyKey: finding.remedy.key,
          args: { ...(finding.remedy.args ?? {}), reason },
          actor: 'kevin_chat',
          now: new Date(),
        });
        return clip(`${result.ok ? 'Done' : 'Failed'}: ${result.summary}`);
      },
    },
  ];
}

// -------------------------------------------------------------- status text

function describeCall(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'list_findings': return 'Checking findings';
    case 'get_finding': return `Reading finding ${str(args, 'key') || '?'}`;
    case 'engine_status': return 'Checking engine status';
    case 'health': return `Reading ${str(args, 'job') || 'engine'} health`;
    case 'run_notes': return `Reading ${str(args, 'job') || 'engine'} notes, ${num(args, 'days', 3)} days`;
    case 'queue_counts': return 'Checking queue counts';
    case 'spend': return 'Checking spend';
    case 'budget': return 'Checking budget';
    case 'search_atlas': return `Searching the Atlas for "${str(args, 'q') || str(args, 'query')}"`;
    case 'recent_actions': return 'Reading recent actions';
    case 'run_remedy': return `Running the remedy for ${str(args, 'findingKey') || '?'}`;
    default: return `Calling ${tool}`;
  }
}

// -------------------------------------------------------------- wire

const ndLine = (e: AgentChatEvent): string => `${JSON.stringify(e)}\n`;

export const BUDGET_SPENT_MESSAGE =
  "The daily agent budget is spent for today. It resets at midnight UTC; raise AGENT_DAILY_BUDGET_USD if you want more headroom.";

// Runs one full chat turn: emits `status` lines as tools are called, one
// `delta` with the final answer, a `cost` line, and a terminal `done`.
export async function runAgentChat(messages: AgentChatMessage[], emit: (line: string) => void): Promise<void> {
  const start = new Date();
  const startedAt = start.toISOString();

  const prefs = await getAgentPrefs();
  const budget = await checkAgentBudget();

  if (!budget.ok) {
    emit(ndLine({ type: 'delta', text: BUDGET_SPENT_MESSAGE }));
    emit(ndLine({ type: 'cost', cost_usd: 0, input_tokens: 0, output_tokens: 0, rounds: 0, model: resolvedModel(prefs.chat_model) }));
    emit(ndLine({ type: 'done' }));
    return;
  }

  const tools = buildTools();
  const toolCatalog = buildToolCatalog(tools);
  const byName = new Map(tools.map((t) => [t.name, t]));

  const findingsDigest = (await listFindings({ limit: 12 })).map((f) => ({ key: f.key, severity: f.severity, title: f.title }));
  const priorMessages: ChatMessage[] = messages.slice(0, -1).map((m) => ({ role: m.role, text: m.text }));
  const question = messages[messages.length - 1]?.text ?? '';

  const toolResultsByStep: { step: number; results: string[] }[] = [];
  let answer: string | null = null;
  let rounds = 0;

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (Date.now() - start.getTime() > DEADLINE_MS) break;
      const stepsLeft = MAX_STEPS - step + 1;
      const { system, user } = renderTranscript({
        steering: prefs.steering,
        findingsDigest,
        priorMessages,
        toolResultsByStep,
        toolCatalog,
        stepsLeft,
        question,
      });

      const raw = await routedStructured<{ thought: string; calls: { tool: string; args: Record<string, unknown> }[]; answer: string | null }>({
        model: prefs.chat_model,
        system,
        user,
        toolName: 'agent_step',
        toolDescription: 'Report this step of the conversation: what to call next, or the final answer.',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            thought: { type: 'string', description: 'One line: what you need next, or why you are ready to answer.' },
            calls: {
              type: 'array',
              description: 'Tool calls for this step. Empty when you are ready to answer. At most 4.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tool: { type: 'string', description: 'One of the tool names listed.' },
                  args: { type: 'object', description: 'The arguments object for that tool.' },
                },
                required: ['tool', 'args'],
              },
            },
            answer: { type: ['string', 'null'], description: 'The final reply to Kevin, or null when calling tools.' },
          },
          required: ['thought', 'calls', 'answer'],
        },
        maxTokens: 1500,
        timeoutMs: 45_000,
        feature: 'agent_chat',
      });
      rounds++;
      const parsed = parseStep(raw);

      if (parsed.answer) {
        answer = parsed.answer;
        break;
      }
      if (!parsed.calls.length) {
        // A malformed step with neither calls nor an answer: force it on the
        // next iteration by treating steps-left as exhausted.
        if (step === MAX_STEPS) break;
        continue;
      }

      const results: string[] = [];
      for (const call of parsed.calls) {
        emit(ndLine({ type: 'status', text: scrubDashes(describeCall(call.tool, call.args)) }));
        const tool = byName.get(call.tool);
        if (!tool) {
          results.push(`${call.tool}: unknown tool.`);
          continue;
        }
        try {
          const text = await tool.run(call.args ?? {});
          results.push(`${call.tool}: ${text}`);
        } catch (e) {
          results.push(`${call.tool}: failed (${e instanceof Error ? e.message : 'error'}).`);
        }
      }
      toolResultsByStep.push({ step, results });

      if (step === MAX_STEPS) {
        // Forced final: one more step with steps-left = 0's worth of framing,
        // reusing the same call so the model sees this step's tool results.
        const { system: sys2, user: user2 } = renderTranscript({
          steering: prefs.steering,
          findingsDigest,
          priorMessages,
          toolResultsByStep,
          toolCatalog,
          stepsLeft: 1,
          question,
        });
        try {
          const raw2 = await routedStructured<{ thought: string; calls: unknown[]; answer: string | null }>({
            model: prefs.chat_model,
            system: sys2,
            user: user2,
            toolName: 'agent_step',
            toolDescription: 'Report the final answer to Kevin.',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                thought: { type: 'string' },
                calls: { type: 'array', items: { type: 'object' } },
                answer: { type: 'string', description: 'The final reply to Kevin.' },
              },
              required: ['thought', 'calls', 'answer'],
            },
            maxTokens: 1500,
            timeoutMs: 45_000,
            feature: 'agent_chat',
          });
          rounds++;
          answer = parseStep(raw2).answer;
        } catch {
          // fall through to the no-answer fallback below
        }
      }
    }
  } catch {
    // fall through: whatever answer we have (possibly none) still ships
  }

  const finalText = scrubDashes(answer?.trim() || 'I could not put together an answer from what I checked. Try asking again, or narrower.');
  emit(ndLine({ type: 'delta', text: finalText }));

  const costRow = await one<{ usd: number; input_tokens: number; output_tokens: number; n: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd,
            coalesce(sum(input_tokens), 0)::int as input_tokens,
            coalesce(sum(output_tokens), 0)::int as output_tokens,
            count(*)::int as n
       from ai_cost_log
      where feature = 'agent_chat' and created_at >= $1::timestamptz`,
    [startedAt]
  ).catch(() => null);

  emit(
    ndLine({
      type: 'cost',
      cost_usd: costRow?.usd ?? 0,
      input_tokens: costRow?.input_tokens ?? 0,
      output_tokens: costRow?.output_tokens ?? 0,
      rounds: costRow?.n ?? rounds,
      model: resolvedModel(prefs.chat_model),
    })
  );
  emit(ndLine({ type: 'done' }));
}
