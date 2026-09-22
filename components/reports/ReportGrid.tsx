'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setSheetPublishedAction, deleteSheetAction } from '@/lib/actions';
import {
  REPORT_KIND_FILTERS, DRAFTS_FILTER, filterCards, paginate,
  type ReportCard,
} from '@/lib/reports/cards';
import ReportCover from './ReportCover';

// The Report Portal grid: search + kind filter + pagination over the cards
// the server already assembled (sheets + period reports + thesis reports,
// sorted newest-first). Mirrors SignalFeed's debounce/view-transition idiom,
// but everything here is a local, synchronous filter/slice over `cards` —
// there is no server round trip, so the "fetch" SignalFeed does is just a
// derived computation.

function runTransition(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => { flushSync(fn); });
  } else {
    fn();
  }
}

function pageWindow(current: number, total: number, size = 7): number[] {
  if (total <= size) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(size / 2));
  let end = start + size - 1;
  if (end > total) {
    end = total;
    start = end - size + 1;
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export default function ReportGrid({
  cards, admin, initial,
}: {
  cards: ReportCard[];
  admin: boolean;
  initial: { q: string; kind: string; page: number };
}) {
  const [qInput, setQInput] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [kind, setKind] = useState(initial.kind);
  const [page, setPage] = useState(initial.page);
  const firstRender = useRef(true);

  // Debounce the search box; committing a new term resets to page 1. Kept
  // inside a timer callback (not the effect body itself), same as SignalFeed.
  useEffect(() => {
    // No-op when the box already matches the committed term (mount, or a
    // trailing-space edit), so a deep-linked ?page= survives the first tick.
    if (qInput.trim() === q) return;
    const id = setTimeout(() => {
      runTransition(() => { setQ(qInput.trim()); setPage(1); });
    }, 150);
    return () => clearTimeout(id);
  }, [qInput, q]);

  // URL sync: reflect q/kind/page as query params, preserving an existing
  // `generate` param (the claim-page deep link into the console). Skip the
  // very first run so we don't rewrite a URL that already matches `initial`.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const generate = new URLSearchParams(window.location.search).get('generate');
    const usp = new URLSearchParams();
    if (q) usp.set('q', q);
    if (kind !== 'all') usp.set('kind', kind);
    if (page !== 1) usp.set('page', String(page));
    if (generate) usp.set('generate', generate);
    const qs = usp.toString();
    window.history.replaceState(null, '', qs ? `/reports?${qs}` : '/reports');
  }, [q, kind, page]);

  function chooseKind(key: string) {
    runTransition(() => { setKind(key); setPage(1); });
  }

  function clearAll() {
    runTransition(() => { setQInput(''); setQ(''); setKind('all'); setPage(1); });
  }

  function goToPage(p: number) {
    runTransition(() => setPage(p));
    document.getElementById('rp-grid')?.scrollIntoView({ block: 'start' });
  }

  const filtered = filterCards(cards, { q, kind, admin });
  const pageData = paginate(filtered, page);
  const draftCount = admin ? cards.filter((c) => !c.isPublished).length : 0;
  const anyFilter = !!q || kind !== 'all';

  return (
    <div>
      <div className="rp-toolbar">
        <input
          className="input"
          aria-label="Search reports"
          placeholder="Search reports…"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        {REPORT_KIND_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="lenschip"
            data-on={kind === f.key || undefined}
            onClick={() => chooseKind(f.key)}
          >
            {f.label}
          </button>
        ))}
        {admin && (
          <button
            type="button"
            className="lenschip"
            data-on={kind === DRAFTS_FILTER.key || undefined}
            onClick={() => chooseKind(DRAFTS_FILTER.key)}
          >
            {DRAFTS_FILTER.label} · {draftCount}
          </button>
        )}
        <span className="rp-count">
          {anyFilter ? `${pageData.total} of ${cards.length} reports` : `${pageData.total} reports`}
        </span>
        {anyFilter && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll}>Clear</button>
        )}
      </div>

      {pageData.items.length === 0 ? (
        <div className="rp-empty">
          No reports match.{' '}
          <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll}>Clear</button>
        </div>
      ) : (
        <div id="rp-grid" className="rp-grid">
          {pageData.items.map((card) => (
            <ReportCardView key={`${card.family}:${card.id}`} card={card} admin={admin} />
          ))}
        </div>
      )}

      {pageData.pages > 1 && (
        <div className="rp-pager">
          <button
            type="button"
            className="lenschip"
            disabled={pageData.page <= 1}
            onClick={() => goToPage(pageData.page - 1)}
          >
            Prev
          </button>
          {pageWindow(pageData.page, pageData.pages).map((p) => (
            <button
              key={p}
              type="button"
              className="lenschip"
              data-on={p === pageData.page || undefined}
              aria-current={p === pageData.page ? 'page' : undefined}
              onClick={() => goToPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            className="lenschip"
            disabled={pageData.page >= pageData.pages}
            onClick={() => goToPage(pageData.page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ReportCardView({ card, admin }: { card: ReportCard; admin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rp-card" data-kind={card.kind}>
      <Link href={card.href} className="rp-cover-link" aria-label={`Read ${card.title}`}>
        <ReportCover card={card} />
      </Link>
      <div className="rp-info">
        <div className="rp-kicker">
          {card.kindLabel}{!card.isPublished && admin ? ' · draft' : ''}
        </div>
        <Link href={card.href} className="rp-title">{card.title}</Link>
        {card.subject && <div className="rp-subject">{card.subject}</div>}
        {card.chips.length > 0 && <div className="rp-chips">{card.chips.join(' · ')}</div>}
        <div className="rp-foot">
          <span className="rp-date">{card.date}</span>
          <a href={card.pdfHref} className="btn btn--ghost btn--sm">PDF</a>
          {admin && card.family === 'sheet' && (
            <>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                disabled={busy}
                onClick={() => void act(() => setSheetPublishedAction(card.id, !card.isPublished))}
              >
                {card.isPublished ? 'Unpublish' : 'Publish'}
              </button>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm('Delete this report? This cannot be undone.')) {
                    void act(() => deleteSheetAction(card.id));
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
