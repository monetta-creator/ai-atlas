import { isEditMode, isPortal, isPreview, shareToken } from '@/lib/auth';
import { getAgentPulse, getNavCounts } from '@/lib/data';
import SiteNav from './SiteNav';
import PortalRail from './PortalRail';
import Brand from './Brand';

// `admin` is the REAL admin (isAdmin()). When an admin previews as a guest, the admin
// controls collapse to a single "Exit" pill and the page renders exactly as a guest
// sees it. The interactive nav (dropdowns + mobile sheet) lives in SiteNav.
export default async function Header({ admin }: { admin: boolean }) {
  const preview = admin && (await isPreview());
  const showAdmin = admin && !preview;
  const editing = showAdmin && (await isEditMode());
  // The portal tier (team key unlock) rides no atlas_admin/atlas_guest cookie
  // of its own, so the rail/mobile-sheet tree needs it separately from admin
  // to show portal-only leaves (e.g. /tooling/reports) to keyholders.
  const portal = !showAdmin && (await isPortal());
  // Live queue counts for the admin nav badges (one cheap query; guests never pay).
  // Non-fatal: a failed read renders the nav without badges rather than 500ing the page.
  const counts = showAdmin ? await getNavCounts().catch(() => null) : null;
  // The agent orb's first-paint badge: a server-fetched pulse so it renders
  // without a flash, then polls client-side from there. Non-fatal like counts.
  const agentPulse = showAdmin ? await getAgentPulse().catch(() => null) : null;

  return (
    <>
    {/* The rail must be a SIBLING of .nav, never a child: .nav's backdrop-filter
        makes it the containing block for fixed descendants, which pinned the
        rail to the header box instead of the viewport. */}
    <PortalRail admin={showAdmin} portal={portal} agentPulse={agentPulse} counts={counts} />
    <nav className="nav">
      <Brand />

      {/* Only emit the share token when the admin nav will actually use it — otherwise it
          would be serialized into every guest's client payload (harmless but needless). */}
      <SiteNav showAdmin={showAdmin} portal={portal} previewing={preview} editing={editing} shareToken={showAdmin ? shareToken() : ''} counts={counts} agentPulse={agentPulse} />
    </nav>
    </>
  );
}
