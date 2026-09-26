import { routedStructured } from '../model-route';
import type { AnomalyPayload, ConnectionPayload, EchoPayload, MissPayload, NotePayload, PlanPayload } from './types';
import type { NotebookEntry } from '../mutations/savant';

// Savant's daily note: 120 words on what the day added to the lead topic and
// what surprised the desk, written over the day's deterministic entries.
// One cheap call (savant_prefs.notebook_model, feature savant_note); the
// Friday issue's Appendix A prints the five notes as the week's diary.

const NOTE_SYSTEM =
  `You are Savant, an autonomous research desk keeping a working diary. Given today's plan and the ` +
  `connections, echoes, anomalies and misses the desk recorded today, write ONE note of about 120 words ` +
  `in the first person plural ("we"): what today added to the lead topic, what surprised us, and what we ` +
  `now want to check before Friday. Concrete nouns, no praise, no filler, only what is in the entries. ` +
  `Never use an em dash; use a comma or a colon instead.`;

const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { text: { type: 'string', description: 'about 120 words' } },
  required: ['text'],
};

function line(e: NotebookEntry): string | null {
  switch (e.kind) {
    case 'connection': { const p = e.payload as ConnectionPayload; return `connection: "${p.record.title}" ~ ${p.target.code} (${p.target.statement}) sim ${p.sim}`; }
    case 'echo': { const p = e.payload as EchoPayload; return `echo: "${p.a.title}" ~ "${p.b.title}" sim ${p.sim}`; }
    case 'anomaly': { const p = e.payload as AnomalyPayload; return `anomaly: ${p.note}`; }
    case 'miss': { const p = e.payload as MissPayload; return `miss: ${p.headline} (${p.detail})`; }
    default: return null;
  }
}

export async function writeDailyNote(input: {
  day: string;
  weekEnd: string;
  model: string;
  plan: PlanPayload | null;
  entries: NotebookEntry[];
}): Promise<NotePayload | null> {
  const lines = input.entries.map(line).filter(Boolean) as string[];
  if (!lines.length && !input.plan) return null;
  const user = [
    `DAY: ${input.day} (issue week ending ${input.weekEnd})`,
    input.plan ? `LEAD TOPIC: ${input.plan.topic}\nHYPOTHESIS: ${input.plan.hypothesis.statement}` : 'LEAD TOPIC: not chosen yet',
    '',
    "TODAY'S ENTRIES:",
    ...(lines.length ? lines.slice(0, 40) : ['- nothing recorded today']),
  ].join('\n');
  try {
    const out = await routedStructured<{ text?: unknown }>({
      model: input.model,
      system: NOTE_SYSTEM,
      user,
      toolName: 'submit_note',
      toolDescription: "Return Savant's diary note for the day.",
      schema: NOTE_SCHEMA,
      maxTokens: 400,
      timeoutMs: 45_000,
      feature: 'savant_note',
      metadata: { week_end: input.weekEnd, day: input.day },
    });
    const text = typeof out.text === 'string' ? out.text.replace(/\s*—\s*/g, ', ').trim() : '';
    return text ? { text: text.slice(0, 1200), model: input.model } : null;
  } catch {
    return null;
  }
}
