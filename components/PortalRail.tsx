'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV_ICONS, PORTAL_ICONS } from '@/components/portal-icons';
import FeedbackButtons from '@/components/feedback/FeedbackButtons';
import AgentOrb from '@/components/agent/AgentOrb';
import { useLiveNavCounts } from '@/lib/nav-counts-client';
import { useValueChange } from '@/lib/use-route-change';
import type { AgentPulse } from '@/lib/agent/types';
import {
  NAV_ISLAND, NAV_TREE, canSee, groupFor, isActiveGroup, leafFor,
  type NavCounts, type NavGroup, type NavLeaf, type NavViewer,
} from '@/lib/nav';

// The left sidebar: 56px icon column at rest, widening to a 232px overlay on
// hover/focus-within (no layout shift, content keeps padding-left:56px via
// body:has in rail.css) or when pinned open. Driven entirely by lib/nav's
// NAV_TREE + NAV_ISLAND: a group with more than one visible leaf (beyond the
// leaf that IS its own hub, e.g. Data Portal's lone "Catalog") is a toggling
// accordion; everything else is a plain Link. Admin-only groups/leaves are
// filtered out of the tree entirely for non-admin viewers, never dimmed.
export default function PortalRail({
  admin, portal, agentPulse, counts,
}: {
  admin?: boolean;
  portal?: boolean;
  agentPulse?: AgentPulse | null;
  counts?: NavCounts | null;
} = {}) {
  const path = usePathname();
  const viewer: NavViewer = { admin: !!admin, portal: !!portal };
  const activeGroup = groupFor(path);

  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(activeGroup?.key ?? null);
  const railRef = useRef<HTMLElement>(null);
  // When the page moves into a different group, open that accordion; moving
  // within a group leaves a manually opened accordion alone
  // (lib/use-route-change.ts).
  const activeKey = activeGroup?.key ?? null;
  useValueChange(activeKey, (k) => { if (k) setOpenKey(k); });
  // Hover/focus expansion must not carry over to the next page when the
  // pointer has left (the old per-page remount reset it): after a keyboard
  // Enter or a touch tap the rail would stay open over the new page. A rail
  // still under the mouse stays expanded (that is the whole point of the
  // persistent chrome), and a pinned rail stays as it is. The reset runs from
  // a timeout, never synchronously in the effect body (React compiler rule).
  useEffect(() => {
    const rail = railRef.current;
    if (pinned || !rail || rail.matches(':hover')) return;
    const el = document.activeElement;
    if (el instanceof HTMLElement && rail.contains(el)) el.blur();
    const t = window.setTimeout(() => setHovered(false), 0);
    return () => window.clearTimeout(t);
  }, [path, pinned]);
  const liveCounts = useLiveNavCounts(counts, !!admin);

  const expanded = pinned || hovered;

  // Escape unpins/collapses; a click outside a pinned rail closes whichever
  // accordion is open without unpinning the rail itself.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setHovered(false);
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    const onDoc = (e: MouseEvent) => {
      if (pinned && railRef.current && !railRef.current.contains(e.target as Node)) setOpenKey(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [expanded, pinned]);

  function icon(key: string) {
    return PORTAL_ICONS[key] ?? NAV_ICONS[key];
  }

  function badgeFor(leaf: NavLeaf) {
    const key = leaf.badge;
    if (!key) return null;
    if (key === 'agent') {
      const n = agentPulse?.unread ?? 0;
      return n > 0 ? <span className="nav-badge">{n}</span> : null;
    }
    const n = liveCounts ? liveCounts[key] : 0;
    return n > 0 ? <span className="nav-badge">{n}</span> : null;
  }

  function renderGroup(group: NavGroup) {
    if (!canSee(group.access, viewer)) return null;
    const kids = group.children.filter((l) => !l.hidden && canSee(l.access, viewer));
    // Accordion only when a group has a leaf beyond the one that IS its own
    // hub (Data Portal's lone "Catalog" leaf never makes it an accordion).
    const isAccordion = kids.some((l) => l.href !== group.href);
    const active = isActiveGroup(path, group);

    if (!isAccordion) {
      return (
        <div className="portal-rail-item" key={group.key}>
          <Link
            href={group.href}
            className="portal-rail-link"
            data-active={active ? '' : undefined}
            data-tip={group.label}
            aria-label={group.label}
          >
            {icon(group.icon)}
            <span className="portal-rail-label">{group.label}</span>
          </Link>
        </div>
      );
    }

    const activeLeaf = leafFor(path, group);
    const open = expanded && openKey === group.key;

    return (
      <div className="portal-rail-item" key={group.key} data-open={open ? '' : undefined}>
        <button
          type="button"
          className="portal-rail-link portal-rail-group"
          data-active={active ? '' : undefined}
          data-tip={group.label}
          aria-label={group.label}
          aria-expanded={open}
          onClick={() => setOpenKey((k) => (k === group.key ? null : group.key))}
        >
          {icon(group.icon)}
          <span className="portal-rail-label">{group.label}</span>
          <span className="portal-rail-chevron" data-open={open ? '' : undefined} aria-hidden="true">›</span>
        </button>
        {open && (
          <div className="portal-rail-sub" role="menu">
            {kids.map((leaf) => (
              <Link
                key={leaf.href}
                href={leaf.href}
                className="navmenu-item"
                data-active={activeLeaf === leaf ? '' : undefined}
              >
                {leaf.label}
                {badgeFor(leaf)}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <nav
      className="portal-rail"
      aria-label="Site"
      ref={railRef}
      data-expanded={expanded ? '' : undefined}
      data-pinned={pinned ? '' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!railRef.current?.contains(e.relatedTarget as Node)) setHovered(false);
      }}
    >
      <button
        type="button"
        className="portal-rail-pin"
        data-tip={pinned ? 'Collapse navigation' : 'Pin navigation open'}
        aria-label={pinned ? 'Collapse navigation' : 'Pin navigation open'}
        aria-pressed={pinned}
        onClick={() => setPinned((p) => !p)}
      >
        {pinned ? '✕' : '☰'}
      </button>

      {NAV_TREE.map(renderGroup)}

      <div className="portal-rail-bottom">
        {NAV_ISLAND.map(renderGroup)}
        <div className="portal-rail-item">
          {admin && <AgentOrb variant="rail" initialPulse={agentPulse ?? null} />}
        </div>
        <div className="portal-rail-item"><FeedbackButtons variant="rail" /></div>
      </div>
    </nav>
  );
}

