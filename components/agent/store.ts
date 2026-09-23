'use client';

import { useSyncExternalStore } from 'react';
import type { AgentChatMessage } from '@/lib/agent/types';
import type { AskCostReport } from '@/lib/ask/history';

// The Atlas Agent chat's browser-only history: one standing conversation with
// the operator (no multi-thread rail, unlike Ask). Cloned from
// components/ask/store.ts: a module-level cache whose reference is stable
// between mutations (useSyncExternalStore's referential contract), a frozen
// empty server sentinel so SSR/hydration renders no mismatch, and a `storage`
// listener so two tabs never clobber each other blindly.
//
// Streaming tokens never land here: the in-flight answer lives in component
// state and the store is written once at completion, abort, or error. All
// mutators run from handlers or async completion code, never effect bodies
// (React Compiler rules).

export interface AgentStoredMessage extends AgentChatMessage {
  cost?: AskCostReport;   // assistant only: what this turn cost
}

interface AgentStoreV1 {
  v: 1;
  messages: AgentStoredMessage[];
}

const KEY = 'atlas_agent_v1';
const MAX_MESSAGES = 200;

const EMPTY: AgentStoredMessage[] = Object.freeze([]) as unknown as AgentStoredMessage[];

let cache: AgentStoreV1 | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function read(): AgentStoreV1 {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AgentStoreV1;
      if (parsed && parsed.v === 1 && Array.isArray(parsed.messages)) {
        cache = parsed;
        return cache;
      }
    }
  } catch {
    // corrupt storage: start fresh
  }
  cache = { v: 1, messages: [] };
  return cache;
}

function persist(next: AgentStoreV1): void {
  const trimmed = next.messages.slice(-MAX_MESSAGES);
  cache = { v: 1, messages: trimmed };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    try {
      cache = { v: 1, messages: trimmed.slice(Math.max(0, trimmed.length - 20)) };
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // give up quietly; state survives in memory for this session
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

export function useAgentThread(): AgentStoredMessage[] {
  return useSyncExternalStore(subscribe, () => read().messages, () => EMPTY);
}

export function appendAgentMessage(msg: AgentStoredMessage): void {
  const s = read();
  persist({ v: 1, messages: [...s.messages, msg] });
}

export function clearAgentThread(): void {
  persist({ v: 1, messages: [] });
}
