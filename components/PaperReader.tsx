'use client';

import { useEffect, useState } from 'react';

// The paper's front door, promoted from a tiny mono arrow to real buttons:
// "Read the paper here" opens a right-side drawer with the arXiv paper in an
// iframe. arXiv's LaTeXML HTML version and its PDFs carry no frame-ancestors
// restriction (unlike the abs pages), so this is the one corpus where the
// ask-panel-style side pane works on the ORIGINAL document, not just our
// retained copy. Default view is the HTML reader (renders everywhere,
// reflows); a PDF toggle covers papers whose HTML conversion is missing.
// Manual papers with no arXiv id get the external link only.
export default function PaperReader({
  arxivId, url, title,
}: { arxivId: string | null; url: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'html' | 'pdf'>('html');
  const frameUrl = arxivId
    ? view === 'html' ? `https://arxiv.org/html/${arxivId}` : `https://arxiv.org/pdf/${arxivId}`
    : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 12 }}>
        {frameUrl && (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
            Read the paper here
          </button>
        )}
        <a
          className={frameUrl ? 'btn btn--ghost btn--sm' : 'btn btn--primary btn--sm'}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {arxivId ? 'Open on arXiv ↗' : 'Open the paper ↗'}
        </a>
      </div>

      {open && frameUrl && (
        <>
          <div className="pv-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="pv-drawer" role="dialog" aria-modal="true" aria-label={`Paper: ${title}`}>
            <div className="pv-head">
              <span className="pv-title">{title}</span>
              <div className="pv-toggle" role="group" aria-label="View">
                <button type="button" data-on={view === 'html' ? '' : undefined} onClick={() => setView('html')}>Reader</button>
                <button type="button" data-on={view === 'pdf' ? '' : undefined} onClick={() => setView('pdf')}>PDF</button>
              </div>
              <a className="btn btn--quiet btn--sm" href={url} target="_blank" rel="noopener noreferrer">
                arXiv ↗
              </a>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setOpen(false)} aria-label="Close paper viewer">
                ✕
              </button>
            </div>
            <iframe className="pv-frame" src={frameUrl} title={`${view === 'html' ? 'Reader view' : 'PDF'} of ${title}`} />
          </div>
        </>
      )}
    </>
  );
}
