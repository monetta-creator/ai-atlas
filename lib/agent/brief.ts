import { routedStructured } from '../model-route';
import {
  getAgentPrefs, listFindings, listAgentActions, getBriefForDay, getAgentSpendToday, getDailyJobStatus,
} from '../data';
import type { DailyJobStatus } from '../data/readiness';
import { saveBrief, markBriefEmailed } from '../mutations';
import { checkAgentBudget } from './budget';
import { AGENT_PERSONA, STANDING_RULES, briefInstructions } from './prompt';
import { scrubDashes, validateMemo } from './brief-core';
import { isEmailConfigured, renderBriefHtml, sendBriefEmail, briefSubject } from './email';
import type { AgentAction, AgentFinding, BriefMemo, Severity } from './types';

// The morning memo: one bounded model call over the open findings and
// yesterday's actions, saved to agent_briefs and (when Resend is configured)
// emailed. Idempotent on the UTC day, so a retried cron tick never writes a
// second brief.

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One sentence naming the single most important thing. A failed engine beats an aging queue beats an editorial nudge.' },
    sections: {
      type: 'array',
      description: 'Two to four short sections. If nothing is wrong, one section saying so.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', description: 'A short section title, a few words.' },
          body: { type: 'string', description: 'Two to four sentences of plain prose with the numbers in them.' },
        },
        required: ['title', 'body'],
      },
    },
    proposals: {
      type: 'array',
      description: 'Findings that need Kevin\'s tap. One line each, imperative, quoting the count. Empty if none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          findingKey: { type: 'string', description: 'The finding key exactly as given below.' },
          text: { type: 'string' },
        },
        required: ['findingKey', 'text'],
      },
    },
    willDo: {
      type: 'array',
      description: 'Findings the agent will handle itself on the next tick (auto tier only). Empty if none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          findingKey: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['findingKey', 'text'],
      },
    },
  },
  required: ['headline', 'sections', 'proposals', 'willDo'],
};

function jobStatusLines(status: DailyJobStatus): string[] {
  return status.jobs.map((j) => `${j.key}: ${j.state}${j.detail ? ` (${j.detail})` : ''}${j.error ? ` error: ${j.error}` : ''}`);
}

function findingLines(findings: AgentFinding[]): string[] {
  return findings.slice(0, 60).map((f) => {
    const remedy = f.remedy ? ` remedy[${f.remedy.tier}]: ${f.remedy.label}` : '';
    return `- ${f.key} [${f.severity}] ${f.title}. ${f.detail} metric=${JSON.stringify(f.metric)}${remedy}`;
  });
}

function actionLines(actions: AgentAction[]): string[] {
  if (!actions.length) return ['No actions logged.'];
  return actions.slice(0, 30).map((a) => `- ${a.actor} ran ${a.remedy_key} (${a.tier}): ${a.ok ? 'ok' : `failed, ${a.error ?? 'no detail'}`}, cost $${a.cost_usd.toFixed(3)}`);
}

function buildDeterministicMemo(findings: AgentFinding[], reason: 'budget' | 'model_failed'): BriefMemo {
  const lead = reason === 'budget' ? 'Budget spent' : 'The model call failed';
  const bySeverity: Record<Severity, AgentFinding[]> = { high: [], warn: [], info: [] };
  for (const f of findings) bySeverity[f.severity]?.push(f);
  const sectionFor = (sev: Severity, label: string) => {
    const list = bySeverity[sev];
    if (!list.length) return null;
    return { title: label, body: list.map((f) => `${f.title} (${f.key}).`).join(' ') };
  };
  const sections = [sectionFor('high', 'High'), sectionFor('warn', 'Needs attention'), sectionFor('info', 'For the record')].filter(
    (s): s is { title: string; body: string } => s !== null
  );
  return {
    headline: findings.length
      ? `${lead}; here is the raw list (${findings.length} open)`
      : `${lead}; nothing open right now`,
    sections: sections.length ? sections : [{ title: 'Nothing open', body: 'No open findings right now.' }],
    proposals: findings.filter((f) => f.remedy?.tier === 'propose').map((f) => ({ findingKey: f.key, text: f.remedy!.label })),
    willDo: findings.filter((f) => f.remedy?.tier === 'auto').map((f) => ({ findingKey: f.key, text: f.remedy!.label })),
  };
}

export async function runDailyBrief(now: Date = new Date()): Promise<{ id: string; day: string; emailed: boolean; skipped?: string }> {
  const day = now.toISOString().slice(0, 10);

  const existing = await getBriefForDay(day);
  if (existing) {
    return { id: existing.id, day, emailed: Boolean(existing.emailed_at), skipped: 'already written' };
  }

  const prefs = await getAgentPrefs();
  const [budget, findings, actions, jobStatus] = await Promise.all([
    checkAgentBudget(),
    listFindings({ states: ['open', 'acked'], limit: 200 }),
    listAgentActions(30),
    getDailyJobStatus(),
  ]);
  const openKeys = findings.map((f) => f.key);

  let memo: BriefMemo;
  let model: string; // 'none' when no model call was made (budget spent, or the call failed)

  if (!budget.ok) {
    memo = buildDeterministicMemo(findings, 'budget');
    model = 'none';
  } else {
    const spendToday = await getAgentSpendToday()
      .then((s) => s.usd)
      .catch(() => 0);
    const system = [AGENT_PERSONA, STANDING_RULES, prefs.steering ? `Kevin's standing note:\n${prefs.steering}` : null]
      .filter(Boolean)
      .join('\n\n');
    const user = [
      briefInstructions(),
      '',
      `OPEN FINDINGS (${findings.length}):`,
      ...(findingLines(findings).length ? findingLines(findings) : ['None.']),
      '',
      "YESTERDAY'S ACTIONS:",
      ...actionLines(actions),
      '',
      'DAILY JOBS:',
      ...jobStatusLines(jobStatus),
      '',
      `Agent spend today: $${spendToday.toFixed(3)} of the daily budget.`,
    ].join('\n');

    try {
      const raw = await routedStructured<BriefMemo>({
        model: prefs.brief_model,
        system,
        user,
        toolName: 'write_brief',
        toolDescription: 'Report the morning brief for Kevin.',
        schema: SCHEMA,
        maxTokens: 1800,
        timeoutMs: 60_000,
        feature: 'agent_brief',
      });
      memo = validateMemo(raw, openKeys);
      if (!memo.headline) {
        memo.headline = scrubDashes(findings[0]?.title ?? 'Nothing to report today.');
      }
      model = prefs.brief_model || 'none';
    } catch {
      memo = buildDeterministicMemo(findings, 'model_failed');
      model = 'none';
    }
  }

  const findingsSnapshot = findings.map((f) => ({ key: f.key, severity: f.severity, state: f.state, title: f.title }));
  const actionsSnapshot = actions.map((a) => ({ remedy_key: a.remedy_key, actor: a.actor, ok: a.ok, created_at: a.created_at }));

  const id = await saveBrief(day, memo, findingsSnapshot, actionsSnapshot, model);

  let emailed = false;
  if (isEmailConfigured(prefs)) {
    const to = process.env.AGENT_EMAIL_TO || prefs.email_to || '';
    const html = renderBriefHtml(day, memo, findings);
    const result = await sendBriefEmail({ to, subject: briefSubject({ memo }), html });
    if (result.ok) {
      await markBriefEmailed(id);
      emailed = true;
    }
  }

  return { id, day, emailed };
}
