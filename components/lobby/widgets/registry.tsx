import type { ReactNode } from 'react';
import { PORTAL_ICONS } from '@/components/portal-icons';
import { widgetMeta } from '@/lib/widgets/catalog';
import PortalTile from './PortalTile';
import AddDocument from './AddDocument';
import CronTracker from './CronTracker';
import DeskCounts from './DeskCounts';
import TodaysSpend from './TodaysSpend';
import TavilyQuota from './TavilyQuota';
import LatestSignals from './LatestSignals';
import AtlasStats from './AtlasStats';

// Server-only: every entry here (bar the pure PortalTile) ends up pulling
// lib/data, so this module must never be imported from a 'use client' file
// (CustomizeWidgets imports the catalog directly instead, never this).

type WidgetComponent = (props: { personal: boolean }) => Promise<ReactNode> | ReactNode;

const TILE_ROUTES: Record<string, { href: string; iconKey: keyof typeof PORTAL_ICONS }> = {
  'tile-signals': { href: '/signals', iconKey: 'signals' },
  'tile-blotter': { href: '/blotter', iconKey: 'blotter' },
  'tile-map': { href: '/map', iconKey: 'claims' },
  'tile-reports': { href: '/reports', iconKey: 'reports' },
  'tile-datasets': { href: '/datasets', iconKey: 'data' },
  'tile-research': { href: '/research', iconKey: 'research' },
  'tile-scout': { href: '/scout', iconKey: 'scout' },
};

// Curries PortalTile with one catalog entry's route + copy. A zero-arg
// function is structurally assignable to WidgetComponent (fewer params is
// fine), so the tile factory can just ignore the {personal} prop it's called
// with (portal tiles show the same thing to everyone).
function makeTile(key: keyof typeof TILE_ROUTES): WidgetComponent {
  const route = TILE_ROUTES[key];
  const meta = widgetMeta(key);
  return function Tile() {
    if (!meta) return null;
    return <PortalTile href={route.href} iconKey={route.iconKey} name={meta.name} desc={meta.desc} />;
  };
}

export const WIDGET_COMPONENTS: Record<string, WidgetComponent> = {
  'cron-tracker': CronTracker,
  'desk-counts': DeskCounts,
  'todays-spend': TodaysSpend,
  'tavily-quota': TavilyQuota,
  'latest-signals': LatestSignals,
  'atlas-stats': AtlasStats,
  'add-document': AddDocument,
  'tile-signals': makeTile('tile-signals'),
  'tile-blotter': makeTile('tile-blotter'),
  'tile-map': makeTile('tile-map'),
  'tile-reports': makeTile('tile-reports'),
  'tile-datasets': makeTile('tile-datasets'),
  'tile-research': makeTile('tile-research'),
  'tile-scout': makeTile('tile-scout'),
};
