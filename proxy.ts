import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isMalformedDetailPath } from './lib/route-shapes';

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
  // A detail URL whose id cannot exist (not a UUID, an impossible date) gets a
  // real 404 here, before the page streams behind loading.tsx and the status
  // is locked at 200 (lib/route-shapes.ts). Rewriting to a path with no route
  // falls through to Next's default not-found page with a 404 status (there
  // is no app/not-found.tsx).
  if (isMalformedDetailPath(req.nextUrl.pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/_not-found-malformed';
    return NextResponse.rewrite(url);
  }
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
    pathname === '/api/access/request' ||
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
