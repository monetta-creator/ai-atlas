'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toggleEditModeAction, togglePreviewAction } from '@/lib/actions';
import { logout } from '@/app/login/actions';
import ThemeToggle from './ThemeToggle';
import ShareLinkButton from './ShareLinkButton';
import FeedbackButtons from './feedback/FeedbackButtons';

// The nav, slimmed for the lobby redesign (2026-08-13): the home tiles are the
// premier navigation, the bar stays thin.
//  - PUBLIC: Home · Signal Board · Explore ▾ (the five portals + the map family) · Ask · About.
//  - ADMIN: one FLAT list ordered by frequency, no group labels; the tab-shell
//    merges (Sources+Ingest, Worldview+Data, Costs+Calibration) mean one nav
//    row can front two routes (`also` drives the active state).
//  - Queue badges (live counts from Header, admin-only) mark waiting work;
//    localStorage "unvisited" dots mark dropdown pages never opened on this
//    device. Mobile renders two accordions (Site / Admin) instead of one sheet.

export interface NavCounts {
  pipeline: number;
  drafts: number;
  papers: number;
  scout: number;
  tickets: number;
}

// The Explore dropdown mirrors the lobby tiles (minus Signal Board, which keeps
// its own top-level slot), then the map-family reader pages beneath a rule.
const EXPLORE_VIEWS = [
  { href: '/blotter', label: 'News Blotter' },
  { href: '/map', label: 'Claims & Theses' },
  { href: '/reports', label: 'Report Portal' },
  { href: '/datasets', label: 'Data Portal' },
  { href: '/research', label: 'Research Portal' },
  { href: '/scout', label: 'Startup Scout' },
];
const EXPLORE_MORE = [
  { href: '/bridges', label: 'Bridges' },
  { href: '/concepts', label: 'Concepts' },
  { href: '/traceroute', label: 'Traceroute' },
];
// Detail pages that should light the Explore dropdown without being listed in it.
const EXPLORE_DETAIL_PREFIXES = ['/bridge/', '/claim/', '/q/', '/thesis-report/'];

interface AdminItem {
  href: string;
  label: string;
  badge?: keyof NavCounts;
  also?: string[];   // sibling routes this row fronts (tab-shell merges)
}

const ADMIN_ITEMS: AdminItem[] = [
  { href: '/pipeline', label: 'Pipeline', badge: 'pipeline' },
  { href: '/signals/drafts', label: 'Drafts', badge: 'drafts' },
  { href: '/theses', label: 'Theses' },
  { href: '/research/console', label: 'Papers', badge: 'papers' },
  { href: '/scout/console', label: 'Scout', badge: 'scout' },
  { href: '/sources', label: 'Sources', also: ['/ingest', '/source'] },
  { href: '/worldview', label: 'Map editor', also: ['/data'] },
  { href: '/tickets', label: 'Tickets', badge: 'tickets' },
  { href: '/costs', label: 'Costs', also: ['/calibration'] },
  { href: '/showcase', label: 'Showcase' },
];

// Copies the direct /showcase URL: the deck is public but unlisted, so the
// link IS the invitation for demo guests. Origin filled in client-side.
function CopyShowcaseLink() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/showcase`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy the showcase link:', url);
    }
  }
  return (
    <button type="button" className="btn btn--quiet btn--sm" onClick={copy} title="Copy the showcase link for demo guests">
      {copied ? 'Link copied ✓' : 'Showcase link'}
    </button>
  );
}

const VISITED_KEY = 'atlas_nav_visited';

// The visited set is an external store (localStorage) read via useSyncExternalStore:
// navigation WRITES to it (effect below) and emits; subscribers re-read. The server
// snapshot is the '' sentinel, so SSR/hydration renders no dots (no mismatch, no
// flash of every page looking new).
const visitedListeners = new Set<() => void>();
const subscribeVisited = (cb: () => void) => {
  visitedListeners.add(cb);
  return () => { visitedListeners.delete(cb); };
};
const readVisited = () => {
  try {
    return localStorage.getItem(VISITED_KEY) ?? '[]';
  } catch {
    return '[]';
  }
};
const emitVisited = () => visitedListeners.forEach((l) => l());

// Desktop dropdown: a trigger + a panel that closes on outside-click, Escape, or any
// click inside (so following a link / submitting a toggle dismisses it).
function Dropdown({
  label, active, align = 'left', accent = false, children,
}: { label: string; active?: boolean; align?: 'left' | 'right'; accent?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="navmenu" ref={ref}>
      <button
        type="button"
        className="navmenu-trigger"
        data-active={active ? '' : undefined}
        data-open={open ? '' : undefined}
        data-accent={accent ? '' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        {accent && <span className="navmenu-dot" aria-hidden="true" />}
        {label}
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className={`navmenu-panel${align === 'right' ? ' navmenu-panel--right' : ''}`}
          role="menu"
          // Close must be deferred a tick: closing synchronously unmounts the panel's
          // <form action={...}> buttons before the browser dispatches their submit,
          // so the server action (Sign out, Edit mode, Preview) never fires.
          onClick={() => setTimeout(() => setOpen(false), 0)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default function SiteNav({
  showAdmin, previewing, editing, shareToken, counts,
}: {
  showAdmin: boolean;
  previewing: boolean;
  editing: boolean;
  shareToken: string;
  counts?: NavCounts | null;
}) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visitedJson = useSyncExternalStore(subscribeVisited, readVisited, () => '');
  // null while the server sentinel is in effect (pre-hydration): dots stay hidden.
  const visited = useMemo<Set<string> | null>(() => {
    if (visitedJson === '') return null;
    try {
      return new Set<string>(JSON.parse(visitedJson));
    } catch {
      return new Set<string>();
    }
  }, [visitedJson]);

  const isActive = (href: string) => path === href || path.startsWith(href + '/');
  const itemActive = (item: AdminItem) => isActive(item.href) || (item.also ?? []).some(isActive);
  // Home is an exact match — `isActive('/')` would light up on every route.
  const homeActive = path === '/';
  const exploreActive =
    EXPLORE_VIEWS.some((v) => isActive(v.href)) ||
    EXPLORE_MORE.some((v) => isActive(v.href)) ||
    EXPLORE_DETAIL_PREFIXES.some((p) => path.startsWith(p));
  const adminActive = ADMIN_ITEMS.some(itemActive);
  // Signal Board (published feed) vs the admin-only Drafts page — kept mutually
  // exclusive so Signal Board doesn't highlight on /signals/drafts (Admin does).
  const signalsActive = path === '/signals' || (path.startsWith('/signals/') && !path.startsWith('/signals/drafts'));

  // Record which dropdown destinations this device has opened; never-visited ones
  // get a discovery dot. localStorage only — a per-device orientation aid. The
  // effect only writes the store and emits; the render subscription above re-reads.
  useEffect(() => {
    try {
      const set = new Set<string>(JSON.parse(localStorage.getItem(VISITED_KEY) ?? '[]'));
      const before = set.size;
      for (const v of [...EXPLORE_VIEWS, ...EXPLORE_MORE]) if (isActive(v.href)) set.add(v.href);
      for (const a of ADMIN_ITEMS) if (itemActive(a)) set.add(a.href);
      if (set.size !== before) localStorage.setItem(VISITED_KEY, JSON.stringify([...set]));
      emitVisited();   // wake subscribers even on first mount (sentinel -> real data)
    } catch {
      /* private mode etc.: dots simply never resolve */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const newDot = (href: string) =>
    visited !== null && !visited.has(href) ? <span className="nav-dot-new" aria-label="not yet visited" /> : null;

  const badge = (key?: keyof NavCounts) => {
    const n = key && counts ? counts[key] : 0;
    return n > 0 ? <span className="nav-badge">{n}</span> : null;
  };

  const exploreLinks = (
    <>
      {EXPLORE_VIEWS.map((v) => (
        <Link key={v.href} href={v.href} className="navmenu-item" data-active={isActive(v.href) ? '' : undefined}>
          {v.label}
          {newDot(v.href)}
        </Link>
      ))}
      <div className="navmenu-sep" />
      {EXPLORE_MORE.map((v) => (
        <Link key={v.href} href={v.href} className="navmenu-item" data-active={isActive(v.href) ? '' : undefined}>
          {v.label}
          {newDot(v.href)}
        </Link>
      ))}
    </>
  );

  const adminMenu = (
    <>
      {ADMIN_ITEMS.map((a) => (
        <Link key={a.href} href={a.href} className="navmenu-item" data-active={itemActive(a) ? '' : undefined}>
          {a.label}
          {badge(a.badge)}
          {newDot(a.href)}
        </Link>
      ))}
      <div className="navmenu-sep" />
      <div className="navmenu-label">View</div>
      <form action={toggleEditModeAction}>
        <button type="submit" className="navmenu-item navmenu-item--btn" data-active={editing ? '' : undefined}>
          {editing ? 'Editing ✓' : 'Edit mode'}
        </button>
      </form>
      <form action={togglePreviewAction}>
        <button type="submit" className="navmenu-item navmenu-item--btn">Preview as guest</button>
      </form>
      <div className="navmenu-item navmenu-item--plain"><ShareLinkButton token={shareToken} /></div>
      <div className="navmenu-item navmenu-item--plain"><CopyShowcaseLink /></div>
      <div className="navmenu-sep" />
      <form action={logout}>
        <button type="submit" className="navmenu-item navmenu-item--btn">Sign out</button>
      </form>
    </>
  );

  const adminArea = showAdmin ? (
    <Dropdown label="Admin" active={adminActive} align="right" accent>{adminMenu}</Dropdown>
  ) : previewing ? (
    <form action={togglePreviewAction}>
      <button type="submit" className="toggle" data-action="preview" data-on="1">Previewing as guest · Exit</button>
    </form>
  ) : (
    <Link href="/login" className="toggle">Admin login</Link>
  );

  return (
    <>
      {/* desktop: the links live in the left portal rail now; the top bar
          keeps only the theme toggle and the admin area. */}
      <div className="sitenav-desktop">
        <ThemeToggle />
        {adminArea}
      </div>

      {/* mobile */}
      <div className="sitenav-mobile">
        <ThemeToggle />
        <button
          type="button"
          className="nav-burger"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
        >
          {mobileOpen ? '✕' : '☰'}
        </button>
      </div>

      {mobileOpen && (
        <div
          className="nav-mobile-panel"
          role="menu"
          // Deferred for the same reason as the Dropdown panel: a sync close unmounts
          // the form buttons (Sign out, Edit mode, Preview) before their submit
          // dispatches. Accordion toggles must NOT close the sheet.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('summary')) return;
            setTimeout(() => setMobileOpen(false), 0);
          }}
        >
          <Link href="/" className="navmenu-item" data-active={homeActive ? '' : undefined}>Home</Link>
          <Link href="/signals" className="navmenu-item" data-active={signalsActive ? '' : undefined}>Signal Board</Link>
          <details className="nav-acc" open={exploreActive || undefined}>
            <summary>Explore</summary>
            {exploreLinks}
          </details>
          <Link href="/ask" className="navmenu-item" data-active={isActive('/ask') ? '' : undefined}>Ask</Link>
          <Link href="/about" className="navmenu-item" data-active={isActive('/about') ? '' : undefined}>About</Link>
          <FeedbackButtons variant="menu" />
          {showAdmin && (
            <details className="nav-acc" open={adminActive || undefined}>
              <summary>Admin</summary>
              {adminMenu}
            </details>
          )}
          {previewing && (
            <form action={togglePreviewAction}>
              <button type="submit" className="navmenu-item navmenu-item--btn">Previewing as guest · Exit</button>
            </form>
          )}
          {!showAdmin && !previewing && (
            <Link href="/login" className="navmenu-item">Admin login</Link>
          )}
        </div>
      )}
    </>
  );
}
