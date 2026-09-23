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
