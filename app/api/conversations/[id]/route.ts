import { chatIdentity } from '@/lib/ask/identity';
import { appendMessage, archiveConversation, getConversation, ownerFor, updateConversation } from '@/lib/conversations/store';

// One conversation (redo P4.1): GET it with its messages, POST a message
// ({role, content, extras?, tagMap?, costUsd?}), PATCH {title?, model?},
// DELETE archives it. Owner-scoped: someone else's id is a 404.
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const c = await getConversation(ownerFor(who.identity), id);
  return c ? Response.json(c) : new Response('Not found', { status: 404 });
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  let b: { role?: unknown; content?: unknown; extras?: unknown; tagMap?: unknown; costUsd?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  if (b.role !== 'user' && b.role !== 'assistant') return new Response('role must be user or assistant', { status: 400 });
  if (typeof b.content !== 'string') return new Response('content must be a string', { status: 400 });
  const extras = b.extras && typeof b.extras === 'object' && !Array.isArray(b.extras) ? (b.extras as Record<string, unknown>) : {};
  const tagMap = b.tagMap && typeof b.tagMap === 'object' && !Array.isArray(b.tagMap)
    ? Object.fromEntries(Object.entries(b.tagMap as Record<string, unknown>).filter(([k, v]) => /^[SPIXRH]\d{1,4}$/.test(k) && typeof v === 'string').slice(0, 2000)) as Record<string, string>
    : {};
  const costUsd = typeof b.costUsd === 'number' && Number.isFinite(b.costUsd) ? b.costUsd : null;
  try {
    const seq = await appendMessage(ownerFor(who.identity), id, { role: b.role, content: b.content, extras, tagMap, costUsd });
    return seq === null ? new Response('Not found', { status: 404 }) : Response.json({ seq }, { status: 201 });
  } catch (e) {
    return new Response((e as Error).message.slice(0, 120), { status: 413 });
  }
}

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  let b: { title?: unknown; model?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    return new Response('Bad body', { status: 400 });
  }
  const patch: { title?: string; model?: string | null } = {};
  if (typeof b.title === 'string') patch.title = b.title;
  if (b.model === null || (typeof b.model === 'string' && b.model.length <= 80)) patch.model = b.model as string | null;
  const ok = await updateConversation(ownerFor(who.identity), id, patch);
  return ok ? Response.json({ ok: true }) : new Response('Not found', { status: 404 });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  const { id } = await ctx.params;
  const ok = await archiveConversation(ownerFor(who.identity), id);
  return ok ? Response.json({ ok: true }) : new Response('Not found', { status: 404 });
}
