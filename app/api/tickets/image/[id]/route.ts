import type { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/auth';
import { getTicketImage } from '@/lib/data';

// Ticket screenshots, admin-only (the reporter's uploads are for the desk, not
// the public). Not on the proxy allow-list: admins carry a cookie, everyone
// else bounces at the proxy and 404s here regardless.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id) || !(await isAdmin())) return new Response('Not found', { status: 404 });
  const img = await getTicketImage(id);
  if (!img) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: { 'content-type': img.content_type, 'cache-control': 'private, max-age=3600' },
  });
}
