'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_ICONS } from '@/components/portal-icons';
import { usePathnameChange } from '@/lib/use-route-change';
import { refreshChromeOnce, sessionLost, chromeSessionAlive } from '@/lib/chrome-session-client';
import type { AgentPulse } from '@/lib/agent/types';
import AgentDrawer from '@/components/agent/AgentDrawer';
import AgentToasts from '@/components/agent/AgentToasts';

const POLL_MS = 60_000;

// The Atlas Agent entry point: a rail icon (desktop) or a menu row (the
// mobile sheet), each owning the same drawer. Polls GET /api/agent/pulse
// every 60s so the badge and the toast stack stay current without the drawer
// open; paused when the tab is hidden. The poll effect's `live` flag drops
// an out-of-order response, so the last successful poll wins, and no
// setState runs synchronously in an effect body.
export default function AgentOrb({
  variant, initialPulse,
}: { variant: 'rail' | 'menu'; initialPulse: AgentPulse | null }) {
  const [open, setOpen] = useState(false);
  // Close the drawer when the page changes (lib/use-route-change.ts).
  usePathnameChange(() => setOpen(false));
  const [tick, setTick] = useState(0);
  const [polled, setPolled] = useState<AgentPulse | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const router = useRouter();
  useEffect(() => {
    if (tick === 0) return; // the server-rendered initialPulse covers first paint
    let live = true;
    fetch('/api/agent/pulse', { cache: 'no-store' })
      .then((r) => {
        // The session ended under the persistent chrome: re-render it.
        // (Once per pathname, read at response time so a navigation does not
        // re-run this effect.)
        if (sessionLost(r)) { if (live) refreshChromeOnce(router, window.location.pathname); return Promise.reject(new Error('session')); }
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((data: AgentPulse) => { chromeSessionAlive(); if (live) setPolled(data); })
      .catch(() => { /* keep the last known pulse */ });
    return () => { live = false; };
  }, [tick, router]);

  // The chrome persists across navigation now, so initialPulse can be hours
  // old: it covers first paint only, then the last successful poll wins.
  const pulse = polled ?? initialPulse;
  const unread = pulse?.unread ?? 0;
  const high = pulse?.high ?? 0;

  function openDrawer() {
    setOpen(true);
    const keys = pulse?.newSince.map((f) => f.key) ?? [];
    if (keys.length) {
      fetch('/api/agent/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      })
        .catch(() => { /* the drawer still opens; next poll retries */ })
        .finally(() => setTick((t) => t + 1));
    }
  }

  const label = unread > 0 ? `Atlas Agent, ${unread} to look at` : 'Atlas Agent';

  return (
    <>
      {variant === 'rail' ? (
        <button
          type="button"
          className="portal-rail-link"
          data-tip="Atlas Agent"
          aria-label={label}
          onClick={openDrawer}
        >
          {NAV_ICONS.agent}
          <span className="portal-rail-label">Atlas Agent</span>
          {unread > 0 && (
            <span className="ag-badge" data-high={high > 0 ? '' : undefined}>{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
      ) : (
        <button
          type="button"
          className="navmenu-item"
          onClick={(e) => { e.stopPropagation(); openDrawer(); }}
        >
          Atlas Agent{unread > 0 ? ` · ${unread}` : ''}
        </button>
      )}

      {variant === 'rail' && pulse && (
        <AgentToasts pulse={pulse} onOpen={openDrawer} />
      )}

      {open && (
        <AgentDrawer
          open={open}
          onClose={() => setOpen(false)}
          pulse={pulse}
        />
      )}
    </>
  );
}
