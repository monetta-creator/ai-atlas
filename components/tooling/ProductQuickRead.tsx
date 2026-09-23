'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { dateLabel } from '@/lib/format';
import { DEPLOYMENT_LABEL, TARGET_BUYER_LABEL, humanize } from './labels';
import ProductLogo from './ProductLogo';
import AgentReadPanel from './AgentReadPanel';
import type { TableRow } from '@/lib/tooling/table-core';

interface EventRow {
  id: string;
  event_date: string;
  kind: string;
  title: string;
  url: string | null;
  source: string;
}

function fieldRow(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-baseline gap-2 text-sm" key={label}>
      <span style={{ color: 'var(--faint-ink)', minWidth: 120 }}>{label}</span>
      <span style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

// The tooling table's quick-read drawer: a row's full facts + agent read (for
// portal/admin) + latest events, without leaving the table. Cloned from the
// .pv-* paper-reader shell (see app/styles/paper-reader.css) as .tl-drawer.
export default function ProductQuickRead({
  row, portal, onClose,
}: {
  row: TableRow;
  portal: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [events, setEvents] = useState<{ productId: string; rows: EventRow[] } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [row.id]);

  useEffect(() => {
    let live = true;
    fetch(`/api/tooling/events?product=${encodeURIComponent(row.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { events: EventRow[] }) => { if (live) setEvents({ productId: row.id, rows: data.events }); })
      .catch(() => { if (live) setEvents({ productId: row.id, rows: [] }); });
    return () => { live = false; };
  }, [row.id]);

  const rowEvents = events && events.productId === row.id ? events.rows : null;

  return (
    <>
      <div className="tl-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="tl-drawer" role="dialog" aria-modal="true" aria-label={`Quick read: ${row.name}`}>
        <div className="pv-head">
          <span className="pv-title">{row.name}</span>
          <button type="button" ref={closeRef} className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close quick read">
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="flex items-center gap-3">
            <ProductLogo name={row.name} domain={row.vendorDomain} url={row.url} size={40} />
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>
                {row.pinned && <span role="img" aria-label="Pinned by an editor" style={{ color: 'var(--accent)', marginRight: 6 }}>★</span>}
                {row.name}
              </div>
              <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                {[row.vendor, row.categoryName].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          {row.oneLiner && <p className="text-sm" style={{ color: 'var(--dim)', margin: 0 }}>{row.oneLiner}</p>}

          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>Facts</div>
            <div
              className="flex flex-col gap-2 rounded-[var(--radius)] border p-3"
              style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}
            >
              {fieldRow('Maturity', row.maturityLabel)}
              {fieldRow('Deployment', row.deployment.map((d) => DEPLOYMENT_LABEL[d] ?? d).join(', ') || null)}
              {fieldRow('Pricing', row.pricingLabel)}
              {fieldRow('Target buyers', row.targetBuyers.map((t) => TARGET_BUYER_LABEL[t] ?? humanize(t)).join(', ') || null)}
              {fieldRow('Compliance', row.compliance.map((c) => humanize(c)).join(', ') || null)}
              {fieldRow('First seen', dateLabel(row.firstSeen))}
            </div>
          </div>

          {row.allFeatures.length > 0 && (
            <div>
              <div className="section-label" style={{ marginBottom: 8 }}>Features</div>
              <div className="flex items-center flex-wrap gap-1.5">
                {row.allFeatures.map((f) => (
                  <span key={f} className="badge" style={{ fontSize: 11 }}>{f}</span>
                ))}
              </div>
            </div>
          )}

          {portal && row.fitBand && (
            <div>
              <div className="section-label" style={{ marginBottom: 8 }}>Agent read</div>
              <AgentReadPanel fit={row.fit} scores={row.scores} reason={null} />
            </div>
          )}

          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>Latest events</div>
            {rowEvents === null ? (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>Loading…</p>
            ) : rowEvents.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--faint-ink)' }}>No tracked events yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {rowEvents.map((e) => (
                  <div key={e.id} className="text-sm" style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      {dateLabel(e.event_date)}
                    </span>
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)' }}>
                        {e.title}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--ink)' }}>{e.title}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link href={`/tooling/${row.slug}`} className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }}>
            Open product page →
          </Link>
        </div>
      </div>
    </>
  );
}
