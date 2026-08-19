import type { ReactNode } from 'react';

// The seven portal icons, shared by the lobby tiles (app/page.tsx) and the
// left-hand icon rail (components/PortalRail.tsx). Plain JSX constants with
// no client or server dependencies, so both trees can import them.

const ICON_ATTRS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const PORTAL_ICONS: Record<string, ReactNode> = {
  signals: (
    <svg {...ICON_ATTRS}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5.2" cy="18.8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  blotter: (
    <svg {...ICON_ATTRS}>
      <rect x="3.5" y="4.5" width="13.5" height="15" rx="1" />
      <path d="M17 8.5h2a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5" />
      <path d="M7 8.5h6.5M7 12h6.5M7 15.5h4" />
    </svg>
  ),
  claims: (
    <svg {...ICON_ATTRS}>
      <circle cx="6" cy="6" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="12" cy="18" r="2.4" />
      <path d="M7.1 8.1l3.8 7.6M16.9 8.1l-3.8 7.6M8.4 6h7.2" />
    </svg>
  ),
  reports: (
    <svg {...ICON_ATTRS}>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12.5h6M9 16h6" />
    </svg>
  ),
  data: (
    <svg {...ICON_ATTRS}>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.7" />
      <path d="M5 5.5v13c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-13" />
      <path d="M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7" />
    </svg>
  ),
  research: (
    <svg {...ICON_ATTRS}>
      <path d="M12 6.5C10.5 5 8 4.5 5 4.5c-.6 0-1 .4-1 1v12c0 .6.4 1 1 1 3 0 5.5.5 7 2 1.5-1.5 4-2 7-2 .6 0 1-.4 1-1v-12c0-.6-.4-1-1-1-3 0-5.5.5-7 2z" />
      <path d="M12 6.5v14" />
    </svg>
  ),
  scout: (
    <svg {...ICON_ATTRS}>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
};

// Rail chrome icons beyond the six portals: home, the Explore globe, the Ask
// spark (a four-point AI star, deliberately a few degrees off symmetric with
// a satellite dot so it is ours, not Gemini's), and the About info mark.
export const NAV_ICONS: Record<string, ReactNode> = {
  home: (
    <svg {...ICON_ATTRS}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </svg>
  ),
  explore: (
    <svg {...ICON_ATTRS}>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
      <path d="M4 9.4h16M4 14.6h16" />
    </svg>
  ),
  ask: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <path d="M11.6 2.6c.7 5.1 3.2 7.8 8.6 8.9-5.4 1.3-7.9 4.1-8.6 9.4-.6-5.3-3.1-8.1-8.4-9.4 5.3-1.1 7.8-3.8 8.4-8.9z" />
      <circle cx="19.6" cy="4.6" r="1.5" />
    </svg>
  ),
  about: (
    <svg {...ICON_ATTRS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  ),
};

// The rail's link list, in the lobby tiles' order.
export const PORTALS: { href: string; name: string; icon: ReactNode }[] = [
  { href: '/signals', name: 'Signal Board', icon: PORTAL_ICONS.signals },
  { href: '/blotter', name: 'News Blotter', icon: PORTAL_ICONS.blotter },
  { href: '/map', name: 'Claims & Theses', icon: PORTAL_ICONS.claims },
  { href: '/reports', name: 'Report Portal', icon: PORTAL_ICONS.reports },
  { href: '/datasets', name: 'Data Portal', icon: PORTAL_ICONS.data },
  { href: '/research', name: 'Research Portal', icon: PORTAL_ICONS.research },
  { href: '/scout', name: 'Startup Scout', icon: PORTAL_ICONS.scout },
];
