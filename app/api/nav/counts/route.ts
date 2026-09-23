import { isAdmin, isPreview } from '@/lib/auth';
import { getNavCounts } from '@/lib/data';

// The rail and mobile-sheet badge counts, refetched by the client on every
// navigation (lib/nav-counts-client.ts). The chrome renders once in the root
// layout since 2026-09-23, so its server-fetched counts would otherwise stay
// frozen until the next full load or server action. Admin-only (a previewing
// admin sees the guest chrome, which has no badges); no-store. Not on the
// proxy allow-list: an admin carries the atlas_admin cookie, and the in-route
// isAdmin() is the real gate.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store' };
  if (!(await isAdmin()) || (await isPreview())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const counts = await getNavCounts();
  return Response.json(counts, { headers });
}
