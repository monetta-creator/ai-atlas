'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';

export interface DeckSlideItem {
  id: string;
  title: string;
  node: ReactNode;
}

// The cost deck's controller: clones components/showcase/Showcase.tsx's
// pagination (arrows, space, edge taps, swipe, dots, Escape overview) inside
// a fixed 16:9 stage, plus a PDF export action (the 'p' key or the chrome
// button) that opens the react-pdf export in a new tab. Slides are
// server-rendered nodes from renderDeckSlides; this component only decides
// which one is on stage.
export default function DeckController({
  slides,
  backHref = '/costs',
  pdfHref = '/costs/deck/pdf',
}: {
  slides: DeckSlideItem[];
  backHref?: string;
  pdfHref?: string;
}) {
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOverview((v) => !v); return; }
      if (e.key === 'p' || e.key === 'P') {
        window.open(pdfHref, '_blank', 'noopener');
        return;
      }
      if (overview) return;
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, count - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Home') {
        setIndex(0);
      } else if (e.key === 'End') {
        setIndex(count - 1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [count, overview, pdfHref]);

  const chrome = (
    <div className="cdk-chrome-top">
      <Link href={backHref} className="cdk-back">&larr; {backHref}</Link>
      <div className="cdk-chrome-actions">
        <span className="cdk-count">{index + 1} / {count}</span>
        <a
          className="cdk-pdf-btn"
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          PDF
        </a>
      </div>
    </div>
  );

  if (overview) {
    return (
      <div className="cdk-root">
        {chrome}
        <div className="cdk-overview">
          <div className="cdk-overview-head">Cost report &middot; {count} slides &middot; Esc to return</div>
          <div className="cdk-overview-grid">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="cdk-overview-card"
                data-active={i === index ? '' : undefined}
                onClick={() => { setIndex(i); setOverview(false); }}
              >
                <span className="cdk-overview-n">{String(i + 1).padStart(2, '0')}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cdk-root">
      {chrome}
      <div
        className="cdk-stage"
        onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start == null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (Math.abs(dx) < 48) return;
          if (dx < 0) setIndex((i) => Math.min(i + 1, count - 1));
          else setIndex((i) => Math.max(i - 1, 0));
        }}
      >
        <div key={slides[index].id}>
          {slides[index].node}
        </div>

        {/* Edge tap zones: narrow, so links/buttons in the middle stay tappable. */}
        {index > 0 && (
          <button
            type="button"
            className="cdk-tap cdk-tap--left"
            aria-label="Previous slide"
            onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          />
        )}
        {index < count - 1 && (
          <button
            type="button"
            className="cdk-tap cdk-tap--right"
            aria-label="Next slide"
            onClick={() => setIndex((i) => Math.min(i + 1, count - 1))}
          />
        )}
      </div>

      <div className="cdk-dots" role="tablist" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${s.title}`}
            className="cdk-dot"
            data-active={i === index ? '' : undefined}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
