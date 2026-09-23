import { shareToken } from '@/lib/auth';
import { getChromeViewer } from '@/lib/chrome-viewer';
import ViewerSync from './ViewerSync';
import { getAgentPulse, getNavCounts } from '@/lib/data';
import SiteNav from './SiteNav';
import PortalRail from './PortalRail';
import Brand from './Brand';

// Rendered ONCE by the root layout (inside ChromeGate) since 2026-09-23, so the
// rail and bar persist across client navigation; pages no longer render it.
// The layout does not re-render on a client navigation, only on a full load or
// after a server action that sets a cookie or revalidates (login, logout,
// preview/edit toggles, every admin mutation's revalidatePath('/', 'layout')),
// which is when admin/portal/preview can change. The badge counts refresh on
// every navigation client-side (lib/nav-counts-client.ts).
// When an admin previews as a guest, the admin controls collapse to a single
// "Exit" pill. ViewerSync refreshes the chrome when the session changes
// outside this tab (the layout would otherwise keep the old viewer).
export default async function Header() {
  const { preview, showAdmin, editing, portal, key } = await getChromeViewer();
  // Live queue counts for the admin nav badges (one cheap query; guests never pay).
  // Non-fatal: a failed read renders the nav without badges rather than 500ing the page.
  // The agent orb's first-paint badge: a server-fetched pulse so it renders
  // without a flash, then polls client-side from there. Non-fatal like counts.
  // Both reads run in parallel (they were two serial waves on every admin page).
  const [counts, agentPulse] = showAdmin
    ? await Promise.all([getNavCounts().catch(() => null), getAgentPulse().catch(() => null)])
    : [null, null];

  return (
    <>
    {/* The rail must be a SIBLING of .nav, never a child: .nav's backdrop-filter
        makes it the containing block for fixed descendants, which pinned the
        rail to the header box instead of the viewport. */}
    <ViewerSync viewer={key} />
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
