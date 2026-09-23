import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Open by default (2026-09-23). Every PAGE renders sessionless now: admin
// pages gate themselves with adminGate() (lib/admin-gate.tsx) and render an
// "admin only" notice instead of bouncing here, and the personal layer was
// already stripped server-side for non-admins everywhere it matters
// (personal = isAdmin() && !preview). isAdmin() in components and actions
// remains the real authorization boundary; this file is routing only, and
// now fences exactly one thing: API routes that have no in-route session
// check of their own. Every non-API path is public; under /api, only the
// listed prefixes are (each of those enforces its own gate in-route: Bearer
// CRON_SECRET for /api/cron/*, isPortal() for the datasets/portal/ask
// routes, full in-route validation for /api/tickets).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const entered =
    req.cookies.has('atlas_admin') || req.cookies.has('atlas_guest');
  const isPublic =
    !pathname.startsWith('/api/') ||
    pathname === '/api/traceroute/tokenize' ||
    pathname.startsWith('/api/datasets/') ||
    pathname === '/api/portal/ask' ||
    pathname === '/api/ask/peek' ||
    pathname === '/api/ask/doc' ||
    pathname === '/api/tooling/events' ||
    pathname === '/api/nav/viewer' ||
    pathname === '/api/tickets' ||
    pathname.startsWith('/api/cron/');

  if (!entered && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Static images are never auth-gated (the showcase's screen grabs must load
  // for sessionless demo guests), matching the existing .svg carve-out.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg|.*\\.png|.*\\.jpg).*)'],
};
