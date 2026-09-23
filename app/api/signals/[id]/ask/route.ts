import Anthropic from '@anthropic-ai/sdk';
import { isAdmin } from '@/lib/auth';
import { streamQuickAnswer } from '@/lib/ask/quick-stream';
import { buildSignalAskContext } from '@/lib/signal-ask';

// "Ask this signal" streaming endpoint, scoped to one signal. Node runtime (default) is
// required: retrieval uses lib/db's pg pool. Mirrors /api/ask but with a per-signal context
// (its summary, source text, and touched claims) instead of the whole-Atlas retrieval.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';
const TEXT_HEADERS = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  // Admin-only: the proxy admits a guest cookie, so the endpoint is the real gate (this is a
  // live per-question LLM call, deliberately not exposed to guests).
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

  const { id } = await ctx.params;

  let query = '';
  try {
    const body = await req.json();
    if (typeof body?.query === 'string') query = body.query.trim();
  } catch {
    // fall through to the empty-query guard
  }
  if (!query) return new Response('Empty query', { status: 400 });
  if (query.length > 2000) query = query.slice(0, 2000);

  const ctxData = await buildSignalAskContext(id, query);
  if (!ctxData.found) return new Response('Signal not found', { status: 404 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response('AI is not configured.', { status: 500 });
  // Tight timeout, no in-call retries: stay well under the 60s function cap.
  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 0 });

  // No web leg here; the per-turn cost line still rides its trailing sentinel (AskAtlas strips it).
  return new Response(streamQuickAnswer({
    client,
    model: MODEL,
    system: ctxData.system,
    messages: [{ role: 'user', content: ctxData.user }],
    useWeb: false,
    feature: 'signal_ask',
    maxTokens: 1200,
    metadata: { signal_id: id },
  }), { headers: TEXT_HEADERS });
}
