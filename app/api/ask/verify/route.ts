import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { q } from '@/lib/db';
import { recordApiCall } from '@/lib/cost';
import { loadNamespace } from '@/lib/ask/retrieve';
import { parseCitations, type CitationKind, type ValidIdsPlain } from '@/lib/ask/verify';
import { fetchRecord, type PeekKind } from '@/lib/ask/search';
import { skeletonBlock } from '@/lib/ask/prompt';
import {
  VERIFY_INSTRUCTION, VERIFY_SYSTEM, VERIFY_TOOL, type VerifyReport,
  createTagger, parseSignalMap, parseVerifyOutput, renderRecord, runDeterministicChecks,
} from '@/lib/ask/deep';

// On-demand answer verification for the quick Ask path ("Check this answer").
// The client sends a finished answer plus its frozen signal map; the server
// fetches EVERY record the answer cites (the exact material to be faithful
// to), runs the deterministic quote/figure checks, and asks Haiku to judge
// per-statement faithfulness with a forced tool. Deep mode has its own
// always-on copy of this inside /api/ask/deep, where the gathered tool
// results are already in hand.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';
const FEATURE = 'ask_verify';
const MAX_RECORDS = 12;

const KIND_TO_PEEK: Record<CitationKind, PeekKind> = {
  claim: 'claim', bridge: 'bridge', stance: 'stance', Q: 'question', concept: 'concept', signal: 'signal',
  paper: 'paper', thread: 'thread',
};

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

  let body: { question?: unknown; answer?: unknown; signalMap?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // fall through to the shape guard
  }
  const answer = typeof body.answer === 'string' ? body.answer.trim().slice(0, 10_000) : '';
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 2_000) : '';
  if (!answer) return new Response('Empty answer', { status: 400 });
  const map = parseSignalMap(body.signalMap);

  const ns = await loadNamespace();
  const idsPlain: ValidIdsPlain = {
    claims: [...ns.validIds.claims],
    bridges: [...ns.validIds.bridges],
    stances: [...ns.validIds.stances],
    questions: [...ns.validIds.questions],
    concepts: [...ns.validIds.concepts],
    threads: [...ns.validIds.threads],
    stanceToQuestion: ns.stanceToQuestion,
  };

  // Every valid citation in the answer, deduped, becomes verification corpus.
  const cited = new Map<string, { kind: CitationKind; id: string }>();
  for (const span of parseCitations(answer, idsPlain, map)) {
    for (const c of span.codes) {
      if (!c.valid) continue;
      const key = `${c.kind}:${c.id}`;
      if (!cited.has(key) && cited.size < MAX_RECORDS) cited.set(key, { kind: c.kind, id: c.id });
    }
  }

  const tagger = createTagger(map, 0);
  const corpus: string[] = [ns.skeleton];
  const recordBlocks: string[] = [];
  for (const { kind, id } of cited.values()) {
    const dbId = kind === 'signal' || kind === 'paper' ? map[id] : id;
    if (!dbId) continue;
    const payload = await fetchRecord(q, KIND_TO_PEEK[kind], dbId, { admin: true });
    if (!payload) continue;
    const block = renderRecord(payload, id, tagger.tagFor);
    corpus.push(block);
    recordBlocks.push(block);
  }

  let report: VerifyReport = { flags: [], ...runDeterministicChecks(answer, corpus) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (recordBlocks.length && apiKey) {
    try {
      const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
      const t0 = Date.now();
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 700,
        system: [{ type: 'text', text: VERIFY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [VERIFY_TOOL],
        tool_choice: { type: 'tool', name: VERIFY_TOOL.name },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: skeletonBlock(ns), cache_control: { type: 'ephemeral' } },
              {
                type: 'text',
                text: `RECORDS, the material the answer cites:\n\n${recordBlocks.join('\n\n')}\n\n----\n\nQUESTION:\n${question || '(not provided)'}\n\nANSWER TO CHECK:\n${answer}\n\n----\n\n${VERIFY_INSTRUCTION}`,
              },
            ],
          },
        ],
      });
      await recordApiCall({
        feature: FEATURE, model: MODEL, usage: res.usage, wallMs: Date.now() - t0,
        metadata: { records: recordBlocks.length },
      });
      const tu = res.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === VERIFY_TOOL.name
      );
      const parsed = tu ? parseVerifyOutput(tu.input) : null;
      if (parsed) report = { ...report, ...parsed };
    } catch {
      // model leg unavailable; the deterministic report still ships
    }
  }

  return Response.json({ verify: report }, { headers: { 'Cache-Control': 'no-store' } });
}
