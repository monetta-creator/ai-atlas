'use client';

import { useSyncExternalStore } from 'react';
import type { UiJob } from './core';

// One poll of GET /api/jobs/active shared by the rail's run indicator and the
// completion toasts (a module-level store read through useSyncExternalStore,
// the nav-counts-store idiom): every 5s while something runs, every 30s when
// idle, paused while the tab is hidden, and stopped for good on a 401 (a
// guest, or a key that lapsed). A run started on this page announces itself
// (announceJobsChanged) so the indicator appears at once, not 30s later.

export interface JobsSnapshot { active: UiJob[]; finished: UiJob[]; ready: boolean }

const EMPTY: JobsSnapshot = { active: [], finished: [], ready: false };
let snap: JobsSnapshot = EMPTY;
const listeners = new Set<() => void>();
let timer: number | null = null;
let inflight = false;
let refused = false;

const EVENT = 'atlas:jobs';

function emit() { for (const l of listeners) l(); }

function schedule(delay?: number) {
  if (timer) window.clearTimeout(timer);
  timer = null;
  if (!listeners.size || refused) return;
  timer = window.setTimeout(poll, delay ?? (snap.active.length ? 5000 : 30000));
}

async function poll() {
  if (inflight || refused) return;
  if (document.visibilityState !== 'visible') { schedule(); return; }
  inflight = true;
  try {
    const r = await fetch('/api/jobs/active', { cache: 'no-store' });
    if (r.status === 401 || r.redirected) {
      refused = true;
      snap = EMPTY;
      emit();
      return;
    }
    if (r.ok) {
      const d = (await r.json()) as { active: UiJob[]; finishedSince: UiJob[] };
      snap = { active: d.active ?? [], finished: d.finishedSince ?? [], ready: true };
      emit();
    }
  } catch {
    // keep the last snapshot; the next tick retries
  } finally {
    inflight = false;
    schedule();
  }
}

function kick() {
  refused = false;
  schedule(400);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(EVENT, kick);
    document.addEventListener('visibilitychange', kick);
    schedule(0);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener(EVENT, kick);
      document.removeEventListener('visibilitychange', kick);
      if (timer) window.clearTimeout(timer);
      timer = null;
    }
  };
}

const noopSubscribe = () => () => {};
const getSnapshot = () => snap;
const getServerSnapshot = () => EMPTY;

export function useJobs(enabled: boolean): JobsSnapshot {
  return useSyncExternalStore(enabled ? subscribe : noopSubscribe, enabled ? getSnapshot : getServerSnapshot, getServerSnapshot);
}

// Called by the run hook when a job starts or ends on this page.
export function announceJobsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}
