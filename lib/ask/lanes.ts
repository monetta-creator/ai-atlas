// Ask lanes (2026-09-23): every question is classified before the model
// answers, and the lane decides what the answer may draw on and how the
// client labels it. Pure and client-safe (the client renders the chip, the
// Beyond block and the decline card from these same definitions).

export type Lane = 'covered' | 'thin' | 'adjacent' | 'unrelated';
export type Beat = 'atlas' | 'adjacent' | 'unrelated';

export const LANE_LABEL: Record<Lane, string> = {
  covered: 'Covered by the Atlas',
  thin: 'Partly covered',
  adjacent: 'Outside the Atlas records',
  unrelated: "Not the Atlas's beat",
};

// The model writes this on its own line where the Atlas-grounded part of an
// answer ends and its own knowledge (or the web) begins. Everything after it
// renders in the Beyond block: no citation pills, a provenance kicker, and
// the verifier never reads it.
export const BEYOND_MARKER = '@@BEYOND@@';

// Plain-route sentinel for a coded decline (no model call): the body is this
// marker followed by a JSON DeclinePayload. The deep route sends it as an
// NDJSON event of type 'decline' instead.
export const DECLINE_MARKER = '@@ASK_DECLINE@@';

export interface LaneSignals {
  hitCount: number;      // retrieval blocks that matched
  maxRank: number;       // best ts_rank across the FTS legs, 0 when none
  explicit: boolean;     // the question named a claim code, concept or question slug
  beat: Beat;            // the classifier's read of the subject
  followUp: boolean;     // not the conversation's first turn (the classifier saw the prior turn)
}

// Records win over the classifier: if the Atlas has anything on it, we
// orient from the records. The classifier only decides between "adjacent"
// (on our beat or near it, nothing tracked) and "unrelated" when retrieval
// found nothing. A follow-up turn never declines: the conversation already
// established relevance, so the floor is adjacent.
// Thresholds on Postgres ts_rank with length normalization 1 (the FTS legs
// use ts_rank(..., 1)); the OR-query matches many records on generic tokens,
// so hitCount alone is noise (a pasta question matched 24 records in the
// first live test). Rank is the discriminator; the classifier breaks ties.
// Rank bars measured on the live corpus (2026-09-23, deep route lane reason):
// core questions peaked at 0.064 (open-weight parity), 0.049 (entry-level
// hiring) and 0.034 (chip export controls); an adjacent one ("data centers
// and local water") at 0.037; a fresh news question ("what did Nvidia
// announce this week") at 0.028, "how is the Fed thinking about AI" at
// 0.029; an unrelated one ("best pasta recipe") still matched 24 blocks at
// 0.015. Hit counts are noise, rank is the signal. STRONG covers on rank alone; MID covers when
// the classifier also places the question on the Atlas's beat; WEAK is the
// floor below which hits are treated as noise.
export const STRONG_RANK = 0.06;
export const MID_RANK = 0.03;
export const WEAK_RANK = 0.02;

export function decideLane(s: LaneSignals): Lane {
  if (s.explicit) return 'covered';
  // Off the beat with only noise-level matches declines, first turn or not:
  // the classifier judged the question next to the previous one, so a bare
  // follow-up that continues the thread does not land here. On a follow-up
  // the retrieval also carries the earlier turns' records (pasta ranked 0.025
  // after an export-controls question, 0.015 alone), so the noise floor rises
  // to the MID bar there.
  if (s.beat === 'unrelated' && s.maxRank < (s.followUp ? MID_RANK : WEAK_RANK)) return 'unrelated';
  if (s.beat === 'unrelated' && !s.followUp && s.maxRank < STRONG_RANK) return 'unrelated';
  if (s.maxRank >= STRONG_RANK) return 'covered';
  if (s.beat === 'atlas' && s.maxRank >= MID_RANK) return 'covered';
  if (s.hitCount >= 1 && s.maxRank >= WEAK_RANK) return 'thin';
  if (s.beat === 'unrelated' && !s.followUp) return 'unrelated';
  return 'adjacent';
}

// A code-side recency cue, OR'd with the classifier's judgment: the cheap
// model under-flags "this week" style questions.
export const FRESH_RE = /\b(this (week|month|morning|year)|today|tonight|yesterday|last (week|night|month)|latest|newest|just (announced|released|launched|reported)|recently|currently|right now|breaking|as of now|what did .* (announce|report|release|say))\b/i;
export function looksFresh(question: string): boolean {
  return FRESH_RE.test(question);
}

export function splitBeyond(text: string): { atlas: string; beyond: string | null } {
  const i = text.indexOf(BEYOND_MARKER);
  if (i < 0) return { atlas: text, beyond: null };
  const atlas = text.slice(0, i).trimEnd();
  const beyond = text.slice(i + BEYOND_MARKER.length).replaceAll(BEYOND_MARKER, '').trim();
  return { atlas, beyond: beyond.length ? beyond : null };
}

export interface DeclinePayload {
  topic: string;
  headline: string;
  body: string;
  questions: { title: string; href: string }[];
  starters: string[];
}

// The coded decline: dry, short, and useful. No model call writes this.
export function composeDecline(
  topic: string,
  questions: { title: string; href: string }[],
  starters: string[]
): DeclinePayload {
  const t = topic.trim().replace(/[.!?]+$/, '');
  const subject = t ? t[0].toUpperCase() + t.slice(1) : 'That';
  return {
    topic: t,
    headline: 'Not my beat.',
    body: `The Atlas maps one argument: the AI economy, and what would settle it. ${subject} is outside that map, and a general chatbot will serve you better there. Here is what I can actually help with:`,
    questions: questions.slice(0, 7),
    starters: starters.slice(0, 3),
  };
}

export function encodeDecline(p: DeclinePayload): string {
  return `${DECLINE_MARKER}${JSON.stringify(p)}`;
}

export function extractDecline(text: string): { text: string; decline: DeclinePayload | null } {
  const i = text.indexOf(DECLINE_MARKER);
  if (i < 0) return { text, decline: null };
  try {
    const decline = JSON.parse(text.slice(i + DECLINE_MARKER.length)) as DeclinePayload;
    return { text: text.slice(0, i), decline };
  } catch {
    return { text: text.slice(0, i), decline: null };
  }
}

// ---- Prompt addenda (server-side; kept here so the marker and the voice of
// the lane never drift from the client's rendering) --------------------------

export const ASK_PERSONA = `You are the Atlas's desk editor. You have read everything the Atlas tracks and nothing else, and you say so plainly when a question runs past the records. Even-handed, plain, unhurried. The Atlas is for orientation, not proof: help the reader find where the relevant thinking lives and point them to it; never hand down a verdict. You never pretend the Atlas covers what it does not, and you never apologize for what it does not cover.`;

export function laneAddendum(lane: Lane, opts: { web: boolean; fresh: boolean }): string {
  const source = opts.web
    ? 'the web (search first; attribute each point to its outlet in prose; never put a web source in brackets). Everything you learned from the web belongs BELOW the marker: above it, only the Atlas records, even if they say little'
    : 'your own general knowledge (it is not current and it is not the Atlas; hedge dates and figures, and say when something may have changed since your training)';
  const label = opts.web
    ? 'The first line of that section must be exactly: "From the web, not the Atlas records."'
    : 'The first line of that section must be exactly: "From the model\'s own knowledge, not the Atlas records, and not current."';
  const fresh = opts.fresh && !opts.web
    ? ' The question asks about recent events and no web search is available: say clearly that your knowledge may be out of date.'
    : '';
  if (lane === 'thin') {
    return `LANE: the records only partly cover this question. First orient from the records, citing them by ID as the rules above require, and say plainly which part they do not settle. Then, on its own line, write ${BEYOND_MARKER} and continue with what the records leave open, drawing on ${source}. ${label} Inside that section: no bracket citations, no invented figures, short.${fresh}`;
  }
  if (lane === 'adjacent') {
    return `LANE: nothing in the Atlas tracks this question. Open with one plain sentence saying so (name the closest Atlas topic by record ID only if one is genuinely close). Then, on its own line, write ${BEYOND_MARKER} and answer from ${source}. ${label} Inside that section: no bracket citations, no invented figures, four to eight sentences.${fresh}`;
  }
  return '';
}

// The records-only scope sentence, relaxed only below the marker.
export const SCOPE_WITH_BEYOND = `Above the ${BEYOND_MARKER} line you answer ONLY from the Atlas records provided and have no outside knowledge; below it (and only when a LANE instruction asks for it) you may draw on the source the LANE names, clearly labeled.`;

// The previous user turn's text, for the classifier's context. Wire messages
// carry `content` as a string (lib/ask/history.ts).
export function priorUserTurn(msgs: { role: string; content: string }[]): string | undefined {
  const users = msgs.filter((m) => m.role === 'user');
  return users.length > 1 ? users[users.length - 2]?.content : undefined;
}
