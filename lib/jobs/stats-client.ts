'use client';

import { useSyncExternalStore } from 'react';
import type { FeatureStats } from './core';

// The usual time and cost per feature, fetched once per browser session from
// /api/jobs/stats (5-minute private cache) and shared by every run panel and
// model-call button through useSyncExternalStore. A page that already has the
// numbers passes them as `stats` and this never fetches; a guest (401) gets
// null and the panels show elapsed time only.

let stats: FeatureStats | null = null;
let started = false;
const listeners = new Set<() => void>();

function load() {
  if (started) return;
  started = true;
  fetch('/api/jobs/stats', { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((s: FeatureStats | null) => {
      if (!s) return;
      stats = s;
      for (const l of listeners) l();
    })
    .catch(() => { started = false; });
}

function subscribe(l: () => void) {
  listeners.add(l);
  load();
  return () => { listeners.delete(l); };
}

const noop = () => () => {};
const get = () => stats;
const getServer = () => null;

export function useFeatureStats(enabled: boolean): FeatureStats | null {
  return useSyncExternalStore(enabled ? subscribe : noop, get, getServer);
}
