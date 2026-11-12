import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { recordApiCall, priceUsage } from '@/lib/cost';
import { deDash } from '@/lib/voice';
import { createTagger } from '@/lib/ask/deep';
import { decide } from '@/lib/decide';
import { estimateTurnUsd, getModel, TIER_DEFAULT, type Tier } from '@/lib/llm/models';
import { askBudget } from '@/lib/ask/budget';
import { budgetVerdict } from '@/lib/ask/budget-policy';
import { runTool } from '@/lib/tools/registry';

// Enhance (redo Phase 4, P4.6): the prework before an answer, shown to the
// reader as a card they can read (not approve). In parallel: the decider
// (model, web, clarify, depth), Claude Haiku 5.5 tidying the ask (dictation
// cleaned up, at most two clarifying questions when the decider says the
// intent is unclear, a three-line plan), and a records prefetch (the top
// search_atlas hits for the tidied question). Admin only for now. Feature
// ask_enhance (counts toward the monthly chat budget). About a cent.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-5-5';
const FEATURE = 'ask_enhance';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['question', 'plan', 'clarify'],
  properties: {
    question: { type: 'string', description: 'The ask rewritten as one clear question or request, keeping every specific the reader gave. Fix dictation errors. Do not add scope they did not ask for.' },
    plan: { type: 'array', items: { type: 'string' }, description: 'Three short lines: what the answer will look up and in what order.' },
    clarify: { type: 'array', items: { type: 'string' }, description: 'At most two clarifying questions, ONLY if told the intent is unclear; otherwise empty.' },
  },
};

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });
  let body: { query?: unknown; prev?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty-body guard below
  }
  const raw = typeof body.query === 'string' ? body.query.trim().slice(0, 4000) : '';
  if (!raw) return new Response('Empty query', { status: 400 });
  const prev = typeof body.prev === 'string' ? body.prev.slice(0, 2000) : undefined;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });

  const t0 = Date.now();
  // Records prefetch starts at once on the raw ask (no model call), over the
  // dated kinds a reader wants to see first.
  const tagger = createTagger({}, 0);
  const foundP = runTool('search_atlas', { query: raw, kinds: ['signal', 'item', 'fact', 'paper', 'report'], limit: 2 }, { identity: { kind: 'admin' }, tagger });
  const [ds, budget] = await Promise.all([decide({ text: raw, prevUser: prev }, undefined, { log: true }), askBudget()]);
  const unclear = ds.needs_clarify?.answer === 'yes' || (ds.needs_clarify?.probs.yes ?? 0) >= 0.5;

  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
  const tidyP = client.messages.create({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: 'You prepare a question for an AI research assistant used by a practitioner leading AI adoption at a regulated financial institution. The assistant answers from a curated, dated database of AI developments (news, filings, papers, company facts, an argument map) plus optional web search. Never use an em dash.',
    messages: [{ role: 'user', content: `${prev ? `Their previous question: """${prev}"""\n` : ''}Their ask, possibly dictated: """${raw}"""\n\nThe intent is ${unclear ? 'UNCLEAR: include up to two short clarifying questions' : 'clear: leave clarify empty'}.` }],
  });
  const tidy = await tidyP;
  await recordApiCall({ feature: FEATURE, model: MODEL, usage: tidy.usage, wallMs: Date.now() - t0, metadata: { enhance: true } });
  let parsed: { question: string; plan: string[]; clarify: string[] } = { question: raw, plan: [], clarify: [] };
  const text = tidy.content.find((b) => b.type === 'text');
  if (text && text.type === 'text') {
    try {
      const j = JSON.parse(text.text) as typeof parsed;
      parsed = { question: deDash(String(j.question || raw)), plan: (j.plan ?? []).slice(0, 3).map((s) => deDash(String(s))), clarify: (j.clarify ?? []).slice(0, 2).map((s) => deDash(String(s))) };
    } catch {
      // keep the raw ask
    }
  }

  const found = await foundP;
  const records = found.isError ? [] : found.text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('[')).slice(0, 5).map((l) => (l.length > 160 ? `${l.slice(0, 157)}...` : l));

  const wanted = (ds.model_tier?.answer ?? 'cheap') as Tier;
  const verdict = budgetVerdict(budget, wanted, false);
  const model = getModel(TIER_DEFAULT[verdict.tier])!;
  const enhanceUsd = await priceUsage(MODEL, tidy.usage);
  return Response.json({
    question: parsed.question,
    plan: parsed.plan,
    clarify: parsed.clarify,
    records,
    decision: {
      model: model.id,
      label: model.label,
      tier: model.tier,
      web: ds.needs_web?.answer === 'yes',
      depth: ds.depth?.answer ?? '2',
      reason: `judge: ${Object.entries(ds.model_tier?.probs ?? {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`,
      estUsd: estimateTurnUsd(model),
      budgetMessage: verdict.message,
    },
    enhanceUsd,
    ms: Date.now() - t0,
  });
}
