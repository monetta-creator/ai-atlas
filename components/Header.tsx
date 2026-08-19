import { isEditMode, isPreview, shareToken } from '@/lib/auth';
import { getNavCounts } from '@/lib/data';
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
  // Live queue counts for the admin nav badges (one cheap query; guests never pay).
  // Non-fatal: a failed read renders the nav without badges rather than 500ing the page.
  const counts = showAdmin ? await getNavCounts().catch(() => null) : null;

  return (
    <>
    {/* The rail must be a SIBLING of .nav, never a child: .nav's backdrop-filter
        makes it the containing block for fixed descendants, which pinned the
        rail to the header box instead of the viewport. */}
    <PortalRail />
    <nav className="nav">
      <Brand />

      {/* Only emit the share token when the admin nav will actually use it — otherwise it
          would be serialized into every guest's client payload (harmless but needless). */}
      <SiteNav showAdmin={showAdmin} previewing={preview} editing={editing} shareToken={showAdmin ? shareToken() : ''} counts={counts} />
    </nav>
    </>
  );
}
