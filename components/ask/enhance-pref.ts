'use client';

// The phone composer's "Enhance before sending" switch (admin). On a phone the
// one round send button does what the desktop's three buttons do: with the
// switch on it runs Enhance & send, off it sends as typed. A per-viewer
// convenience, so it lives in localStorage (with an in-memory fallback when
// storage is blocked); read through useSyncExternalStore so the server render
// and hydration agree on the default (on, matching the desktop's primary
// button).
const KEY = 'atlas-ask-enhance';
const listeners = new Set<() => void>();
let memo: boolean | null = null;

export function getEnhancePref(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v !== null) return v !== '0';
  } catch {
    // storage blocked: fall through to the in-memory copy
  }
  return memo ?? true;
}

export const getEnhancePrefServer = (): boolean => true;

export function setEnhancePref(on: boolean): void {
  memo = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* memo carries it */ }
  for (const l of listeners) l();
}

export function subscribeEnhancePref(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
