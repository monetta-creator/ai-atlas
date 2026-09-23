// The app-wide route-transition boundary. Every page is force-dynamic (cookies
// + DB on each request), so this paints while the server renders. The chrome
// (rail + header bar) lives in the root layout and stays mounted across the
// navigation, so this only covers the content area: the sliding accent bar and
// a late-fading label.
export default function Loading() {
  return (
    <div className="route-loading" aria-busy="true" aria-live="polite">
      <div className="route-loading-bar" />
      <span className="route-loading-label">Loading…</span>
    </div>
  );
}
