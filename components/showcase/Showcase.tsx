'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ShowSlide {
  id: string;
  title: string;
  node: ReactNode;
}

// The Showcase controller: one full-viewport slide at a time, driven by
// arrows, space, edge taps, swipe, and the dots. Escape toggles a slide
// overview grid. The slides themselves are server-rendered nodes passed in,
// so their stats are live database numbers; this component only decides
// which one is on stage.
export default function Showcase({ slides }: { slides: ShowSlide[] }) {
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOverview((v) => !v); return; }
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
  }, [count, overview]);

  if (overview) {
    return (
      <div className="show-overview">
        <div className="show-kicker" style={{ marginBottom: 6 }}>The Showcase · {count} slides · Esc to return</div>
        <div className="show-overview-grid">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="show-overview-card"
              data-active={i === index ? '' : undefined}
              onClick={() => { setIndex(i); setOverview(false); }}
            >
              <span className="show-overview-n">{String(i + 1).padStart(2, '0')}</span>
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="show-stage"
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
      <div className="show-count">{index + 1} / {count}</div>

      <div className="show-slide" key={slides[index].id}>
        {slides[index].node}
      </div>

      {/* Edge tap zones: narrow, so links and buttons in the middle stay tappable. */}
      {index > 0 && (
        <button
          type="button"
          className="show-tap show-tap--left"
          aria-label="Previous slide"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
        />
      )}
      {index < count - 1 && (
        <button
          type="button"
          className="show-tap show-tap--right"
          aria-label="Next slide"
          onClick={() => setIndex((i) => Math.min(i + 1, count - 1))}
        />
      )}

      <div className="show-dots" role="tablist" aria-label="Slides">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${s.title}`}
            className="show-dot"
            data-active={i === index ? '' : undefined}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
