// Who may read which generated-report kind. Pure (imported by the client grid
// and the plain-Node tests). Portal-only kinds name tracked companies, so they
// are listed for access-key holders and the admin and excluded for guests in
// SQL (lib/data/reports.ts listGeneratedReports), and the single-sheet read
// view + its PDF route (app/reports/sheet/[id]) 404 a guest on them.
export const PORTAL_ONLY_KINDS: readonly string[] = ['intel_deck'];

export type ReportViewer = { admin: boolean; portal: boolean };

export function isPortalOnlyKind(kind: string): boolean {
  return PORTAL_ONLY_KINDS.includes(kind);
}

export function canReadKind(kind: string, viewer: ReportViewer): boolean {
  if (viewer.admin) return true;
  if (isPortalOnlyKind(kind)) return viewer.portal;
  return true;
}
