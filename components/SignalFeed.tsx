'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { SignalsPageResult, SignalContext } from '@/lib/types';
import { getSignalsFeedAction } from '@/lib/actions';
import { SIGNAL_CONTEXT_SLUGS, SIGNAL_CONTEXT_LABEL, signalContextColor } from '@/lib/format';
import SignalCard from './SignalCard';

// One layer of the Signal Board feed (published OR draft). Context/significance/search/pagination
// run through getSignalsFeedAction so they don't re-render the rest of the page; the server
// hands page 1 as `initial`. The action recomputes admin server-side and forces guests to
// published-only, so a `status="unpublished"` instance is only ever mounted for the admin —
// and even a forged call would still get published-only. UI is not the gate.
export default function SignalFeed({
  initial, status, admin, reloadToken, redirectTo,
}: {
  initial: SignalsPageResult;
  status: 'published' | 'unpublished' | 'archived';
  admin: boolean;
  // Bump from a parent to force a re-fetch of the current page (e.g. after a draft merge/
  // discard elsewhere on the page changed the underlying set). Optional; unused on the feed.
  reloadToken?: number;
  // Where admin card actions (publish/archive) return after acting; forwarded to SignalCard.
  redirectTo?: string;
}) {
  const [contexts, setContexts] = useState<SignalContext[]>([]);
  const [highOnly, setHighOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SignalsPageResult>(initial);
  const [pending, setPending] = useState(false);
  const firstRender = useRef(true);

  // Debounce the search box; committing a new term resets to page 1.
  useEffect(() => {
    const id = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // Swap the visible set inside a view transition when the browser supports it, so
  // filtered/paged post-its morph between positions (each card carries a stable
  // viewTransitionName). flushSync makes React commit inside the snapshot callback.
  // Firefox et al. fall back to a plain swap + the cards' entry animation.
  function applyResult(r: SignalsPageResult) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => { flushSync(() => setResult(r)); });
    } else {
      setResult(r);
    }
  }

  // Re-fetch when a committed filter or the page changes. Skip the first render — the server
  // already handed us page 1 as `initial`. Stale responses are dropped (`cancelled`).
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    let cancelled = false;
    setPending(true);
    (async () => {
      try {
        const r = await getSignalsFeedAction({
          status,
          contexts: contexts.length ? contexts : undefined,
          significance: highOnly ? ['high'] : undefined,
          search: debounced || undefined,
          page,
        });
        if (!cancelled) applyResult(r);
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contexts, highOnly, debounced, page, status, reloadToken]);

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const anyFilter = contexts.length > 0 || highOnly || !!search;
  const noun = status === 'archived' ? 'archived draft' : status === 'unpublished' ? 'draft' : 'signal';

  function toggleContext(c: SignalContext) {
    setContexts((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
    setPage(1);
  }
  function clearAll() { setContexts([]); setHighOnly(false); setSearch(''); setDebounced(''); setPage(1); }

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="lens-chip-row">
          {SIGNAL_CONTEXT_SLUGS.map((c) => {
            const on = contexts.includes(c);
            const color = signalContextColor(c);
            return (
              <button
                key={c}
                type="button"
                className="lenschip"
                data-on={on ? '' : undefined}
                onClick={() => toggleContext(c)}
                style={on ? { color, borderColor: `color-mix(in oklab, ${color} 45%, var(--line))`, background: `color-mix(in oklab, ${color} 12%, var(--surface))` } : undefined}
              >
                {SIGNAL_CONTEXT_LABEL[c]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12.5 }}>
          <input
            className="input"
            placeholder="Search title or summary…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 180, padding: '8px 12px', fontSize: 13 }}
          />
          <button
            type="button"
            className="lenschip"
            data-on={highOnly ? '' : undefined}
            onClick={() => { setHighOnly((v) => !v); setPage(1); }}
          >
            High significance
          </button>
          {anyFilter && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll}>Clear</button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
          {result.total} {noun}{result.total === 1 ? '' : 's'}{pending ? ' · loading…' : ''}
        </div>
      </div>

      {/* Feed */}
      {result.rows.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)', fontSize: 14, margin: 0 }}>
          No {noun}s {anyFilter ? 'match these filters' : 'yet'}.
        </p>
      ) : (
        <div className="signal-feed" style={{ opacity: pending ? 0.55 : 1, transition: 'opacity .15s' }}>
          {result.rows.map((s) => <SignalCard key={s.id} signal={s} admin={admin} redirectTo={redirectTo} />)}
        </div>
      )}

      {/* Pagination */}
      {result.total > result.pageSize && (
        <div className="flex items-center justify-between gap-2" style={{ fontSize: 12.5 }}>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            ← Prev
          </button>
          <span style={{ color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>Page {page} of {totalPages}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
