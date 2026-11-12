// Next-step chips (redo Phase 4, P4.7): two or three launchable next steps
// after each answer, chosen for THIS turn from what the answer and the
// decider showed. Deterministic and free (no model call); the client renders
// each as a button that sends `prompt` as the next turn. Import-free.
// No em dashes (user-facing).

export interface Chip {
  label: string;
  prompt: string;
  kind: 'skill' | 'agent' | 'check' | 'view';
}

export interface ChipInput {
  question: string; // the user's turn (after any /skill rewrite)
  answer: string;
  skillSlug?: string | null; // the skill that produced this answer, if any
  depth?: string;
  lane?: string;
  audience: 'admin' | 'keyholder';
}

const DATE_RE = /\b(19|20)\d{2}-\d{2}-\d{2}\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? (19|20)\d{2}\b/g;
const CLAIM_RE = /\[(claim|stance|bridge) [^\]]+\]/g;
const COMPANY_RE = /\[(fact|item) [A-Z]?\d+\]/g;

// A short topic from the question: drop a leading question word and trailing
// punctuation, cap the length.
export function topicOf(question: string): string {
  const q = question
    .replace(/^\s*(what|how|why|who|when|where|which|is|are|does|do|can|should|tell me|explain|catch me up on)\b[^a-z0-9]*/i, '')
    .replace(/[?.!]+\s*$/, '')
    .trim();
  const t = q.length > 70 ? `${q.slice(0, 70).replace(/\s+\S*$/, '')}` : q;
  return t || question.slice(0, 70);
}

export function nextChips(i: ChipInput): Chip[] {
  if (!i.answer.trim() || i.lane === 'unrelated') return [];
  const topic = topicOf(i.question);
  const out: Chip[] = [];
  const dates = (i.answer.match(DATE_RE) ?? []).length;
  const mapRefs = (i.answer.match(CLAIM_RE) ?? []).length;
  const companyRefs = (i.answer.match(COMPANY_RE) ?? []).length;
  const used = i.skillSlug ?? '';

  if (mapRefs >= 2 && used !== 'argue') out.push({ kind: 'skill', label: 'Argue both sides', prompt: `/argue ${topic}` });
  if (dates >= 3 && used !== 'timeline') out.push({ kind: 'view', label: 'See it as a timeline', prompt: `/timeline ${topic}` });
  if (companyRefs >= 2 && used !== 'company' && used !== 'compare') out.push({ kind: 'skill', label: 'Compare the companies', prompt: `/compare ${topic}` });
  if (used !== 'brief' && out.length < 2) out.push({ kind: 'skill', label: 'What is new on this', prompt: `/brief ${topic}` });
  // The lecturer's check, offered, never imposed.
  out.push({ kind: 'check', label: 'Quiz me on this', prompt: `Quiz me on what you just told me about ${topic}: three questions, answers at the end.` });
  if ((i.depth === '3' || used === 'compare' || used === 'argue') && out.length < 4) {
    out.push({ kind: 'agent', label: 'Write it up as a Field Report', prompt: `@field-report ${topic}` });
  }
  return out.slice(0, 3);
}
