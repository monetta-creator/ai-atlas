// The Atlas's ONE navigation tree (2026-09-23). The rail, the mobile sheet,
// the page-top tabs and pathway, and the "admin only" notice all read this
// file, so a page moves or gains a sibling in exactly one place. Pure and
// client-safe: no db, no auth; callers pass the viewer.

export type Access = 'public' | 'portal' | 'admin';
export type BadgeKey = 'pipeline' | 'drafts' | 'papers' | 'scout' | 'tickets' | 'tooling' | 'access' | 'agent';

export interface NavViewer {
  admin: boolean;
  portal: boolean;
}

export interface NavLeaf {
  href: string;
  label: string;
  access: Access;
  badge?: BadgeKey;
  also?: string[];          // extra prefixes that count as "this leaf" (e.g. /ingest under Sources)
  hidden?: boolean;         // reachable, listed nowhere (print pages, decks)
}

export interface NavGroup {
  key: string;
  href: string;             // the hub the group name links to
  label: string;
  icon: string;             // key into PORTAL_ICONS / NAV_ICONS
  access: Access;
  children: NavLeaf[];      // in display order: public/portal leaves first, then admin leaves
  detailPrefixes?: string[]; // paths that belong to the group without being a leaf (/claim/, /q/ ...)
}

export const NAV_TREE: NavGroup[] = [
  { key: 'home', href: '/', label: 'Home', icon: 'home', access: 'public', children: [] },
  // The portals directory (2026-09-26): the rail shows ONE "Portals" entry
  // whose accordion lists every portal hub; each portal's sub-pages appear as
  // the page's own tabs (PageTop), not in the rail. /portals is the page form
  // of that list. Not a portal itself: PORTAL_GROUP_KEYS below names those.
  { key: 'portals', href: '/portals', label: 'Portals', icon: 'portals', access: 'public', children: [] },
  {
    key: 'signals', href: '/signals', label: 'Signal Board', icon: 'signals', access: 'public',
    detailPrefixes: ['/signals/'],
    children: [
      { href: '/signals', label: 'Board', access: 'public' },
      { href: '/signals/drafts', label: 'Drafts', access: 'admin', badge: 'drafts' },
      { href: '/signals/new', label: 'New signal', access: 'admin' },
      { href: '/signals/digest', label: 'Digest', access: 'admin' },
    ],
  },
  {
    key: 'blotter', href: '/blotter', label: 'News Blotter', icon: 'blotter', access: 'public',
    detailPrefixes: ['/blotter/'],
    children: [
      { href: '/blotter', label: "Today's edition", access: 'public' },
      { href: '/blotter/archive', label: 'Archive', access: 'public' },
      { href: '/pipeline', label: 'Pipeline', access: 'admin', badge: 'pipeline' },
      { href: '/scan', label: 'Scan', access: 'admin' },
      { href: '/intel', label: 'Intel', access: 'admin' },
      { href: '/ingestion', label: 'Ingestion', access: 'admin', also: ['/ingestion/'] },
    ],
  },
  {
    // Savant, the autonomous weekly research report, is its own imprint and
    // its own group (2026-09-26): the issue for keyholders, the archive, and
    // the admin desk that runs it. Guests see the group and the teaser.
    key: 'savant', href: '/savant', label: 'Savant', icon: 'savant', access: 'public',
    detailPrefixes: ['/savant/'],
    children: [
      { href: '/savant', label: 'Latest issue', access: 'portal' },
      { href: '/savant/archive', label: 'Archive', access: 'portal' },
      { href: '/savant/record', label: 'Company record', access: 'portal' },
      { href: '/savant/desk', label: 'Desk', access: 'admin' },
    ],
  },
  {
    key: 'map', href: '/map', label: 'Claims & Theses', icon: 'claims', access: 'public',
    detailPrefixes: ['/claim/', '/q/', '/bridge/', '/concepts/', '/thesis-report/', '/theses/', '/source/'],
    children: [
      { href: '/map', label: 'Map', access: 'public' },
      { href: '/bridges', label: 'Bridges', access: 'public' },
      { href: '/concepts', label: 'Concepts', access: 'public' },
      { href: '/traceroute', label: 'Traceroute', access: 'public' },
      { href: '/theses', label: 'Theses', access: 'admin' },
      { href: '/worldview', label: 'Worldview', access: 'admin' },
      { href: '/data', label: 'Data', access: 'admin' },
      { href: '/calibration', label: 'Calibration', access: 'admin' },
      { href: '/sources', label: 'Sources', access: 'admin', also: ['/ingest', '/source/'] },
    ],
  },
  {
    key: 'reports', href: '/reports', label: 'Report Portal', icon: 'reports', access: 'public',
    detailPrefixes: ['/reports/'],
    children: [
      { href: '/reports', label: 'Portal', access: 'public' },
      { href: '/intel/deck', label: 'Intel deck', access: 'portal' },
      { href: '/field-reports', label: 'Field Reports', access: 'portal' },
      { href: '/field-reports/desk', label: 'Field Report desk', access: 'admin' },
      { href: '/reports/period', label: 'Period generator', access: 'admin' },
    ],
  },
  {
    key: 'datasets', href: '/datasets', label: 'Data Portal', icon: 'data', access: 'public',
    detailPrefixes: ['/datasets/'],
    children: [
      { href: '/datasets', label: 'Catalog', access: 'public' },
      { href: '/datasets/briefcase', label: 'Briefcase', access: 'public' },
      { href: '/datasets/schema', label: 'Schema map', access: 'public' },
    ],
  },
  {
    key: 'research', href: '/research', label: 'Research Portal', icon: 'research', access: 'public',
    detailPrefixes: ['/research/'],
    children: [
      { href: '/research', label: 'Portal', access: 'public' },
      { href: '/research/console', label: 'Console', access: 'admin', badge: 'papers' },
      { href: '/research/digest', label: 'Digest', access: 'admin' },
    ],
  },
  {
    key: 'scout', href: '/scout', label: 'Startup Scout', icon: 'scout', access: 'public',
    detailPrefixes: ['/scout/'],
    children: [
      { href: '/scout', label: 'Scout', access: 'public' },
      { href: '/scout/console', label: 'Console', access: 'admin', badge: 'scout' },
    ],
  },
  {
    key: 'tooling', href: '/tooling', label: 'Tooling Monitor', icon: 'tooling', access: 'public',
    detailPrefixes: ['/tooling/'],
    children: [
      { href: '/tooling', label: 'Catalog', access: 'public' },
      { href: '/tooling/table', label: 'Table', access: 'public' },
      { href: '/tooling/reports', label: 'Reports', access: 'portal' },
      { href: '/tooling/console', label: 'Console', access: 'admin', badge: 'tooling' },
    ],
  },
  {
    key: 'education', href: '/education', label: 'Education', icon: 'education', access: 'public',
    detailPrefixes: ['/education/'],
    children: [{ href: '/education', label: 'Guides', access: 'public' }],
  },
  { key: 'ask', href: '/ask', label: 'Ask the Atlas', icon: 'ask', access: 'public', children: [] },
];

// The bottom island: About (with its section tabs), then the admin desk items
// that belong to no portal. Rendered after NAV_TREE, below a hairline.
export const NAV_ISLAND: NavGroup[] = [
  {
    key: 'about', href: '/about', label: 'About', icon: 'about', access: 'public',
    detailPrefixes: ['/about/'],
    children: [
      { href: '/about', label: 'Overview', access: 'public' },
      { href: '/about/inside', label: 'Inside the Atlas', access: 'public' },
      { href: '/about/how-it-works', label: 'How it works', access: 'public' },
      { href: '/about/where-it-fails', label: 'Where it fails', access: 'public' },
      { href: '/about/data-handling', label: 'Data handling', access: 'public' },
      { href: '/about/glossary', label: 'Glossary', access: 'public' },
      { href: '/about/why-bespoke', label: 'Why bespoke', access: 'public' },
      { href: '/about/architecture', label: 'Architecture', access: 'public', hidden: true },
    ],
  },
  {
    key: 'desk', href: '/ops', label: 'Admin desk', icon: 'desk', access: 'admin',
    children: [
      { href: '/ops', label: 'Operations', access: 'admin' },
      { href: '/agent', label: 'Atlas Agent', access: 'admin', badge: 'agent' },
      { href: '/tickets', label: 'Tickets', access: 'admin', badge: 'tickets' },
      { href: '/access', label: 'Access', access: 'admin', badge: 'access' },
      { href: '/costs', label: 'Costs', access: 'admin', also: ['/costs/'] },
      { href: '/showcase', label: 'Showcase', access: 'admin', hidden: true },
    ],
  },
];

export const ALL_GROUPS: NavGroup[] = [...NAV_TREE, ...NAV_ISLAND];

// The groups that ARE portals (the product surfaces), in rail order. The
// lobby's tiles, /about/data-handling's list, the /portals directory and the
// rail's Portals folder all read this; a new portal registers here.
export const PORTAL_GROUP_KEYS = ['signals', 'blotter', 'savant', 'map', 'reports', 'datasets', 'research', 'scout', 'tooling'] as const;

export function portalGroups(): NavGroup[] {
  return PORTAL_GROUP_KEYS.map((k) => NAV_TREE.find((g) => g.key === k)).filter((g): g is NavGroup => Boolean(g));
}

export function isPortalGroupKey(key: string | null | undefined): boolean {
  return !!key && (PORTAL_GROUP_KEYS as readonly string[]).includes(key);
}

// What the rail and the mobile sheet render, top to bottom: Home, the
// Portals folder (every portal hub in one accordion), Education, Ask. A
// portal's own leaves never appear in the rail; the page's tabs carry them.
export type RailEntry =
  | { kind: 'group'; group: NavGroup }
  | { kind: 'folder'; key: 'portals'; label: string; icon: string; href: string; groups: NavGroup[] };

export function railEntries(): RailEntry[] {
  const g = (key: string) => NAV_TREE.find((x) => x.key === key);
  const home = g('home'); const portals = g('portals'); const education = g('education'); const ask = g('ask');
  const out: RailEntry[] = [];
  if (home) out.push({ kind: 'group', group: home });
  if (portals) out.push({ kind: 'folder', key: 'portals', label: portals.label, icon: portals.icon, href: portals.href, groups: portalGroups() });
  if (education) out.push({ kind: 'group', group: education });
  if (ask) out.push({ kind: 'group', group: ask });
  return out;
}

export function canSee(access: Access, viewer: NavViewer): boolean {
  if (access === 'public') return true;
  if (access === 'portal') return viewer.portal || viewer.admin;
  return viewer.admin;
}

function startsAt(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href.endsWith('/') ? href : `${href}/`);
}

// Longest-match leaf for a pathname within a group (so /signals/drafts wins
// over /signals, and /ingest resolves to Sources through `also`).
export function leafFor(pathname: string, group: NavGroup): NavLeaf | null {
  let best: NavLeaf | null = null;
  let bestLen = -1;
  for (const leaf of group.children) {
    const candidates = [leaf.href, ...(leaf.also ?? [])];
    for (const c of candidates) {
      if (startsAt(pathname, c) && c.length > bestLen) {
        best = leaf;
        bestLen = c.length;
      }
    }
  }
  return best;
}

// The group a pathname belongs to: by leaf (longest match across all
// groups, so /tooling/reports is Tooling, not Reports), then by detail prefix,
// then by the group's own hub href. Home only matches exactly.
export function groupFor(pathname: string): NavGroup | null {
  let best: { group: NavGroup; len: number } | null = null;
  for (const group of ALL_GROUPS) {
    if (group.key === 'home') continue;
    for (const leaf of group.children) {
      for (const c of [leaf.href, ...(leaf.also ?? [])]) {
        if (startsAt(pathname, c) && c.length > (best?.len ?? -1)) best = { group, len: c.length };
      }
    }
  }
  if (best) return best.group;
  for (const group of ALL_GROUPS) {
    if (group.key === 'home') continue;
    if (startsAt(pathname, group.href)) return group;
    for (const p of group.detailPrefixes ?? []) {
      if (pathname.startsWith(p)) return group;
    }
  }
  if (pathname === '/') return NAV_TREE[0];
  return null;
}

// Tabs shown at the top of a page: the group's visible, non-hidden leaves,
// only when there are two or more of them for this viewer.
export function tabsFor(pathname: string, viewer: NavViewer): NavLeaf[] {
  const group = groupFor(pathname);
  if (!group) return [];
  const tabs = group.children.filter((l) => !l.hidden && canSee(l.access, viewer));
  return tabs.length >= 2 ? tabs : [];
}

export interface PathwaySegment {
  label: string;
  href: string | null;      // null = the current page
}

// Group › (leaf when it is not the hub and not the page itself) › page.
// The current page's own label comes from the caller (the h1).
export function pathwayFor(pathname: string, pageLabel: string): PathwaySegment[] {
  const group = groupFor(pathname);
  if (!group || group.key === 'home') return [{ label: pageLabel, href: null }];
  const segs: PathwaySegment[] = [{ label: group.label, href: group.href }];
  const leaf = leafFor(pathname, group);
  const onLeafItself = leaf && (pathname === leaf.href);
  const onHub = pathname === group.href;
  if (onHub) return [{ label: group.label, href: null }];
  if (leaf && !onLeafItself && leaf.href !== group.href) segs.push({ label: leaf.label, href: leaf.href });
  segs.push({ label: pageLabel, href: null });
  return segs;
}

// Where an "admin only" notice sends a guest: the nearest public leaf of the
// page's group, else the group hub, else home.
export function publicParentFor(pathname: string): { label: string; href: string } {
  const group = groupFor(pathname);
  if (!group) return { label: 'Home', href: '/' };
  const pub = group.children.find((l) => l.access === 'public' && !l.hidden);
  if (pub) return { label: `${group.label} · ${pub.label}`, href: pub.href };
  if (group.access === 'public') return { label: group.label, href: group.href };
  return { label: 'Home', href: '/' };
}

export function isActiveGroup(pathname: string, group: NavGroup): boolean {
  if (group.key === 'home') return pathname === '/';
  return groupFor(pathname)?.key === group.key;
}

// Live queue counts for the rail/mobile-sheet badges (BadgeKey minus 'agent',
// which rides the AgentPulse instead — see lib/data/desk.ts getNavCounts()).
export type NavCounts = Record<Exclude<BadgeKey, 'agent'>, number>;

// Routes that render WITHOUT the site chrome (rail + header bar). The chrome
// lives in the root layout since 2026-09-23 (it used to render inside every
// page, so the rail remounted and lost its hover/pin/accordion state on each
// click); ChromeGate hides it on these paths: the login card, the unlisted
// showcase deck, the 16:9 deck stages, and the print digests.
const CHROMELESS_EXACT = new Set(['/login', '/showcase', '/costs/deck', '/ingestion/deck', '/research/digest', '/signals/digest']);
const CHROMELESS_RE = [/^\/education\/[^/]+\/deck\/?$/, /^\/intel\/deck\/(\d{4}-\d{2}-\d{2}|none)\/?$/];

export function isChromeless(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return CHROMELESS_EXACT.has(p) || CHROMELESS_RE.some((re) => re.test(p));
}
