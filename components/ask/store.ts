'use client';

import { useSyncExternalStore } from 'react';
import type { SignalMap } from '@/lib/ask/verify';
import type { VerifyReport } from '@/lib/ask/deep';
import type { AskCostReport } from '@/lib/ask/history';

// The Ask workspace's conversation store: browser-only localStorage, no
// accounts, no server persistence. Pattern copied from SiteNav's visited-store:
// a module-level cache whose reference is stable between mutations (satisfying
// useSyncExternalStore's referential contract), a frozen empty server sentinel
// so SSR/hydration renders an empty rail with no mismatch, and a `storage`
// listener so two tabs never clobber each other blindly.
//
// Streaming tokens never land here: the in-flight assistant text lives in
// component state and the store is written once at completion, abort, or error.
// All mutators are called from event handlers or async completion code, never
// effect bodies (React Compiler rules).

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
  signalMap?: SignalMap;   // assistant only: FROZEN merged tag -> uuid map at completion time
  datasets?: string[];     // assistant only: verified [dataset <slug>] suggestions
  steps?: string[];        // assistant only: the deep-research trail (status lines)
  verify?: VerifyReport;   // assistant only: faithfulness check (deep always-on, quick on-demand)
  cost?: AskCostReport;    // assistant only: what this turn cost (tokens, searches, USD)
  stopped?: boolean;       // aborted mid-stream; partial kept
  error?: boolean;         // failed turn; enables Retry
}

export interface AskConvo {
  id: string;
  title: string;           // first user turn, truncated
  createdAt: number;
  updatedAt: number;
  messages: AskMessage[];
}

interface AskStoreV1 {
  v: 1;
  convos: AskConvo[];      // newest updatedAt first
}

const KEY = 'atlas_ask_v1';
export const MAX_CONVOS = 50;
export const TITLE_CAP = 60;

const EMPTY: AskStoreV1 = Object.freeze({ v: 1, convos: Object.freeze([]) as unknown as AskConvo[] });

let cache: AskStoreV1 | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function read(): AskStoreV1 {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AskStoreV1;
      // Version gate: anything unrecognized is discarded, not migrated (the
      // versioned envelope exists so a future v2 CAN migrate).
      if (parsed && parsed.v === 1 && Array.isArray(parsed.convos)) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    // corrupt storage: start fresh
  }
  cache = { v: 1, convos: [] };
  return cache;
}

function persist(next: AskStoreV1): void {
  const sorted = [...next.convos].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVOS);
  cache = { v: 1, convos: sorted };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // QuotaExceeded: drop the oldest conversation and retry once; if that
    // fails too, state survives in memory for this session.
    try {
      cache = { v: 1, convos: sorted.slice(0, Math.max(1, sorted.length - 1)) };
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // give up quietly
    }
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { cache = null; emit(); }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAskConvos(): AskConvo[] {
  return useSyncExternalStore(subscribe, () => read().convos, () => EMPTY.convos);
}

// ---------------------------------------------------------------- mutators

export function createConvo(firstUserTurn: string): string {
  const s = read();
  const now = Date.now();
  const convo: AskConvo = {
    id: crypto.randomUUID(),
    title: firstUserTurn.slice(0, TITLE_CAP),
    createdAt: now,
    updatedAt: now,
    messages: [{ role: 'user', content: firstUserTurn }],
  };
  persist({ v: 1, convos: [convo, ...s.convos] });
  return convo.id;
}

export function getConvo(id: string): AskConvo | null {
  return read().convos.find((c) => c.id === id) ?? null;
}

export function appendMessage(convoId: string, msg: AskMessage): void {
  const s = read();
  persist({
    v: 1,
    convos: s.convos.map((c) =>
      c.id === convoId
        ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
        : c
    ),
  });
}

// Drop the trailing assistant turn (Regenerate / Retry re-sends the same user turn).
export function dropLastAssistant(convoId: string): void {
  const s = read();
  persist({
    v: 1,
    convos: s.convos.map((c) => {
      if (c.id !== convoId) return c;
      const last = c.messages[c.messages.length - 1];
      if (!last || last.role !== 'assistant') return c;
      return { ...c, messages: c.messages.slice(0, -1), updatedAt: Date.now() };
    }),
  });
}

// Attach an on-demand verification report to one message ("Check this answer").
export function setMessageVerify(convoId: string, index: number, verify: VerifyReport): void {
  const s = read();
  persist({
    v: 1,
    convos: s.convos.map((c) => {
      if (c.id !== convoId) return c;
      if (index < 0 || index >= c.messages.length) return c;
      return {
        ...c,
        messages: c.messages.map((m, i) => (i === index ? { ...m, verify } : m)),
        updatedAt: Date.now(),
      };
    }),
  });
}

export function deleteConvo(convoId: string): void {
  const s = read();
  persist({ v: 1, convos: s.convos.filter((c) => c.id !== convoId) });
}

// The next request's signalOffset: the highest numeric suffix across every
// stored tag in this conversation, so freshly minted tags never collide with
// ones already cited in earlier turns.
export function maxSignalSuffix(convo: AskConvo | null): number {
  if (!convo) return 0;
  let max = 0;
  for (const m of convo.messages) {
    if (!m.signalMap) continue;
    for (const tag of Object.keys(m.signalMap)) {
      const n = Number(tag.slice(1));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

// The merged tag -> uuid map across all prior assistant turns (frozen into
// each new message at completion so old messages never re-render differently).
export function mergedSignalMap(convo: AskConvo | null): SignalMap {
  const out: SignalMap = {};
  if (!convo) return out;
  for (const m of convo.messages) {
    if (m.signalMap) Object.assign(out, m.signalMap);
  }
  return out;
}
