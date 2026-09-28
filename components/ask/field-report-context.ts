import type { AskConvo } from './store';

// The `context` half of a Field Report plan request (2026-09-28): the last
// few turns before the question, as plain text, capped so the plan call's
// prompt stays small. Shared by AskWorkspace (the first plan request) and
// FieldReportPlanCard (Regenerate), so both send the same shape.
export const FIELD_REPORT_CONTEXT_TURNS = 6;
export const FIELD_REPORT_CONTEXT_MAX = 3000;

export function fieldReportContext(convo: AskConvo | null, uptoIndex: number): string {
  if (!convo) return '';
  const prior = convo.messages.slice(0, Math.max(0, uptoIndex)).slice(-FIELD_REPORT_CONTEXT_TURNS);
  const text = prior.map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`).join('\n\n').trim();
  return text.length > FIELD_REPORT_CONTEXT_MAX ? text.slice(-FIELD_REPORT_CONTEXT_MAX) : text;
}
