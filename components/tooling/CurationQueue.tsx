'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  bulkReviewAction, markReviewedAction, rescoreParkedAction, reviewProductAction,
} from '@/lib/actions';
import { fitBand } from '@/lib/tooling/report-core';
import { TOOLING_MATURITY_LABEL } from '@/lib/format';
import type { ToolingProduct, ToolingStatus } from '@/lib/types';

// The admin curation queue: three buckets in the order getCurationQueue
// already sorts them in (cataloged-but-unreviewed entrants, parked, raw
// candidates), a shared selection for the bulk toolbar, and a per-row
// inline review form. Cataloging by hand needs a why (reviewProductAction
// enforces it per row; the bulk Catalog button applies ONE shared note to
// every selected product and stays disabled until that note is typed).
const FIT_COLOR: Record<string, string> = {
  strong: 'var(--supports)',
  solid: 'var(--heat-2)',
  marginal: 'var(--heat-3)',
  weak: 'var(--faint-ink)',
};

function Group({
  title, products, selected, onToggle, onToggleAll,
}: {
  title: string;
  products: ToolingProduct[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], on: boolean) => void;
}) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const router = useRouter();

  if (products.length === 0) return null;

  async function act(id: string, status: ToolingStatus, pinned: boolean, why: string | null) {
    setBusy(id);
    setRowError(null);
    try {
      const res = await reviewProductAction(id, status, pinned, why);
      if ('error' in res) { setRowError({ id, msg: res.error }); return; }
      setReviewing(null);
      setNote('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const allOn = products.every((p) => selected.has(p.id));

  return (
    <div style={{ marginTop: 18 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ margin: 0 }}>{title} · {products.length}</span>
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => onToggleAll(products.map((p) => p.id), !allOn)}>
          {allOn ? 'Clear selection' : 'Select all'}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {products.map((p) => {
          const band = fitBand(p.agent_fit ?? null);
          return (
            <div key={p.id} className="rounded-[var(--radius)] border p-2.5" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
              <div className="flex items-center flex-wrap gap-2 text-xs" style={{ color: 'var(--dim)' }}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} />
                <Link href={`/tooling/${p.slug}`} className="hover:underline" style={{ color: 'var(--ink)', fontWeight: 600 }}>
                  {p.name}
                </Link>
                {p.vendor && <span style={{ color: 'var(--faint-ink)' }}>{p.vendor}</span>}
                <span className="touch-chip" style={{ fontSize: 10, padding: '2px 8px' }}>{p.category}</span>
                <span style={{ color: 'var(--faint-ink)' }}>{TOOLING_MATURITY_LABEL[p.maturity]}</span>
                {band && (
                  <span style={{ color: FIT_COLOR[band] ?? 'var(--faint-ink)', fontWeight: 600 }}>
                    ✦ {band} {p.agent_fit != null ? `(${p.agent_fit})` : ''}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                  first seen {p.first_seen}
                </span>
              </div>
              {p.agent_reason && (
                <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 6 }}>
                  <span style={{ color: 'var(--faint-ink)' }}>Agent: </span>
                  {p.agent_reason.length > 220 ? `${p.agent_reason.slice(0, 220)}…` : p.agent_reason}
                </p>
              )}

              {reviewing === p.id ? (
                <div className="flex flex-col gap-2" style={{ marginTop: 8, maxWidth: 480 }}>
                  <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Why catalog this product?" disabled={busy === p.id} />
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === p.id || !note.trim()}
                      onClick={() => void act(p.id, 'cataloged', p.pinned, note)}>
                      {busy === p.id ? 'Cataloging…' : 'Catalog it'}
                    </button>
                    <button type="button" className="btn btn--quiet btn--sm" disabled={busy === p.id}
                      onClick={() => { setReviewing(null); setNote(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
                  {p.status !== 'cataloged' && (
                    <button type="button" className="btn btn--primary btn--sm" disabled={busy === p.id}
                      onClick={() => { setNote(p.agent_reason ?? ''); setReviewing(p.id); }}>
                      Catalog…
                    </button>
                  )}
                  {p.status !== 'parked' && (
                    <button type="button" className="btn btn--quiet btn--sm" disabled={busy === p.id}
                      onClick={() => void act(p.id, 'parked', p.pinned, p.review_note ?? null)}>
                      Park
                    </button>
                  )}
                  {p.status !== 'dismissed' && (
                    <button type="button" className="btn btn--quiet btn--sm" disabled={busy === p.id}
                      onClick={() => void act(p.id, 'dismissed', false, p.review_note ?? null)}>
                      Dismiss
                    </button>
                  )}
                  <button type="button" className="btn btn--ghost btn--sm" disabled={busy === p.id}
                    onClick={() => void act(p.id, p.status, !p.pinned, p.review_note ?? null)}>
                    {p.pinned ? '★ Pinned' : '☆ Pin'}
                  </button>
                </div>
              )}
              {rowError?.id === p.id && (
                <p className="text-xs" style={{ color: 'var(--heat-4)', marginTop: 6 }}>{rowError.msg}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CurationQueue({ products }: { products: ToolingProduct[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  const groups = useMemo(() => {
    const unreviewed = products.filter((p) => p.status === 'cataloged');
    const parked = products.filter((p) => p.status === 'parked');
    const candidates = products.filter((p) => p.status === 'candidate');
    return { unreviewed, parked, candidates };
  }, [products]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const selectedIds = [...selected];
  const allSelectedParked = selectedIds.length > 0 && selectedIds.every((id) => byId.get(id)?.status === 'parked');

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], on: boolean) {
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }

  async function bulk(kind: 'catalog' | 'park' | 'dismiss' | 'reviewed' | 'rescore') {
    if (selectedIds.length === 0) return;
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'reviewed') {
        await markReviewedAction(selectedIds);
        setMessage(`Marked ${selectedIds.length} reviewed.`);
      } else if (kind === 'rescore') {
        await rescoreParkedAction(selectedIds);
        setMessage(`Queued ${selectedIds.length} for rescoring.`);
      } else {
        const status = kind === 'catalog' ? 'cataloged' : kind === 'park' ? 'parked' : 'dismissed';
        const res = await bulkReviewAction(selectedIds, status, kind === 'catalog' ? bulkNote : null);
        if ('error' in res) setMessage(res.error);
        else setMessage(`${res.count} product${res.count === 1 ? '' : 's'} moved to ${status}.`);
      }
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (products.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--faint-ink)' }}>
        The queue is clear. Discovery runs land new entrants and candidates here.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>
          {selectedIds.length} selected
        </span>
        <input
          className="input"
          value={bulkNote}
          onChange={(e) => setBulkNote(e.target.value)}
          placeholder="Shared why (required to catalog)"
          aria-label="Shared review note for a bulk catalog"
          style={{ maxWidth: 260, fontSize: 12 }}
        />
        <button type="button" className="btn btn--quiet btn--sm"
          disabled={!selectedIds.length || !!busy || !bulkNote.trim()}
          title={bulkNote.trim() ? undefined : 'Cataloging needs a shared why'}
          onClick={() => void bulk('catalog')}>
          Catalog
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!selectedIds.length || !!busy}
          onClick={() => void bulk('park')}>
          Park
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!selectedIds.length || !!busy}
          onClick={() => void bulk('dismiss')}>
          Dismiss
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!selectedIds.length || !!busy}
          onClick={() => void bulk('reviewed')}>
          Mark reviewed
        </button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={!allSelectedParked || !!busy}
          title={allSelectedParked ? undefined : 'Select only parked products to rescore'}
          onClick={() => void bulk('rescore')}>
          Rescore
        </button>
      </div>
      {message && <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 8 }}>{message}</p>}

      <Group title="New this week (unreviewed)" products={groups.unreviewed} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <Group title="Parked" products={groups.parked} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      <Group title="Candidates" products={groups.candidates} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
    </div>
  );
}
