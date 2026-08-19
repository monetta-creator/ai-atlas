'use client';

import { useEffect, useRef, useState } from 'react';
import type { ViewDataset } from '@/lib/types';
import { toTSV, toCSV, toMarkdown, fileStem } from '@/lib/viewdata';

// Reusable "View data" affordance: a small trigger that opens a modal showing exactly the data a
// chart renders, with a methodology note, an "as of" timestamp, column definitions, a source line,
// and copy-TSV / download-CSV / copy-Markdown. Drop one in any chart card header.
//
// SAFETY: feed it ONLY the data the component already received from the server (already personal-
// stripped for guests). Never re-fetch inside a dataset builder. See ViewDataset in lib/types.ts.
//
// Patterns reused: clipboard from ShareLinkButton, Escape/outside-click from SiteNav's Dropdown.
export default function ViewData({ dataset, label = 'View data' }: { dataset: ViewDataset; label?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [asOf] = useState(() => new Date()); // captured at mount ≈ page-load (force-dynamic fetch)
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Capture the trigger at open time: focus must return to the button that opened
    // the modal, and the ref's .current may have changed by cleanup.
    const trigger = triggerRef.current;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      trigger?.focus();
    };
  }, [open]);

  function flash(key: string) {
    setCopied(key);
    window.setTimeout(() => setCopied((k) => (k === key ? null : k)), 2000);
  }
  async function copy(key: string, text: string) {
    try { await navigator.clipboard.writeText(text); flash(key); }
    catch { window.prompt('Copy:', text); }
  }
  function downloadCSV() {
    const url = URL.createObjectURL(new Blob([toCSV(dataset)], { type: 'text/csv;charset=utf-8' }));
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileStem(dataset.title)}-${asOf.toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash('csv'); // only after a successful click — no false "Downloaded ✓"
    } finally {
      URL.revokeObjectURL(url); // always revoke, even if click() throws
    }
  }

  const defs = dataset.columns.filter((c) => c.def);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--quiet btn--sm"
        onClick={() => setOpen(true)}
        title="View the data behind this chart"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M2 6h12M6.5 6v7.5" />
        </svg>
        {label}
      </button>

      {open && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label={dataset.title} tabIndex={-1} ref={panelRef}>
            <div className="modal-head">
              <h2>{dataset.title}</h2>
              <button type="button" className="modal-close" aria-label={`Close ${dataset.title}`} onClick={() => setOpen(false)}>✕</button>
            </div>

            {dataset.methodology && <p className="modal-note">{dataset.methodology}</p>}
            <p className="modal-meta">
              {dataset.source && <span>{dataset.source}</span>}
              <span>As of {asOf.toLocaleString()}</span>
            </p>

            <div className="modal-scroll">
              <table className="viewdata-table">
                <thead>
                  <tr>{dataset.columns.map((c) => <th key={c.key} title={c.def}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {dataset.rows.map((r, i) => (
                    <tr key={i}>
                      {dataset.columns.map((c, j) => (
                        <td key={c.key} className={j === 0 ? 'vd-label' : 'vd-num'}>{r[c.key] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {defs.length > 0 && (
              <dl className="modal-defs">
                {defs.map((c) => (
                  <div key={c.key}><dt>{c.label}</dt><dd>{c.def}</dd></div>
                ))}
              </dl>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy('tsv', toTSV(dataset))}>
                {copied === 'tsv' ? 'Copied ✓' : 'Copy TSV'}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={downloadCSV}>
                {copied === 'csv' ? 'Downloaded ✓' : 'Download CSV'}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => copy('md', toMarkdown(dataset))}>
                {copied === 'md' ? 'Copied ✓' : 'Copy Markdown'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
