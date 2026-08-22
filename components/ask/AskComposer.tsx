'use client';

import { useState } from 'react';

// The pinned composer. Autosize is computed in the change handler from the
// event target (never a ref read in render); Enter sends, Shift+Enter breaks
// the line, and the house Cmd/Ctrl+Enter still works. The admin chat ALWAYS
// researches; answers are grounded in Atlas records only (no web layer).
export default function AskComposer({
  streaming, onSend, onStop, researchMode,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  // true on the admin surface: every question runs the research loop.
  researchMode: boolean;
}) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText('');
    onSend(t);
  }

  const hint = researchMode
    ? 'researches the Atlas in rounds before answering, may take a minute'
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
        <p className="ask-composer-hint">{hint}</p>
      </div>
    </div>
  );
}
