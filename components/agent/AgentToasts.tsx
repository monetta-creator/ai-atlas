'use client';

import { useEffect, useState } from 'react';
import type { AgentPulse, Severity } from '@/lib/agent/types';

const TOASTED_KEY = 'atlas_agent_toasted_v1';
const MAX_TOASTS = 3;
const DISMISS_MS = 8000;

interface Toast { key: string; title: string; severity: Severity }

function readToasted(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TOASTED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

function writeToasted(set: Set<string>): void {
  try {
    // A write-only log, capped so it never grows unbounded across sessions.
    localStorage.setItem(TOASTED_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    // private mode etc: a finding may toast again next session, harmless.
  }
}

// Up to three high-severity findings the viewer has not been shown a toast
// for yet, stacked bottom-right, each auto-dismissing after 8s. Riding the
// same pulse the orb already polls, no separate infra. Rendered only from
// AgentOrb's rail variant.
export default function AgentToasts({ pulse, onOpen }: { pulse: AgentPulse; onOpen: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const toasted = readToasted();
    const fresh = pulse.newSince.filter((f) => f.severity === 'high' && !toasted.has(f.key));
    if (!fresh.length) return;
    const picked = fresh.slice(0, MAX_TOASTS);
    for (const f of picked) toasted.add(f.key);
    writeToasted(toasted);
    // Deferred a tick (the SiteNav dropdown-close idiom): a direct setState
    // call in an effect body is a React Compiler lint error even when
    // conditioned like this one is.
    const id = window.setTimeout(() => {
      setToasts((prev) => [...prev, ...picked].slice(-MAX_TOASTS));
    }, 0);
    return () => window.clearTimeout(id);
  }, [pulse]);

  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [toasts]);

  if (!toasts.length) return null;

  return (
    <div className="ag-toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className="ag-toast">
          <span className="ag-toast-title">{t.title}</span>
          <div className="ag-toast-actions">
            <button type="button" className="btn btn--quiet btn--sm" onClick={onOpen}>Open</button>
            <button
              type="button"
              className="ag-toast-x"
              aria-label="Dismiss"
              onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
