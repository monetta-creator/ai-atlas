// The one "session ended under the persistent chrome" path, shared by the
// admin-only pollers (the nav-counts store and the agent orb's pulse). No
// React or Next imports: the router is typed structurally so this module
// stays plain and Node-testable (scripts/test-nav-counts-store.mjs).
// ViewerSync is deliberately NOT on this path: it compares viewer keys on
// focus, a different predicate with a different lifecycle, and wants no guard.

// 401 in-route, or proxy.ts's 307 to /login once no session cookie is left.
export function sessionLost(r: { status: number; redirected: boolean }): boolean {
  return r.status === 401 || r.redirected;
}

let refreshedFor: string | null = null;

// True the first time a pathname claims the refresh, false until the path
// changes. Once per pathname because after the refresh the server renders the
// guest chrome and the admin-only pollers unmount; the guard only stops a loop
// if that does not happen, and resets on navigation.
export function claimChromeRefresh(path: string): boolean {
  if (refreshedFor === path) return false;
  refreshedFor = path;
  return true;
}

export function refreshChromeOnce(router: { refresh(): void }, path: string): void {
  if (claimChromeRefresh(path)) router.refresh();
}

// A poller got a 200: the session is alive, so a later loss on this same
// path must be allowed to refresh again. Without this, module state from a
// first sign-out (login redirects are soft navigations) would swallow the
// second one on a revisited path.
export function chromeSessionAlive(): void {
  refreshedFor = null;
}
