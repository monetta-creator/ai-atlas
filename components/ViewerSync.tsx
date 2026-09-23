'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The chrome renders once in the root layout and does not re-render on a
// client navigation, so a session change made outside this tab (sign-out or a
// preview toggle in another tab, an expired cookie) would leave it showing the
// old viewer. When the tab comes back into view or focus, ask the server who
// we are now and refresh the router (which re-renders the layout) if it
// differs from what the chrome was rendered for. In-tab changes need none of
// this: login, logout and the toggles are cookie-setting server actions, and
// Next re-renders the layout after those.
export default function ViewerSync({ viewer }: { viewer: string }) {
  const router = useRouter();
  useEffect(() => {
    let busy = false;
    const check = () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      fetch('/api/nav/viewer', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ key?: string }>) : null))
        .then((v) => {
          if (v?.key && v.key !== viewer) router.refresh();
        })
        .catch(() => { /* offline or mid-deploy: try again next focus */ })
        .finally(() => { busy = false; });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [viewer, router]);
  return null;
}
