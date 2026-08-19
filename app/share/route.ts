import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyShareToken, setGuestSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// A public share link: /share?t=<token>[&next=/path]. Verifies the token, enters the
// recipient as a guest (the existing share view — no login), and forwards them on.
// Exempt from the login gate in proxy.ts. Grants only the already-public map.
export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get('t') ?? undefined;
  if (!verifyShareToken(t)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  await setGuestSession();
  const next = req.nextUrl.searchParams.get('next');
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return NextResponse.redirect(new URL(dest, req.url));
}
