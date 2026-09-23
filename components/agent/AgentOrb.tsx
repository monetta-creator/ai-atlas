'use client';

import { useEffect, useState } from 'react';
import { NAV_ICONS } from '@/components/portal-icons';
import type { AgentPulse } from '@/lib/agent/types';
import AgentDrawer from '@/components/agent/AgentDrawer';
import AgentToasts from '@/components/agent/AgentToasts';

const POLL_MS = 60_000;

// The Atlas Agent entry point: a rail icon (desktop) or a menu row (the
// mobile sheet), each owning the same drawer. Polls GET /api/agent/pulse
// every 60s so the badge and the toast stack stay current without the drawer
// open; paused when the tab is hidden. The derived-state recipe (AskPeek):
// the fetch result carries the tick it answers, so a stale response never
// clobbers a newer one, and no setState runs synchronously in an effect body.
export default function AgentOrb({
  variant, initialPulse,
}: { variant: 'rail' | 'menu'; initialPulse: AgentPulse | null }) {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [polled, setPolled] = useState<{ key: number; data: AgentPulse } | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setTick((t) => t + 1);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (tick === 0) return; // the server-rendered initialPulse covers first paint
    let live = true;
    fetch('/api/agent/pulse', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: AgentPulse) => { if (live) setPolled({ key: tick, data }); })
      .catch(() => { /* keep the last known pulse */ });
    return () => { live = false; };
  }, [tick]);

  const pulse = (polled && polled.key === tick ? polled.data : null) ?? initialPulse;
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
