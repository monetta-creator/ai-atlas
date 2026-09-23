'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { NavCounts } from './nav';
import { createNavCountsStore } from './nav-counts-store';
import { refreshChromeOnce } from './chrome-session-client';

// The React face of lib/nav-counts-store.ts: one store for the whole chrome
// (PortalRail and SiteNav both call the hook, one fetch per navigation). When
// the counts endpoint says the session is gone, the chrome is re-rendered
// once per pathname through lib/chrome-session-client.ts.

// The arrow defers the global lookup so the module can be imported where
// fetch is undefined.
const store = createNavCountsStore((...a) => fetch(...a));

function getServerSnapshot(): NavCounts | null {
  return null;
}

export function useLiveNavCounts(initial: NavCounts | null | undefined, enabled: boolean): NavCounts | null {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const live = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (!enabled) return;
    store.acceptInitial(initial, pathname);
  }, [enabled, initial, pathname]);
  useEffect(() => {
    if (enabled) store.refresh(pathname, () => refreshChromeOnce(router, pathname));
  }, [enabled, pathname, router]);
  if (!enabled) return null;
  return live ?? initial ?? null;
}
