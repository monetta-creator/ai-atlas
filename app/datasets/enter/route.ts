import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkPortalKey, setPortalSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// One-link team onboarding: /datasets/enter?k=<team key>. Verifies the shared
// key, sets the signed portal cookie, and lands on the unified Ask workspace;
// a wrong or missing key fails quietly onto its unlock panel (never a /login
// redirect, which corporate networks flag). Mirrors app/share/route.ts. The key
// rides in the query string exactly as the share token does; same accepted
// tradeoff, rotated via the PORTAL_KEY env.
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get('k') ?? '';
  if (k && checkPortalKey(k)) await setPortalSession();
  return NextResponse.redirect(new URL('/ask', req.url));
}
