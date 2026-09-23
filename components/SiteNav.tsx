'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toggleEditModeAction, togglePreviewAction } from '@/lib/actions';
import { logout } from '@/app/login/actions';
import type { AgentPulse } from '@/lib/agent/types';
import {
  NAV_ISLAND, NAV_TREE, canSee, isActiveGroup, leafFor,
  type NavCounts, type NavGroup, type NavLeaf, type NavViewer,
} from '@/lib/nav';
import ThemeToggle from './ThemeToggle';
import ShareLinkButton from './ShareLinkButton';
import FeedbackButtons from './feedback/FeedbackButtons';
import AgentOrb from './agent/AgentOrb';
import { useLiveNavCounts } from '@/lib/nav-counts-client';

export type { NavCounts };

// The nav, rebuilt on lib/nav's ONE tree (2026-09-23): the rail (desktop)
// and this file's mobile sheet both walk NAV_TREE + NAV_ISLAND, so a page
// moves in exactly one place. What lives here:
//  - The mobile hamburger sheet: the same tree as <details> accordions.
//  - The account menu (desktop dropdown + the mobile sheet's tail): session
//    controls only (Edit mode, Preview as guest, Share link, Copy showcase
//    link, Sign out) — every page LINK moved into the tree/rail.

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
  showAdmin, portal, previewing, editing, shareToken, counts, agentPulse,
}: {
  showAdmin: boolean;
  portal?: boolean;
  previewing: boolean;
  editing: boolean;
  shareToken: string;
  counts?: NavCounts | null;
  agentPulse?: AgentPulse | null;
}) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const viewer: NavViewer = { admin: showAdmin, portal: !!portal };
  // The bar persists across navigation (root layout): close the mobile sheet
  // when the page changes, which the old per-page remount did implicitly.
  const [seenPath, setSeenPath] = useState(path);
  if (path !== seenPath) {
    setSeenPath(path);
    setMobileOpen(false);
  }
  const liveCounts = useLiveNavCounts(counts, showAdmin);

  function badgeEl(leaf: NavLeaf) {
    const key = leaf.badge;
    if (!key) return null;
    if (key === 'agent') {
      const n = agentPulse?.unread ?? 0;
      return n > 0 ? <span className="nav-badge">{n}</span> : null;
    }
    const n = liveCounts ? liveCounts[key] : 0;
    return n > 0 ? <span className="nav-badge">{n}</span> : null;
  }

  function MobileGroupRow({ group }: { group: NavGroup }) {
    if (!canSee(group.access, viewer)) return null;
    const kids = group.children.filter((l) => !l.hidden && canSee(l.access, viewer));
    const isAccordion = kids.some((l) => l.href !== group.href);
    const active = isActiveGroup(path, group);

    if (!isAccordion) {
      return (
        <Link href={group.href} className="navmenu-item" data-active={active ? '' : undefined}>
          {group.label}
        </Link>
      );
    }

    const activeLeaf = leafFor(path, group);
    return (
      <details className="nav-acc" open={active || undefined}>
        <summary>{group.label}</summary>
        {kids.map((leaf) => (
          <Link key={leaf.href} href={leaf.href} className="navmenu-item" data-active={activeLeaf === leaf ? '' : undefined}>
            {leaf.label}
            {badgeEl(leaf)}
          </Link>
        ))}
      </details>
    );
  }

  const accountRows = (
    <>
      <div className="navmenu-label">Account</div>
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
    <Dropdown label="Account" align="right" accent>{accountRows}</Dropdown>
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
          keeps only the theme toggle and the account menu. */}
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
          {NAV_TREE.map((g) => <MobileGroupRow key={g.key} group={g} />)}
          {NAV_ISLAND.map((g) => <MobileGroupRow key={g.key} group={g} />)}
          {showAdmin && <AgentOrb variant="menu" initialPulse={agentPulse ?? null} />}
          <FeedbackButtons variant="menu" />
          <div className="navmenu-sep" />
          {showAdmin && accountRows}
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
