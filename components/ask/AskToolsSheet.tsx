'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// The phone composer's "+" sheet (2026-11-17): the modes and options the
// desktop shows as a row of chips under the box, as one bottom sheet of
// switches. Rows appear only where the desktop shows the same control.
// Portaled to <body>: the phone composer is a sticky stacking context, and a
// sheet inside it would paint under the site's top bar.
export interface ToolRow {
  key: string;
  label: string;
  note: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export default function AskToolsSheet({
  rows, action, hint, skillsTip, onClose,
}: {
  rows: ToolRow[];
  // A one-shot action under the switches (Enhance without sending).
  action?: { label: string; note: string; disabled: boolean; onRun: () => void } | null;
  hint: string;
  skillsTip: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="ask-sheet-backdrop" onClick={onClose} />
      <div className="ask-sheet" role="dialog" aria-modal="true" aria-label="Ask options">
        <div className="ask-sheet-grab" aria-hidden="true" />
        <div className="ask-sheet-head">
          <p className="ask-sheet-title">Options</p>
          <button type="button" className="ask-sheet-done" onClick={onClose}>Done</button>
        </div>
        <div className="ask-sheet-rows">
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              role="switch"
              aria-checked={r.on}
              className="ask-sheet-row"
              disabled={r.disabled}
              onClick={r.onToggle}
            >
              <span className="ask-sheet-text">
                <span className="ask-sheet-label">{r.label}</span>
                <span className="ask-sheet-note">{r.note}</span>
              </span>
              <span className="ask-switch" aria-hidden="true"><span /></span>
            </button>
          ))}
          {action && (
            <button
              type="button"
              className="ask-sheet-row ask-sheet-row--action"
              disabled={action.disabled}
              onClick={() => { action.onRun(); onClose(); }}
            >
              <span className="ask-sheet-text">
                <span className="ask-sheet-label">{action.label}</span>
                <span className="ask-sheet-note">{action.note}</span>
              </span>
            </button>
          )}
        </div>
        {skillsTip && <p className="ask-sheet-tip">Type / for a skill or @ for an agent.</p>}
        <p className="ask-sheet-hint">{hint}</p>
      </div>
    </>,
    document.body,
  );
}
