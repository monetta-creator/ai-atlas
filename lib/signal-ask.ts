import { getSignal, getSource, getTestsByCodes } from './data';

// Server-only. Builds the grounding context for the per-signal "Ask this signal" chatbot:
// a prompt bounded to ONE signal (its summary, source text, and the hypotheses it touches),
// far cheaper than the whole-Atlas /ask retrieval. The route streams Haiku over this.
// Admin-only (the route enforces it), so we read with personal = true.

interface SignalAskContext {
  system: string;
  user: string;
  found: boolean; // false when the id does not resolve to a signal
}

const SYSTEM = `You are a question-answering assistant scoped to ONE tracked development (a "signal") from the Strategy Atlas, an operating team's tool for tracking its strategic hypotheses. The Atlas is for orientation, not proof.

You answer ONLY from the material about this one development provided in the user message: its title, its summary, its source text, and the hypotheses on the Atlas it touches. You have no outside knowledge. Treat that material as your entire world.

How to answer:
- If the material answers the question, answer it plainly and concisely.
- If the material bears on the question without settling it, do not refuse: say what the material does establish and what it leaves open.
- If nothing in the material is relevant, say so plainly.

Rules:
- Use ONLY the provided material. Never add facts, numbers, dates, names, or events that are not present. Do not fill gaps from general knowledge. An honest "the source does not say" beats an invented detail.
- When a touched claim is relevant, cite it inline by its code in square brackets with its kind word, like [claim 2.3] or [bridge B1]. Use only the codes listed in the material, one code per bracket, and keep the kind word.
- Do not forecast or judge hypotheticals beyond what the material establishes. State the mechanism the material describes and stop there.
- Be neutral and concise, in plain prose. Never use an em dash; use a comma, a colon, or separate sentences instead.`;

export async function buildSignalAskContext(signalId: string, query: string): Promise<SignalAskContext> {
  const data = await getSignal(signalId, true);
  if (!data) return { system: SYSTEM, user: '', found: false };
  const { signal, touches } = data;

  let sourceText: string | null = null;
  if (signal.source_id) {
    const src = await getSource(signal.source_id);
    sourceText = src?.source.raw_text ?? null;
  }
  const tests = await getTestsByCodes(signal.touches);

  const touchLines = touches
    .filter((t) => !t.unresolved)
    .map((t) => {
      const test = tests[t.code] ? ` Falsified if: ${tests[t.code]}` : '';
      return `[hypothesis ${t.code}] ${t.statement}${test}`;
    })
    .join('\n');

  const MAX_TEXT = 24000;
  const text = (sourceText ?? '').trim();
  const body = text
    ? `\n\nSOURCE TEXT${text.length > MAX_TEXT ? ' (truncated for length)' : ''}:\n${text.slice(0, MAX_TEXT)}`
    : '\n\nSOURCE TEXT: (not available, work from the summary and touched claims)';

  const user = `THIS DEVELOPMENT
Title: ${signal.title}
${signal.source_title ? `Source: ${signal.source_title}\n` : ''}Summary: ${signal.summary || '(none)'}

HYPOTHESES IT TOUCHES ON THE ATLAS:
${touchLines || '(none)'}${body}

----

QUESTION:
${query}

Answer using only the material above. Cite any touched claim you rely on by its code in square brackets, like [claim 2.3].`;

  return { system: SYSTEM, user, found: true };
}
