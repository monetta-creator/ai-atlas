import type { NavCounts } from './nav.ts';
import { sessionLost, chromeSessionAlive } from './chrome-session-client.ts';

// Live badge counts for the persistent chrome. The Header renders once in the
// root layout (it no longer re-renders on a client navigation), so the counts
// it passes down are only as fresh as the last full load or server action.
// This store keeps them current: it takes the server's counts whenever the
// layout re-renders (a new `initial`), and refetches GET /api/nav/counts on
// every pathname change. PortalRail and SiteNav share one store (the hook in
// lib/nav-counts-client.ts instantiates it once), so one navigation costs one
// request. Whichever value arrived last wins. Pure factory, no React: tested
// by scripts/test-nav-counts-store.mjs with a fake fetch.

export type NavCountsStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NavCounts | null;
  acceptInitial(initial: NavCounts | null | undefined, path: string): void;
  // `onSessionLost` fires when the endpoint says the session is gone (401, or
  // the proxy's redirect to /login): the chrome is showing a viewer that no
  // longer exists, and the caller re-renders it (lib/chrome-session-client.ts).
  refresh(path: string, onSessionLost: () => void): void;
};

export function createNavCountsStore(fetchImpl: typeof fetch): NavCountsStore {
  let current: NavCounts | null = null;
  let lastInitial: NavCounts | null | undefined;
  let fetchedFor: string | null = null;
  let inflightFor: string | null = null;
  // Bumped whenever the server delivers counts (a layout re-render after an
  // admin action), so a fetch started before it can never overwrite them.
  let gen = 0;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const l of listeners) l();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  function getSnapshot(): NavCounts | null {
    return current;
  }

  function acceptInitial(initial: NavCounts | null | undefined, path: string): void {
    if (initial === lastInitial) return;
    lastInitial = initial;
    if (initial) {
      gen += 1;           // anything in flight predates these counts
      inflightFor = null;
      current = initial;
      fetchedFor = path; // the server just computed these for this page
      emit();
    }
  }

  function refresh(path: string, onSessionLost: () => void): void {
    if (fetchedFor === path || inflightFor === path) return;
    inflightFor = path;
    const g = gen;
    fetchImpl('/api/nav/counts', { cache: 'no-store' })
      .then((r) => {
        if (sessionLost(r)) {
          onSessionLost();
          return null;
        }
        if (r.ok) chromeSessionAlive();
        return r.ok ? (r.json() as Promise<NavCounts>) : null;
      })
      .then((c) => {
        if (c && g === gen && inflightFor === path) {
          current = c;
          fetchedFor = path;
          emit();
        }
      })
      .catch(() => { /* keep the last known counts */ })
      .finally(() => {
        if (inflightFor === path) inflightFor = null;
      });
  }

  return { subscribe, getSnapshot, acceptInitial, refresh };
}
