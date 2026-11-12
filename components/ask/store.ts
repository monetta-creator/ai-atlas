'use client';

import { useSyncExternalStore } from 'react';
import type { SignalMap } from '@/lib/ask/verify';
import type { VerifyReport } from '@/lib/ask/deep';
import type { AskCostReport, AskWebSource } from '@/lib/ask/history';
import type { DeclinePayload, Lane } from '@/lib/ask/lanes';
import type { V2Decision } from '@/lib/ask/v2-events';
import type { AtlasView } from '@/lib/tools/types';
import type { FieldReportCard, FieldReportPlan, FieldReportPlanResponse, FieldReportSize } from '@/lib/field-report/core';

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

// A Field Report message's lifecycle (2026-09-28): 'plan' (the editable plan
// just came back), 'run' (Run was clicked, a background ui_jobs run is under
// way), 'done' (the saved report), 'error' (the plan or run step failed
// outright, e.g. a keyholder's daily cap). Persisted on the message like every
// other field, so a reload resumes whichever card the stage calls for.
export interface FieldReportState {
  stage: 'plan' | 'run' | 'done' | 'error';
  runId: string;
  plan?: FieldReportPlan;
  estimates?: FieldReportPlanResponse['estimates'];
  capRoomUsd?: number | null;
  size?: FieldReportSize;
  jobId?: string;
  report?: FieldReportCard;
  error?: string;
}

// The v2 cost report adds two fields the shared parser drops; both optional so
// older stored messages and the deep route's reports still type-check.
export type AskCostStored = AskCostReport & { cache_write_tokens?: number; tool_calls?: number };

// The Enhance card (redo P4.6): what the prework found for one ask. Stored on
// the user turn it produced, so it survives reload and renders above the answer.
export interface EnhanceCardData {
  original: string;
  question: string;
  plan: string[];
  clarify: string[];
  records: string[];
  decision: { model: string; label: string; tier: string; web: boolean; depth: string; reason: string; estUsd: number; budgetMessage: string | null };
  enhanceUsd?: number;
}

export interface AskChip { label: string; prompt: string; kind: string }

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
  enhanced?: EnhanceCardData; // user only: the Enhance card behind this turn
  skill?: { slug: string; title: string; kind: 'skill' | 'agent' | 'unknown' }; // assistant only: a /skill or @agent turn
  views?: AtlasView[];     // assistant only: generative views the show_view tool resolved (rows bound server-side)
  chips?: AskChip[];       // assistant only: next-step suggestions (P4.7)
  signalMap?: SignalMap;   // assistant only: FROZEN merged tag -> uuid map at completion time
  datasets?: string[];     // assistant only: verified [dataset <slug>] suggestions
  steps?: string[];        // assistant only: the deep-research trail (status lines)
  verify?: VerifyReport;   // assistant only: faithfulness check (deep always-on, quick on-demand)
  webSources?: AskWebSource[]; // assistant only: cited web sources (the web toggle)
  cost?: AskCostStored;    // assistant only: what this turn cost (tokens, searches, USD)
  decision?: V2Decision;   // assistant only: the v2 model decision (recommendation chip)
  lane?: Lane;             // assistant only: the classified lane (2026-09-23)
  decline?: DeclinePayload; // assistant only: a coded decline, no model call ran
  fieldReport?: FieldReportState; // assistant only: a Field Report in progress or done (2026-09-28)
  stopped?: boolean;       // aborted mid-stream; partial kept
  error?: boolean;         // failed turn; enables Retry
}

export interface AskConvo {
  id: string;
  title: string;           // first user turn, truncated
  createdAt: number;
  updatedAt: number;
  messages: AskMessage[];
  model?: string;          // the selector pick, sticky per conversation; absent = 'auto'
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

function persist(next: AskStoreV1, changedId?: string): void {
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
  if (changedId) scheduleMirror(changedId);
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

export function createConvo(firstUserTurn: string, enhanced?: EnhanceCardData): string {
  const s = read();
  const now = Date.now();
  const convo: AskConvo = {
    id: crypto.randomUUID(),
    title: firstUserTurn.slice(0, TITLE_CAP),
    createdAt: now,
    updatedAt: now,
    messages: [{ role: 'user', content: firstUserTurn, ...(enhanced ? { enhanced } : {}) }],
  };
  persist({ v: 1, convos: [convo, ...s.convos] }, convo.id);
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
  }, convoId);
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
  }, convoId);
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
  }, convoId);
}

// Merges a patch into one message's Field Report state (the plan card editing
// a field, Run/Resume/Retry advancing the stage, the run card landing the
// finished report, Publish flipping isPublished). A message with no prior
// fieldReport takes the patch as the whole state (the initial append already
// supplies a full FieldReportState, so this path is defensive only).
export function setMessageFieldReport(convoId: string, index: number, patch: Partial<FieldReportState>): void {
  const s = read();
  persist({
    v: 1,
    convos: s.convos.map((c) => {
      if (c.id !== convoId) return c;
      if (index < 0 || index >= c.messages.length) return c;
      return {
        ...c,
        messages: c.messages.map((m, i) =>
          i === index ? { ...m, fieldReport: m.fieldReport ? { ...m.fieldReport, ...patch } : (patch as FieldReportState) } : m
        ),
        updatedAt: Date.now(),
      };
    }),
  }, convoId);
}

// Remember the selector pick on the conversation (absent = 'auto').
export function setConvoModel(convoId: string, model: string): void {
  const s = read();
  persist({
    v: 1,
    convos: s.convos.map((c) => (c.id === convoId ? { ...c, model } : c)),
  }, convoId);
}

export function deleteConvo(convoId: string): void {
  const s = read();
  persist({ v: 1, convos: s.convos.filter((c) => c.id !== convoId) });
  if (serverSync) void fetch(`/api/conversations/${convoId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

// ---------------------------------------------------------------- server mirror
// Redo P4.1: localStorage stays the working copy (instant, offline-safe);
// when sync is on (admin and access-key sessions) every change PUTs a
// debounced snapshot of that conversation to /api/conversations/<id>, and
// importServerConvos() brings in threads that exist only on the server
// (started on another device). Failures are silent: the local copy stands.
let serverSync = false;
const pendingMirror = new Map<string, ReturnType<typeof setTimeout>>();

export function enableServerSync(on: boolean): void {
  serverSync = on;
}

type WireMessage = { role: 'user' | 'assistant'; content: string; extras: Record<string, unknown>; tagMap: SignalMap; costUsd: number | null };

export function toWire(c: AskConvo): { title: string; model: string | null; messages: WireMessage[] } {
  return {
    title: c.title,
    model: c.model ?? null,
    messages: c.messages.map(({ role, content, signalMap, ...rest }) => ({
      role,
      content,
      extras: rest as Record<string, unknown>,
      tagMap: signalMap ?? {},
      costUsd: typeof rest.cost?.cost_usd === 'number' ? rest.cost.cost_usd : null,
    })),
  };
}

export function fromWire(row: { id: string; title: string; model: string | null; created_at: string; updated_at: string; messages?: { role: 'user' | 'assistant'; content: string; extras: Record<string, unknown>; tag_map: SignalMap }[] }): AskConvo {
  return {
    id: row.id,
    title: row.title,
    createdAt: Date.parse(row.created_at) || Date.now(),
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    ...(row.model ? { model: row.model } : {}),
    messages: (row.messages ?? []).map((m) => ({
      ...(m.extras as Partial<AskMessage>),
      role: m.role,
      content: m.content,
      ...(m.tag_map && Object.keys(m.tag_map).length ? { signalMap: m.tag_map } : {}),
    })),
  };
}

function scheduleMirror(id: string): void {
  if (!serverSync || typeof window === 'undefined') return;
  const prev = pendingMirror.get(id);
  if (prev) clearTimeout(prev);
  pendingMirror.set(id, setTimeout(() => {
    pendingMirror.delete(id);
    const c = getConvo(id);
    if (!c) return;
    void fetch(`/api/conversations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toWire(c)),
      keepalive: true,
    }).catch(() => {});
  }, 1200));
}

// Pull conversations that exist on the server but not in this browser.
export async function importServerConvos(limit = 20): Promise<number> {
  if (!serverSync) return 0;
  try {
    const res = await fetch('/api/conversations');
    if (!res.ok) return 0;
    const { conversations } = (await res.json()) as { conversations: { id: string }[] };
    const local = new Set(read().convos.map((c) => c.id));
    // Local-only threads (from before sync, or offline) go up once.
    const remote = new Set(conversations.map((c) => c.id));
    for (const id of local) if (!remote.has(id)) scheduleMirror(id);
    const missing = conversations.filter((c) => !local.has(c.id)).slice(0, limit);
    if (!missing.length) return 0;
    const rows = await Promise.all(missing.map(async (c) => {
      const r = await fetch(`/api/conversations/${c.id}`);
      return r.ok ? fromWire(await r.json()) : null;
    }));
    const add = rows.filter((c): c is AskConvo => Boolean(c && c.messages.length));
    if (add.length) persist({ v: 1, convos: [...read().convos, ...add] });
    return add.length;
  } catch {
    return 0;
  }
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
