'use client';

import { useEffect, useState } from 'react';
import type { PageInfoContent } from '@/lib/page-info';

// The round "i" at the top of every page and the explainer it opens. Same
// overlay idiom as the feedback dialog and the agent drawer: Escape, backdrop
// and the close button all dismiss it; the .fb-card shell supplies the
// entry animation and the dvh-aware height.
export default function PageInfo({ content }: { content: PageInfoContent }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="pagetop-info"
        aria-label="About this page"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="About this page"
        onClick={() => setOpen(true)}
      >
        i
      </button>
      {open && (
        <div className="fb-overlay" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="fb-card pagetop-info-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pagetop-info-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="btn btn--quiet btn--sm fb-close" onClick={() => setOpen(false)} autoFocus aria-label="Close">
              ✕
            </button>
            <p className="fb-kicker">About this page</p>
            <h2 id="pagetop-info-title" className="fb-title">{content.title}</h2>
            <p className="fb-sub">{content.summary}</p>
            {content.sections.map((s) => (
              <div key={s.heading}>
                <div className="pagetop-info-h">{s.heading}</div>
                <p className="pagetop-info-p">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
