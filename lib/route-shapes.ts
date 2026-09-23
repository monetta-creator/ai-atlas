// Shape checks for the dynamic detail routes, run in proxy.ts BEFORE the page
// renders. Every page streams behind the root loading.tsx, and once a stream
// starts the status is locked at 200 (Next 16, loading.md "Status Codes"):
// a notFound() inside the page renders the not-found UI with a noindex tag
// but a 200. A malformed id (not a UUID, an impossible date) can be rejected
// here with no database round trip, so it gets a real 404; it also keeps a
// junk id from reaching Postgres as a uuid cast (which errored the signal,
// scout and source pages instead of 404ing). A well-formed id that does not
// exist still gets the streamed not-found page; checking existence here would
// add a query to every detail-page click. Pure and dependency-free (the proxy
// imports it; scripts/test-route-shapes.mjs tests it).
//
// Also holds the proxy's public-API allow-list (PUBLIC_API_PATHS/PREFIXES,
// isPublicApiPath): every /api/* route with no in-route session check of its
// own must be reachable without the atlas_admin/atlas_guest cookie via one of
// these entries, and every route.ts under app/api NOT covered by one of them
// must gate itself in-route (scripts/test-api-gates.mjs walks app/api and
// checks both directions).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Detail routes keyed by a UUID: the prefix, and the static sibling segments
// that live next to [id] (they must never be judged as ids).
const UUID_ROUTES: { prefix: string; statics: string[] }[] = [
  { prefix: '/signals', statics: ['new', 'drafts', 'digest'] },
  { prefix: '/research', statics: ['console', 'digest', 'threads'] },
  { prefix: '/scout', statics: ['console'] },
  { prefix: '/source', statics: [] },
  { prefix: '/theses', statics: ['new'] },
  { prefix: '/thesis-report', statics: [] },
  { prefix: '/reports/sheet', statics: [] },
  { prefix: '/reports', statics: ['period', 'sheet'] },
];

export function isRealDay(s: string): boolean {
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// True when the path is a detail route whose id segment cannot exist.
export function isMalformedDetailPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const { prefix, statics } of UUID_ROUTES) {
    if (!path.startsWith(`${prefix}/`)) continue;
    const seg = path.slice(prefix.length + 1).split('/')[0];
    if (!seg || statics.includes(seg)) return false;
    return !UUID_RE.test(seg);
  }
  if (path.startsWith('/blotter/')) {
    const seg = path.slice('/blotter/'.length).split('/')[0];
    if (!seg || seg === 'archive' || seg === 'desk') return false;
    return !isRealDay(seg);
  }
  // The company intel deck: /intel/deck (latest) and /intel/deck/<day>[/pdf].
  if (path.startsWith('/intel/deck/')) {
    const seg = path.slice('/intel/deck/'.length).split('/')[0];
    if (!seg || seg === 'none') return false; // 'none' = the empty-state plate /intel/deck redirects to
    return !isRealDay(seg);
  }
  return false;
}

// The proxy's public-API allow-list. EXACT pathname matches; a route whose
// gate is "everything under this prefix" (datasets downloads, the cron
// routes) goes in PUBLIC_API_PREFIXES instead. Every entry here still gates
// ITSELF in-route (isPortal()/identityFromRequest()/cronGate()/full in-route
// validation) — this list only controls whether the proxy's session-presence
// check applies before the route is even reached.
export const PUBLIC_API_PATHS: readonly string[] = [
  '/api/traceroute/tokenize',
  '/api/ask/peek',
  '/api/ask/doc',
  '/api/tooling/events',
  '/api/nav/viewer',
  '/api/tickets',
  '/api/access/request',
];

// Prefix matches (pathname.startsWith(prefix)); each ends in '/' so a
// same-named sibling route (there is none today) could never collide.
export const PUBLIC_API_PREFIXES: readonly string[] = [
  '/api/datasets/',
  // The portal surface: ask, saved views, the natural-language query. Every
  // route under it gates in-route on identityFromRequest (scripts/test-api-gates.mjs).
  '/api/portal/',
  '/api/cron/',
];

export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.includes(pathname) || PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p));
}
