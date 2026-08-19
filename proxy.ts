import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Anyone who hasn't passed the gate (admin or guest) is sent to /login.
// This is only a routing convenience — real authorization is enforced
// server-side by isAdmin() in components and actions.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const entered =
    req.cookies.has('atlas_admin') || req.cookies.has('atlas_guest');
  const isPublic =
    // The lobby is the most visible public surface (guest-safe counts only); the
    // broadsheet dashboard it replaced lives on at /blotter, public like before.
    pathname === '/' ||
    pathname === '/blotter' ||
    pathname === '/login' ||
    pathname === '/share' ||
    pathname === '/about' ||
    pathname.startsWith('/about/') ||
    // Signal Board is public (feed + detail). The admin-only /signals/new, /signals/digest,
    // /signals/drafts, and /signals/<id>/edit stay gated here so the routing layer agrees with
    // the pages' own isAdmin() redirects (defense-in-depth — the pages remain the real boundary).
    pathname === '/signals' ||
    (pathname.startsWith('/signals/') &&
      !pathname.startsWith('/signals/new') &&
      !pathname.startsWith('/signals/digest') &&
      !pathname.startsWith('/signals/drafts') &&
      !pathname.endsWith('/edit')) ||
    // Public read-only report views (the home page links to the latest). The admin
    // generator/editor lives at /report (singular) and stays gated.
    pathname === '/reports' ||
    pathname.startsWith('/reports/') ||
    // Public read-only thesis reports (the share links the /theses console mints).
    // The admin console at /theses stays gated.
    pathname.startsWith('/thesis-report/') ||
    // Public reader surface — the Argument Map and everything it links into. These
    // pages already strip the personal layer server-side for non-admins (guest mode
    // IS the share view: `personal = isAdmin() && !preview`), so they're safe to serve
    // without a session, and none of them self-redirect to /login. Admin-only work
    // (confidence moves, AI generation) lives in actions that each re-check requireAdmin().
    // The admin summary timeline (/q/<slug>/summary) is excluded so it stays gated.
    pathname === '/map' ||
    pathname === '/bridges' ||
    // /bridge/<code> is public; the admin authoring page /bridge/new stays gated.
    (pathname.startsWith('/bridge/') && pathname !== '/bridge/new') ||
    // Concepts (the semantic scaffold) is public like the rest of the reader surface;
    // the admin authoring pages (/concepts/new, /concepts/<slug>/edit) stay gated here,
    // matching the pages' own isAdmin() redirects.
    pathname === '/concepts' ||
    (pathname.startsWith('/concepts/') &&
      !pathname.startsWith('/concepts/new') &&
      !pathname.endsWith('/edit')) ||
    // Retired reader pages (2026-08-13 lobby redesign): these three are redirect
    // stubs now (landscape → /blotter, lens → /map, supply-chain → /traceroute).
    // They stay allow-listed so a sessionless visitor gets the redirect, not /login.
    pathname === '/landscape' ||
    pathname === '/supply-chain' ||
    pathname === '/lens' ||
    // The Research Portal: public read-only funnel output (threads, watchlist,
    // papers). The print digest and the working console's actions stay admin;
    // the pages re-check isAdmin() for every working-layer chunk.
    pathname === '/research' ||
    (pathname.startsWith('/research/') && !pathname.startsWith('/research/digest') && !pathname.startsWith('/research/console')) ||
    // Startup Scout: public read-only watchlist + tracked-company profiles. The
    // working console (queue, runs, verticals) stays admin; its page re-checks
    // isAdmin() and non-tracked companies 404 for guests at the data layer.
    pathname === '/scout' ||
    (pathname.startsWith('/scout/') && !pathname.startsWith('/scout/console')) ||
    // Traceroute is a self-contained explainer: static journey data plus a scripted
    // inference walkthrough. It reads the supply-chain overlay for risk chips, which is
    // stripped server-side for guests, and it never calls a model.
    pathname === '/traceroute' ||
    // Its tokenizer endpoint has to be public too, since the matcher below does not exempt
    // /api. Pure string processing over a length-capped input: no model, no DB, no session.
    pathname === '/api/traceroute/tokenize' ||
    // The Datasets portal: public catalog, dataset pages, and the Ask page (which
    // renders its own inline key-unlock panel instead of bouncing to /login). The
    // download API needs its own entries since the matcher does not exempt /api;
    // the key-gated dataset and the billable Ask endpoint enforce isPortal()
    // in-route, so the routing layer stays a convenience here as everywhere.
    // The Showcase: an unlisted in-app slide deck for live demos. Public but
    // linked from nowhere (no nav entry, robots noindex on the page).
    pathname === '/showcase' ||
    pathname === '/datasets' ||
    pathname.startsWith('/datasets/') ||
    pathname.startsWith('/api/datasets/') ||
    pathname === '/api/portal/ask' ||
    // The unified Ask workspace: public page (locked visitors get the inline
    // key-unlock panel, not a /login bounce) plus its guest-safe citation peek
    // API. /api/ask itself stays OFF this list: it is admin-only and admins
    // always carry the cookie.
    pathname === '/ask' ||
    pathname === '/api/ask/peek' ||
    // The document viewer behind the peek panel. Allow-listed so a portal-key
    // holder (who carries no atlas_admin/atlas_guest cookie) reaches the route;
    // the route itself enforces isPortal() and returns 401 to everyone else.
    pathname === '/api/ask/doc' ||
    // The public ticket intake (bug reports / feature requests from the rail
    // dialogs). The route validates everything; the admin image route stays off
    // this list (admins carry the cookie).
    pathname === '/api/tickets' ||
    pathname.startsWith('/claim/') ||
    // /q/<slug> is public; the admin summary timeline and the claim authoring page stay gated.
    (pathname.startsWith('/q/') && !pathname.endsWith('/summary') && !pathname.endsWith('/claim/new'));

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
