import { getChromeViewer } from '@/lib/chrome-viewer';

// The persistent chrome's session probe (components/ViewerSync.tsx): returns
// only the requester's own viewer key, so a tab can notice a sign-out or a
// preview toggle made elsewhere and refresh its chrome. Public by design (a
// guest tab needs it to notice a sign-in), on the proxy.ts API allow-list;
// no data beyond four booleans about the caller's own cookies.
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { key } = await getChromeViewer();
  return Response.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
}
