'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { NavCounts } from './nav';

// Live badge counts for the persistent chrome. The Header renders once in the
// root layout (it no longer re-renders on a client navigation), so the counts
// it passes down are only as fresh as the last full load or server action.
// This store keeps them current: it takes the server's counts whenever the
// layout re-renders (a new `initial`), and refetches GET /api/nav/counts on
// every pathname change. PortalRail and SiteNav share one store, so one
// navigation costs one request. Whichever value arrived last wins.

let current: NavCounts | null = null;
let lastInitial: NavCounts | null | undefined;
let fetchedFor: string | null = null;
let inflightFor: string | null = null;
// Bumped whenever the server delivers counts (a layout re-render after an
// admin action), so a fetch started before it can never overwrite them.
let gen = 0;
// Set when the counts endpoint says the session is gone (401, or the proxy's
// redirect to /login once no session cookie is left): the chrome is showing
// a viewer that no longer exists, so the hook refreshes the router once.
let staleFor: string | null = null;
let refreshedFor: string | null = null;
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

function getServerSnapshot(): NavCounts | null {
  return null;
}

function getStale(): string | null {
  return staleFor;
}

function getServerStale(): string | null {
  return null;
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

function refresh(path: string): void {
  if (fetchedFor === path || inflightFor === path) return;
  inflightFor = path;
  const g = gen;
  fetch('/api/nav/counts', { cache: 'no-store' })
    .then((r) => {
      if (r.status === 401 || r.redirected) {
        staleFor = path;
        emit();
        return null;
      }
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

export function useLiveNavCounts(initial: NavCounts | null | undefined, enabled: boolean): NavCounts | null {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const stale = useSyncExternalStore(subscribe, getStale, getServerStale);
  useEffect(() => {
    if (!enabled) return;
    acceptInitial(initial, pathname);
  }, [enabled, initial, pathname]);
  useEffect(() => {
    if (enabled) refresh(pathname);
  }, [enabled, pathname]);
  useEffect(() => {
    if (stale && stale === pathname && refreshedFor !== stale) {
      refreshedFor = stale;
      router.refresh();
    }
  }, [stale, pathname, router]);
  if (!enabled) return null;
  return live ?? initial ?? null;
}
