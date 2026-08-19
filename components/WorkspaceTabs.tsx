import Link from 'next/link';

// The tab-shell that makes two sibling admin pages read as one workspace without
// moving any route: both pages render the same strip, the nav lists only the
// workspace head, and every old URL keeps working. Server component, no state —
// each page passes its own href as `active`.

export interface WorkspaceTab {
  href: string;
  label: string;
}

export const SOURCES_TABS: WorkspaceTab[] = [
  { href: '/sources', label: 'Library' },
  { href: '/ingest', label: 'Add source' },
];

export const REPORTS_TABS: WorkspaceTab[] = [
  { href: '/reports/period', label: 'Period report' },
  { href: '/theses', label: 'Thesis reports' },
];

export const ANALYTICS_TABS: WorkspaceTab[] = [
  { href: '/calibration', label: 'Calibration' },
  { href: '/costs', label: 'Costs' },
];

export const MAP_EDITOR_TABS: WorkspaceTab[] = [
  { href: '/worldview', label: 'Worldview' },
  { href: '/data', label: 'Text & lenses' },
];

export default function WorkspaceTabs({ tabs, active }: { tabs: WorkspaceTab[]; active: string }) {
  return (
    <div className="wstabs" role="tablist" aria-label="Workspace pages">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} data-active={t.href === active ? '' : undefined}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
