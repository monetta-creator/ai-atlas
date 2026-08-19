import Brand from '@/components/Brand';
import PortalRail from '@/components/PortalRail';
import ThemeToggle from '@/components/ThemeToggle';

// The app-wide route-transition boundary. Every page here is force-dynamic
// (cookies + DB on each request), so this fallback is what paints while the
// server renders. It re-renders the SAME chrome the destination page will
// mount (rail, header bar, brand, theme toggle) in the same positions, so
// navigation reads as persistent chrome with only the content area swapping;
// the sliding accent bar and a late-fading label cover the content. The one
// intentional mismatch is /showcase, which is chromeless by design and clears
// the fallback chrome when it mounts. The admin menu is auth-dependent and
// cannot render here; its corner fills in with the page.
export default function Loading() {
  return (
    <>
      <PortalRail />
      <nav className="nav">
        <Brand />
        <div className="sitenav-desktop">
          <ThemeToggle />
        </div>
      </nav>
      <div className="route-loading" aria-busy="true" aria-live="polite">
        <div className="route-loading-bar" />
        <span className="route-loading-label">Loading…</span>
      </div>
    </>
  );
}
