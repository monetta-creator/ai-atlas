import { chatIdentity } from '@/lib/ask/identity';
import { createConversation, listConversations, ownerFor } from '@/lib/conversations/store';

// Server-side conversations (redo P4.1): list (GET) and create (POST) for the
// caller's own owner ('admin' or 'key:<id>'). Gated in-route by chatIdentity
// (admin cookie or an access key); guests get 401.
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  return Response.json({ conversations: await listConversations(ownerFor(who.identity)) });
}

export async function POST(req: Request): Promise<Response> {
  const who = await chatIdentity(req);
  if (!who) return new Response('Unauthorized', { status: 401 });
  let body: { title?: unknown; model?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // defaults below
  }
  const title = typeof body.title === 'string' ? body.title : '';
  const model = typeof body.model === 'string' && body.model.length <= 80 ? body.model : null;
  const id = await createConversation(ownerFor(who.identity), title, model);
  return Response.json({ id }, { status: 201 });
}
