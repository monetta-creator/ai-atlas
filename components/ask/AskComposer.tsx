'use client';

import { useState } from 'react';

// The pinned composer. Autosize is computed in the change handler from the
// event target (never a ref read in render); Enter sends, Shift+Enter breaks
// the line, and the house Cmd/Ctrl+Enter still works. Since the 2026-08-21
// rework the admin chat ALWAYS researches (the old Deep research toggle is
// gone); the one remaining toggle is Web search, for admin and portal
// keyholders (each search is budget-metered).
export default function AskComposer({
  streaming, onSend, onStop, researchMode,
  webAvailable, web, onToggleWeb,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  // true on the admin surface: every question runs the research loop.
  researchMode: boolean;
  webAvailable: boolean;
  web: boolean;
  onToggleWeb: () => void;
}) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText('');
    onSend(t);
  }

  const hint = researchMode
    ? web
      ? 'researches the Atlas, then the web, before answering · sources listed under the answer'
      : 'researches the Atlas in rounds before answering, may take a minute'
    : web
      ? 'web search on: the Atlas stays primary, the web fills gaps, sources listed under the answer'
      : 'grounded in the Atlas database · enter to send, shift+enter for a new line';

  return (
    <div className="ask-composer">
      <div className="ask-composer-inner">
        {!text && <span className="lobby-ask-caret" aria-hidden="true" />}
        <textarea
          className="input"
          rows={1}
          placeholder="Ask the Atlas anything it tracks"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(200, el.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        {streaming ? (
          <button type="button" className="btn btn--ghost" onClick={onStop}>Stop</button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!text.trim()}>
            Send
          </button>
        )}
      </div>
      <div className="ask-composer-foot">
        {webAvailable && (
          <button
            type="button"
            className="ask-deep-toggle"
            aria-pressed={web}
            onClick={onToggleWeb}
            disabled={streaming}
            title="Add live web search on top of the Atlas records"
          >
            Web search
          </button>
        )}
        <p className="ask-composer-hint">{hint}</p>
      </div>
    </div>
  );
}
