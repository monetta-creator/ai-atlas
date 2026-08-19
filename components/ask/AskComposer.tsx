'use client';

import { useState } from 'react';

// The pinned composer. Autosize is computed in the change handler from the
// event target (never a ref read in render); Enter sends, Shift+Enter breaks
// the line, and the house Cmd/Ctrl+Enter still works. The Deep research
// toggle appears only when the mode supports it (admin today); the Web search
// toggle for admin and portal keyholders (each search is budget-metered).
export default function AskComposer({
  streaming, onSend, onStop, deepAvailable, deep, onToggleDeep,
  webAvailable, web, onToggleWeb,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  deepAvailable: boolean;
  deep: boolean;
  onToggleDeep: () => void;
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
        {deepAvailable && (
          <button
            type="button"
            className="ask-deep-toggle"
            aria-pressed={deep}
            onClick={onToggleDeep}
            disabled={streaming}
            title="Research the Atlas in rounds before answering"
          >
            Deep research
          </button>
        )}
        {webAvailable && (
          <button
            type="button"
            className="ask-deep-toggle"
            aria-pressed={web}
            onClick={onToggleWeb}
            disabled={streaming}
            title="Fill gaps the Atlas leaves with a web search; the records stay primary"
          >
            Web search
          </button>
        )}
        <p className="ask-composer-hint">
          {deepAvailable && deep
            ? 'deep research: searches the Atlas in rounds before answering, may take a minute or two'
            : webAvailable && web
              ? 'web search on: the Atlas stays primary, the web fills gaps, sources listed under the answer'
              : 'grounded in the Atlas database · enter to send, shift+enter for a new line'}
        </p>
      </div>
    </div>
  );
}
