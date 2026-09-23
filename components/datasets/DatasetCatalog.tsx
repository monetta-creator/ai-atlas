'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SIGNAL_LENSES } from '@/lib/datasets/core';
import {
  CATEGORY_LABELS, filterCards, countLine,
  type DatasetCard, type DatasetAccessFilter,
} from '@/lib/datasets/cards';
import AskForData from '@/components/datasets/AskForData';

// The Data Portal hub's catalog: a filter plate (search + access + category,
// the .tl-filters/.tl-toolbar idiom from /tooling, unscoped so it is safe to
// reuse verbatim) over a card grid. Filtering is client-side and synchronous
// (filterCards is pure, no server round trip), mirrored to the URL with
// history.replaceState like the Report Portal grid; the page reads the same
// params to seed `initial` on the next SSR.

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[];

export default function DatasetCatalog({
  cards, viewer, initial,
}: {
  cards: DatasetCard[];
  viewer: { admin: boolean; portal: boolean };
  initial: { q: string; access: DatasetAccessFilter; category: string };
}) {
  const [qInput, setQInput] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [access, setAccess] = useState<DatasetAccessFilter>(initial.access);
  const [category, setCategory] = useState(initial.category);
  const firstRender = useRef(true);
  const unlocked = viewer.admin || viewer.portal;

  // Debounce the search box, same idiom as ReportGrid: the commit happens in
  // a timer callback, never synchronously in the effect body.
  useEffect(() => {
    if (qInput.trim() === q) return;
    const id = setTimeout(() => setQ(qInput.trim()), 150);
    return () => clearTimeout(id);
  }, [qInput, q]);

  // URL sync: reflect q/access/category, preserving an existing `key` param
  // (the renewal-notice deep link, app/datasets/page.tsx:33) the same way
  // ReportGrid preserves `generate`. Skip the very first run so we don't
  // rewrite a URL that already matches `initial`.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const key = new URLSearchParams(window.location.search).get('key');
    const usp = new URLSearchParams();
    if (q) usp.set('q', q);
    if (access !== 'all') usp.set('access', access);
    if (category) usp.set('category', category);
    if (key) usp.set('key', key);
    const qs = usp.toString();
    window.history.replaceState(null, '', qs ? `/datasets?${qs}` : '/datasets');
  }, [q, access, category]);

  const filtered = useMemo(
    () => filterCards(cards, { q, access, category }),
    [cards, q, access, category]
  );

  const publicCount = useMemo(() => cards.filter((c) => !c.keyGated).length, [cards]);
  const keyCount = cards.length - publicCount;
  const anyFilter = q !== '' || access !== 'all' || category !== '';
  const line = countLine(cards.length, filtered.length, publicCount, keyCount);

  function clearAll() {
    setQInput('');
    setQ('');
    setAccess('all');
    setCategory('');
  }

  return (
    <div>
      <div className="tl-filters">
        <div className="tl-toolbar">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search datasets, columns"
            aria-label="Search datasets and columns"
            className="input tl-search"
          />
          <label className="tl-select">
            <span>Access</span>
            <select value={access} onChange={(e) => setAccess(e.target.value as DatasetAccessFilter)}>
              <option value="all">All access</option>
              <option value="public">Public</option>
              <option value="key">Access key</option>
            </select>
          </label>
          <label className="tl-select">
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
          </label>
          {anyFilter && <button type="button" className="tl-clear" onClick={clearAll}>Clear all ×</button>}
        </div>
      </div>

      <AskForData
        unlocked={unlocked}
        datasets={cards.map((c) => ({ slug: c.slug, title: c.title, keyGated: c.keyGated }))}
      />

      <p className="dp-count" aria-live="polite">{line}</p>

      {filtered.length === 0 ? (
        <p className="dp-empty">
          No datasets match.{' '}
          <button type="button" className="btn btn--quiet btn--sm" onClick={clearAll}>Clear</button>
        </p>
      ) : anyFilter ? (
        <div className="dp-grid">
          {filtered.map((card) => (
            <DatasetCardView key={card.slug} card={card} unlocked={unlocked} kicker />
          ))}
        </div>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const list = cards.filter((c) => c.category === cat);
          if (!list.length) return null;
          return (
            <div key={cat} className="dp-group">
              <div className="section-label">{CATEGORY_LABELS[cat]}</div>
              <div className="dp-grid" style={{ marginTop: 14 }}>
                {list.map((card) => (
                  <DatasetCardView key={card.slug} card={card} unlocked={unlocked} kicker={false} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function DatasetCardView({ card, unlocked, kicker }: { card: DatasetCard; unlocked: boolean; kicker: boolean }) {
  const open = !card.keyGated || unlocked;
  const chipLabel = !card.keyGated ? 'public' : unlocked ? 'unlocked' : 'access key';
  return (
    <div className="plate dp-card" style={{ padding: 'var(--card-pad)' }}>
      <div className="dp-card-head">
        <div style={{ minWidth: 0 }}>
          {kicker && <div className="dp-kicker">{card.categoryLabel}</div>}
          <Link href={card.href} prefetch={false} style={{ textDecoration: 'none', color: 'var(--ink)' }}>
            <h3 style={{ marginBottom: 6 }}>{card.title}</h3>
          </Link>
        </div>
        <span className={card.keyGated ? 'badge badge--accent' : 'badge'}>{chipLabel}</span>
      </div>

      <p className="dp-desc">{card.description}</p>

      <div className="dp-meta">
        {card.slug} · {card.columnCount} columns · {card.formats.join(' / ')}
        {card.heavy ? ' · heavy' : ''}
      </div>

      <div className="dp-actions">
        {open ? (
          <>
            <a className="btn btn--ghost btn--sm" href={card.csvHref}>CSV</a>
            <a className="btn btn--quiet btn--sm" href={card.jsonHref}>JSON</a>
            <Link className="btn btn--quiet btn--sm" href={card.href} prefetch={false}>Schema</Link>
            <Link className="btn btn--quiet btn--sm" href={`${card.href}#query`} prefetch={false}>Query</Link>
          </>
        ) : (
          <>
            <Link className="btn btn--quiet btn--sm" href={card.href} prefetch={false}>Schema</Link>
            {/* The builder itself explains the gate and offers Unlock/Request
                access inline, so a locked card can link straight into it. */}
            <Link className="btn btn--quiet btn--sm" href={`${card.href}#query`} prefetch={false}>Query</Link>
            <Link className="btn btn--quiet btn--sm" href="/ask">Unlock</Link>
            <Link className="btn btn--ghost btn--sm" href="/datasets/request">Request access</Link>
          </>
        )}
      </div>

      {card.lensSlices && open && (
        <div className="dp-lens">
          <span className="dp-lens-label">lens slices</span>
          {SIGNAL_LENSES.map((lens) => (
            <a
              key={lens}
              className="btn btn--quiet btn--sm"
              href={`${card.csvHref}?lens=${lens}`}
              title={`Download the ${lens} slice as CSV`}
            >
              {lens}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
