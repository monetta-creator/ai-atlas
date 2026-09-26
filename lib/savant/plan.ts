import { q, one } from '../db';
import { routedStructured } from '../model-route';
import { loadStoryItems } from '../edition/pack';
import { clusterStories } from '../edition/cluster';
import { isAiStory } from '../edition/desks';
import { fallbackPlan, validatePlan } from './plan-core';
import { getNotebook, getOpenHypotheses } from '../data/savant';
import type { Hypothesis, PlanPayload, SavantPrefs, SelfCompany } from './types';
import { previousWeekEnd } from './week';

// Savant's Monday plan: the one editorial decision of the week, made by the
// desk itself and recorded in the notebook so the issue can say what it
// chose to research and why (Appendix A). Inputs are all from the stores:
// the seven questions, the lead rotation and the last four issues' leads,
// the open hypotheses (never pose one twice), last week's connections and
// anomalies, and the weekend's biggest story clusters. One cheap call on
// savant_prefs.notebook_model; a deterministic plan stands in when the call
// fails or the budget is spent.

const PLAN_SYSTEM =
  `You are Savant, the research desk of The AI Atlas: an autonomous analyst writing a weekly report for ` +
  `people doing AI transformation inside large regulated financial-services companies, read by their ` +
  `executives. Every Monday you choose ONE topic to research through the week and pose ONE new hypothesis ` +
  `the week's public record can strengthen or weaken. Choose the topic where the last week's evidence is ` +
  `thickest or most contradictory, prefer the next question in the rotation unless the week clearly calls ` +
  `for another, and never re-pose an open hypothesis. A hypothesis is one falsifiable sentence a banking ` +
  `reader would care about, with two or three things that would settle it and the public series or record ` +
  `types to watch. Work only from what you are given; invent no facts, name no confidential information. ` +
  `Never use an em dash; use a comma or a colon instead.`;

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    topic: { type: 'string', description: 'the lead analysis topic, one line' },
    question_slug: { type: 'string', description: 'one of the question slugs given' },
    why: { type: 'string', description: 'two sentences: why this topic this week' },
    hypothesis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        statement: { type: 'string', description: 'one falsifiable sentence' },
        what_would_settle_it: { type: 'array', items: { type: 'string' }, description: '2 to 3 items' },
        watch: { type: 'array', items: { type: 'string' }, description: 'public series or record types to watch, 2 to 4' },
      },
      required: ['statement', 'what_would_settle_it', 'watch'],
    },
    sources_to_pull: { type: 'array', items: { type: 'string' }, description: 'record kinds or public sources to read this week, up to 6' },
  },
  required: ['topic', 'question_slug', 'why', 'hypothesis', 'sources_to_pull'],
};

async function recentLeadSlugs(weekEnd: string, n = 4): Promise<{ slug: string; topic: string }[]> {
  const rows = await q<{ payload: PlanPayload }>(
    `select payload from savant_notebook
      where kind = 'plan' and week_end < $1::date
      order by week_end desc limit $2`,
    [weekEnd, n]
  );
  return rows.map((r) => ({ slug: r.payload.question_slug, topic: r.payload.topic }));
}

function fmtHypotheses(hs: Hypothesis[]): string {
  if (!hs.length) return 'none yet';
  return hs.map((h) => `- (${h.status}, posed ${h.posed_week}) ${h.statement}`).join('\n');
}

export async function makeMondayPlan(input: {
  day: string;
  weekEnd: string;
  prefs: SavantPrefs;
  self: SelfCompany | null;
  budgetOk: boolean;
}): Promise<PlanPayload> {
  const { day, weekEnd, prefs, self } = input;
  const rotation = prefs.lead_rotation.length ? prefs.lead_rotation : ['capability', 'build-out', 'unit-economics', 'mispricing', 'rent', 'geopolitics', 'labor'];

  const [questions, recent, open, lastWeek, { items }] = await Promise.all([
    q<{ slug: string; title: string }>(`select slug, title from questions order by sort_order`),
    recentLeadSlugs(weekEnd),
    getOpenHypotheses(),
    getNotebook(previousWeekEnd(weekEnd), ['connection', 'anomaly']),
    loadStoryItems(day),
  ]);
  const clusters = clusterStories(items).filter((c) => isAiStory(c.lead) || c.items.some(isAiStory)).slice(0, 12);
  const top = clusters[0] ? { headline: clusters[0].lead.headline, url: clusters[0].lead.url } : null;
  const fallback = fallbackPlan({ rotation, recent: recent.map((r) => r.slug), topCluster: top, weekEnd });

  if (prefs.lead_override?.trim()) {
    // A one-off topic from the console: honored as the topic, the model still
    // writes the hypothesis around it (below); cleared by the caller.
    fallback.topic = prefs.lead_override.trim();
  }
  if (!input.budgetOk) return fallback;

  const lastWeekLines = lastWeek.slice(0, 15).map((r) => {
    const p = r.payload as { record?: { title: string }; target?: { code: string; statement: string }; note?: string };
    if (r.kind === 'connection' && p.record && p.target) return `- ${p.record.title} ~ ${p.target.code}: ${p.target.statement}`;
    if (r.kind === 'anomaly' && p.note) return `- ${p.note}`;
    return null;
  }).filter(Boolean) as string[];

  const user = [
    `WEEK ENDING: ${weekEnd} (planning on ${day})`,
    self ? `READER ORGANIZATION (public description): ${self.name}. ${self.public_blurb ?? ''}`.trim() : 'READER ORGANIZATION: a large regulated financial-services company (no further context).',
    '',
    'QUESTIONS (slug: title):',
    ...questions.map((qu) => `- ${qu.slug}: ${qu.title}`),
    '',
    `ROTATION ORDER: ${rotation.join(' > ')}. Next in rotation: ${fallback.question_slug}.`,
    `RECENT LEADS: ${recent.length ? recent.map((r) => `${r.slug} ("${r.topic}")`).join('; ') : 'none yet'}.`,
    prefs.lead_override?.trim() ? `TOPIC OVERRIDE FROM THE DESK (use it): ${prefs.lead_override.trim()}` : '',
    '',
    'OPEN HYPOTHESES (do not re-pose):',
    fmtHypotheses(open),
    '',
    "LAST WEEK'S CONNECTIONS AND ANOMALIES:",
    lastWeekLines.length ? lastWeekLines.join('\n') : '- none recorded',
    '',
    'BIGGEST STORY CLUSTERS SINCE FRIDAY:',
    ...clusters.map((c) => `- ${c.lead.headline} (${c.outlets.length} outlet${c.outlets.length === 1 ? '' : 's'})`),
  ].filter((l) => l !== undefined).join('\n');

  try {
    const out = await routedStructured<unknown>({
      model: prefs.notebook_model,
      system: PLAN_SYSTEM,
      user,
      toolName: 'submit_plan',
      toolDescription: "Return Savant's plan for the week: topic, question, why, the new hypothesis, sources to pull.",
      schema: PLAN_SCHEMA,
      maxTokens: 1200,
      timeoutMs: 60_000,
      feature: 'savant_plan',
      metadata: { week_end: weekEnd, day },
    });
    const plan = validatePlan(out, { rotation, fallback });
    if (prefs.lead_override?.trim()) plan.topic = prefs.lead_override.trim();
    return plan;
  } catch {
    return fallback;
  }
}

export async function hypothesisExistsForWeek(weekEnd: string): Promise<boolean> {
  const row = await one<{ n: number }>(`select count(*)::int as n from savant_hypotheses where posed_week = $1::date`, [weekEnd]);
  return (row?.n ?? 0) > 0;
}
