'use client';

import { useEffect, useSyncExternalStore } from 'react';

const KEY = 'atlas-console';

// Subscribe to the <html data-theme> attribute (set by the no-FOUC script in the
// root layout and by toggle() below). useSyncExternalStore is the SSR-safe way to
// read this external state: the server snapshot is always "light", and React
// reconciles to the real value after hydration without a mismatch warning.
function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
const getSnapshot = () => document.documentElement.getAttribute('data-theme') === 'dark';
const getServerSnapshot = () => false;

// Light/dark toggle (the only client-side personalization), persisted under the
// design system's localStorage key. The effect also wires the nav's scroll
// shadow (.nav.scrolled), matching the Console motion engine.
export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const nav = document.querySelector('.nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function toggle() {
    const root = document.documentElement;
    const next = !dark;
    if (next) root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      saved.theme = next ? 'dark' : 'light';
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      // private mode / disabled storage — the theme still applies for the session
    }
  }

  return (
    <button className="toggle" data-action="theme" onClick={toggle} aria-label="Toggle light or dark theme">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
        <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />
      </svg>
      <span className="theme-label">{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
