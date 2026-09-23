import { isAdmin } from '@/lib/auth';
import { markFindingsSeen } from '@/lib/mutations';

// Stamps `seen_at` on findings the drawer just showed, so the pulse's
// `newSince` list (and the toast stack) never repeats them. Admin-only.
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const b = body as { keys?: unknown };
  const keys = Array.isArray(b?.keys) ? b.keys.filter((k): k is string => typeof k === 'string').slice(0, 100) : [];
  if (keys.length) await markFindingsSeen(keys);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
