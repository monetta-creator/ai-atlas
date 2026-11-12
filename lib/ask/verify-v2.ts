// The v2 faithfulness check's model layer: Claude Haiku 5.5 with structured
// output (forced tool_choice 400s on the 5.5 models). One separate call over
// the gathered records and the Atlas-grounded part of the answer; the
// deterministic quote/figure layer (runDeterministicChecks) runs beside it.
import Anthropic from '@anthropic-ai/sdk';
import { recordApiCall } from '../cost';
import { parseVerifyOutput, VERIFY_INSTRUCTION, VERIFY_SYSTEM } from './deep';

export const VERIFY_MODEL = 'claude-haiku-5-5';
const CORPUS_CHARS = 120_000;

export const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checked', 'flags', 'verdict_language'],
  properties: {
    checked: { type: 'integer', description: 'How many citation-bearing statements in the answer were examined.' },
    flags: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['excerpt', 'issue'],
        properties: {
          excerpt: { type: 'string', description: 'The first words of the unsupported statement, at most 120 characters.' },
          issue: { type: 'string', description: 'One sentence: what the cited record actually says, or why the statement is unsupported.' },
        },
      },
    },
    verdict_language: { type: 'array', items: { type: 'string' } },
  },
};

export async function verifyV2(opts: {
  corpus: string[];
  question: string;
  answer: string;
  feature: string;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<ReturnType<typeof parseVerifyOutput> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !opts.answer.trim()) return null;
  const client = new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 25_000, maxRetries: 0 });
  let records = opts.corpus.join('\n\n---\n\n');
  if (records.length > CORPUS_CHARS) records = records.slice(0, CORPUS_CHARS);
  const t0 = Date.now();
  const res = await client.messages.create({
    model: VERIFY_MODEL,
    max_tokens: 1500,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: VERIFY_SCHEMA } },
    system: VERIFY_SYSTEM.replace(' Report only through the submit_verification tool.', ' Report as the JSON object requested.'),
    messages: [
      {
        role: 'user',
        content: `RECORDS gathered for this answer:\n\n${records || '(none)'}\n\n----\n\nQUESTION:\n${opts.question}\n\nANSWER:\n${opts.answer}\n\n----\n\n${VERIFY_INSTRUCTION.replace(' Report through submit_verification:', ' Report:')}\n\nA flag is a PROBLEM only: an unsupported, misattributed, or wrong statement. Never list a supported statement as a flag; when everything checks out, flags is an empty array.`,
      },
    ],
  });
  await recordApiCall({ feature: opts.feature, model: VERIFY_MODEL, usage: res.usage, wallMs: Date.now() - t0, metadata: { ...(opts.metadata ?? {}), round: 'verify' } });
  const block = res.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  try {
    const parsed = parseVerifyOutput(JSON.parse(block.text));
    return parsed ? { ...parsed, flags: parsed.flags.filter((f) => !isNonFlag(f.issue)) } : null;
  } catch {
    return null;
  }
}

// Haiku 5.5 sometimes reports a checked-and-fine statement as a flag
// ("Supported: ... no mismatch"). Those are not problems; drop them.
export function isNonFlag(issue: string): boolean {
  return /^\s*(supported|accurate|correct|consistent|verified|faithful)\b/i.test(issue) || /\bno (mismatch|issue|discrepancy|problem)s? (found|identified)\b/i.test(issue);
}
