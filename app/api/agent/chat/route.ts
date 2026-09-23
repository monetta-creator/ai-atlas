import { isAdmin } from '@/lib/auth';
import { runAgentChat } from '@/lib/agent/chat';
import type { AgentChatMessage } from '@/lib/agent/types';

// The Atlas Agent's chat: a bounded JSON step loop (lib/agent/chat.ts) over
// read-only diagnostic tools plus the ability to trigger a propose-tier
// remedy when Kevin asks. NDJSON response, same shape as /api/ask/deep.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NDJSON_HEADERS = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' };
const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

function parseMessages(body: unknown): AgentChatMessage[] | null {
  const b = body as { messages?: unknown };
  if (!Array.isArray(b?.messages) || !b.messages.length) return null;
  const out: AgentChatMessage[] = [];
  for (const raw of b.messages.slice(-MAX_MESSAGES)) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as { role?: unknown; text?: unknown };
    const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : null;
    const text = typeof m.text === 'string' ? m.text.trim().slice(0, MAX_CHARS) : '';
    if (!role || !text) continue;
    out.push({ role, text });
  }
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return out;
}

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdmin())) return new Response('Unauthorized', { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // fall through to the empty-body guard
  }
  const messages = parseMessages(body);
  if (!messages) return new Response('Empty or malformed messages.', { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (line: string) => {
        try {
          controller.enqueue(enc.encode(line));
        } catch {
          // client gone
        }
      };
      try {
        await runAgentChat(messages, emit);
      } catch {
        emit(`${JSON.stringify({ type: 'error', message: 'The agent could not finish. Please try again.' })}\n`);
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
