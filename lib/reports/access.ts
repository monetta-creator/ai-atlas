// Who may read which generated-report kind. Pure (imported by the client grid
// and the plain-Node tests). Portal-only kinds name tracked companies, so they
// are listed for access-key holders and the admin and excluded for guests in
// SQL (lib/data/reports.ts listGeneratedReports), and the single-sheet read
// view + its PDF route (app/reports/sheet/[id]) 404 a guest on them. Savant
// joins the list for the same reason it is key-gated in the first place: it
// names the reader organization and its peers by tier.
// 'field_report' joins this list too, but note it is STRICTER than the other
// two: intel_deck/savant are visible to every keyholder once published,
// while a Field Report stays visible only to its own keyholder plus admin
// until admin explicitly publishes it wider (lib/data/field-reports.ts is
// the extra, row-level gate that enforces that narrower rule; this list only
// keeps it off the guest listing, same as the others).
export const PORTAL_ONLY_KINDS: readonly string[] = ['intel_deck', 'savant', 'field_report'];

export type ReportViewer = { admin: boolean; portal: boolean };

export function isPortalOnlyKind(kind: string): boolean {
  return PORTAL_ONLY_KINDS.includes(kind);
}

export function canReadKind(kind: string, viewer: ReportViewer): boolean {
  if (viewer.admin) return true;
  if (isPortalOnlyKind(kind)) return viewer.portal;
  return true;
}
