import type { ReactNode } from 'react';
import AddDocument from './AddDocument';
import LatestSignals from './LatestSignals';
import AtlasStats from './AtlasStats';
import ToolingEntrants from './ToolingEntrants';
import EditionFront from './EditionFront';
import SavantLatest from './SavantLatest';
import PortalTiles from './PortalTiles';
import FreshAcrossPortals from './FreshAcrossPortals';
import HypothesesLedger from './HypothesesLedger';

// The lobby board's widgets (server-only: most pull lib/data, so this module
// must never be imported from a 'use client' file; CustomizeWidgets imports
// the catalog, never this). The ops board's live in
// components/ops/widgets/registry.tsx; components/widgets/all.tsx merges the
// two for WidgetBoard.

export type WidgetComponent = (props: { personal: boolean; board?: 'home' | 'ops' }) => Promise<ReactNode> | ReactNode;

export const HOME_WIDGET_COMPONENTS: Record<string, WidgetComponent> = {
  'latest-signals': LatestSignals,
  'atlas-stats': AtlasStats,
  'add-document': AddDocument,
  'tooling-entrants': ToolingEntrants,
  'edition-front': EditionFront,
  'savant-latest': SavantLatest,
  'portal-tiles': PortalTiles,
  'fresh-across-portals': FreshAcrossPortals,
  'hypotheses-ledger': HypothesesLedger,
};
