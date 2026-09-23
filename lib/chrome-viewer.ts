import { isAdmin, isEditMode, isPortal, isPreview } from './auth';

// Who the site chrome renders for. Header (rendered once in the root layout)
// and GET /api/nav/viewer both call this, so the client can tell when the
// session changed underneath a persistent chrome (sign-out or a preview toggle
// in another tab, an expired cookie) and refresh it. `key` is the compact
// comparison string; it carries no data beyond the requester's own flags.
export interface ChromeViewer {
  admin: boolean;
  preview: boolean;
  showAdmin: boolean;
  editing: boolean;
  portal: boolean;
  key: string;
}

export async function getChromeViewer(): Promise<ChromeViewer> {
  const admin = await isAdmin();
  const preview = admin && (await isPreview());
  const showAdmin = admin && !preview;
  const editing = showAdmin && (await isEditMode());
  // The portal tier (team key unlock) rides no atlas_admin/atlas_guest cookie
  // of its own, so the rail/mobile-sheet tree needs it separately from admin
  // to show portal-only leaves (e.g. /tooling/reports) to keyholders.
  const portal = !showAdmin && (await isPortal());
  const key = [admin, preview, editing, portal].map((b) => (b ? '1' : '0')).join('');
  return { admin, preview, showAdmin, editing, portal, key };
}
