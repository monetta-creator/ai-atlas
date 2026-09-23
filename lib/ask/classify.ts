import { looksFresh, cleanTopic, type Beat } from './lanes';
import { routedStructured } from '@/lib/model-route';
import { DEFAULT_UTILITY_MODEL } from '@/lib/pipeline/config';

// The lane classifier (2026-09-23): one cheap, parallel call that reads the
// question and says whether it sits on the Atlas's own beat, near it, or off
// it entirely, plus whether it hinges on events too recent for the records.
// Runs in Promise.all beside buildAskContext so it adds no latency; on any
// failure it fails open to the records path (lib/ask/lanes.ts decideLane
// still lets retrieval win when the records actually have something).

const BEATS: Beat[] = ['atlas', 'adjacent', 'unrelated'];

export interface ClassifyResult {
  beat: Beat;
  fresh: boolean;
  topic: string;
}

const FAIL_OPEN: ClassifyResult = { beat: 'atlas', fresh: false, topic: '' };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    beat: { type: 'string', enum: BEATS, description: 'Which beat the question sits on.' },
    fresh: {
      type: 'boolean',
      description:
        'True only if the question hinges on events or figures newer than a few weeks: today\'s news, a current price, "latest", "this week".',
    },
    topic: {
      type: 'string',
      description: 'A two or three word label for the question\'s subject, for use in a decline line. Empty string if the question is on the Atlas beat.',
    },
  },
  required: ['beat', 'fresh', 'topic'],
};

function classifySystem(beatDescription: string): string {
  return `You classify a question against one Atlas's beat before it is answered. The Atlas is a tool for staying oriented in the debate about AI and the economy. Its beat:

${beatDescription}

Classify the question's "beat" as exactly one of:
- atlas: the question is inside that beat, something the Atlas tracks or argues about.
- adjacent: the question is about AI, technology, finance, economics, business, or policy generally, but a subject the Atlas itself would not track (a different company's product, a general tech question, macro news outside AI).
- unrelated: anything else entirely (cooking, sports, personal advice, general coding help, trivia unrelated to AI or the economy).

Also decide "fresh": true only if answering well requires knowing events or figures from the last few weeks (today's news, a current price, "latest", "this week"), false otherwise.

Also write "topic": a two or three word label naming the question's subject, plain words, no punctuation. Leave it an empty string when beat is atlas.

Never use an em dash in any text you write; use a comma or a period instead.`;
}

// `prior` is the previous user turn, when there is one: a bare follow-up
// ("what about Europe?") reads as unrelated on its own and as on-beat next to
// the question it continues. The classifier sees both; the lane rule then
// needs no blanket exemption for follow-ups.
// `feature` is the cost-log slug: the portal route passes its own so the
// classifier call counts toward the portal's daily budget. `metadata` rides
// onto the cost row (the portal route stamps portal_key_id so the per-key
// budget sees the classifier call too).
export async function classifyQuestion(
  question: string, beatDescription: string, prior?: string, feature = 'ask_classify',
  metadata?: Record<string, unknown>,
): Promise<ClassifyResult> {
  const trimmed = question.trim();
  if (!trimmed) return FAIL_OPEN;
  try {
    const out = await routedStructured<{ beat?: unknown; fresh?: unknown; topic?: unknown }>({
      model: DEFAULT_UTILITY_MODEL,
      system: classifySystem(beatDescription),
      user: prior?.trim()
        ? `PREVIOUS QUESTION IN THIS CONVERSATION (context only, classify the new one):\n${prior.trim().slice(0, 600)}\n\nQUESTION:\n${trimmed}`
        : `QUESTION:\n${trimmed}`,
      toolName: 'classify_question',
      toolDescription: 'Report the beat classification for this question.',
      schema: SCHEMA,
      maxTokens: 200,
      timeoutMs: 6000,
      feature,
      metadata,
    });
    const beat: Beat = BEATS.includes(out.beat as Beat) ? (out.beat as Beat) : 'atlas';
    const fresh = out.fresh === true || looksFresh(question);
    const topic = cleanTopic(out.topic);
    return { beat, fresh, topic };
  } catch {
    return FAIL_OPEN;
  }
}
