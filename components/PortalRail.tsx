'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAV_ICONS, PORTALS } from '@/components/portal-icons';
import FeedbackButtons from '@/components/feedback/FeedbackButtons';

// The left sidebar: the site's primary navigation on desktop (the top bar
// keeps only the brand, the theme toggle, and the admin menu). Full-height
// fixed column, icons with name tooltips: Home, the six portals, Explore
// (a globe with a nested flyout for the map-family extras), Ask, and About
// pinned at the bottom in its own island. Hidden under 761px, where the
// hamburger sheet remains the complete nav. Content clears the rail via
// body:has(.portal-rail) padding, so pages without it (the showcase) stay
// full-bleed.
const EXPLORE_ITEMS = [
  { href: '/bridges', name: 'Bridges' },
  { href: '/concepts', name: 'Concepts' },
  { href: '/traceroute', name: 'Traceroute' },
];
// Detail pages that should light Explore without being listed in it.
const EXPLORE_PREFIXES = ['/bridge/', '/claim/', '/q/', '/thesis-report/'];

export default function PortalRail() {
  const path = usePathname();
  const [exploreOpen, setExploreOpen] = useState(false);
  const flyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exploreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (flyRef.current && !flyRef.current.contains(e.target as Node)) setExploreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExploreOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [exploreOpen]);

  const isActive = (href: string) => path === href || path.startsWith(href + '/');
  const exploreActive =
    EXPLORE_ITEMS.some((v) => isActive(v.href)) || EXPLORE_PREFIXES.some((p) => path.startsWith(p));

  return (
    <nav className="portal-rail" aria-label="Site">
      <Link
        href="/"
        className="portal-rail-link"
        data-active={path === '/' ? '' : undefined}
        data-tip="Home"
        aria-label="Home"
      >
        {NAV_ICONS.home}
      </Link>

      {PORTALS.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          className="portal-rail-link"
          data-active={isActive(p.href) && !(p.href === '/signals' && path.startsWith('/signals/drafts')) ? '' : undefined}
          data-tip={p.name}
          aria-label={p.name}
        >
          {p.icon}
        </Link>
      ))}

      <div className="portal-rail-item" data-open={exploreOpen ? '' : undefined} ref={flyRef}>
        <button
          type="button"
          className="portal-rail-link"
          data-active={exploreActive ? '' : undefined}
          data-tip="Explore"
          aria-label="Explore"
          aria-expanded={exploreOpen}
          aria-haspopup="menu"
          onClick={() => setExploreOpen((o) => !o)}
        >
          {NAV_ICONS.explore}
        </button>
        {exploreOpen && (
          <div className="portal-rail-fly" role="menu" onClick={() => setTimeout(() => setExploreOpen(false), 0)}>
            {EXPLORE_ITEMS.map((v) => (
              <Link key={v.href} href={v.href} className="navmenu-item" data-active={isActive(v.href) ? '' : undefined}>
                {v.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link
        href="/education"
        className="portal-rail-link"
        data-active={isActive('/education') ? '' : undefined}
        data-tip="Education"
        aria-label="Education"
      >
        {NAV_ICONS.education}
      </Link>

      <Link
        href="/ask"
        className="portal-rail-link"
        data-active={isActive('/ask') ? '' : undefined}
        data-tip="Ask the Atlas"
        aria-label="Ask the Atlas"
      >
        {NAV_ICONS.ask}
      </Link>

      <div className="portal-rail-bottom">
        <FeedbackButtons variant="rail" />
        <Link
          href="/about"
          className="portal-rail-link"
          data-active={isActive('/about') ? '' : undefined}
          data-tip="About"
          aria-label="About"
        >
          {NAV_ICONS.about}
        </Link>
      </div>
    </nav>
  );
}
