'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 60_000;

// Keeps the ops board current: every widget reads live on the server, so
// this island's only job is to ask for a fresh render on an interval while
// the tab is visible. No client state, no fetch: router.refresh() re-runs
// every server widget in place.
export default function OpsBoardRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [router]);

  return null;
}
