'use client';

import { useState } from 'react';
import { estimateTurnUsd, formatTurnCost, selectorModels } from '@/lib/llm/models';

const MODEL_OPTIONS = selectorModels();

// The pinned composer. Autosize is computed in the change handler from the
// event target (never a ref read in render); Enter sends, Shift+Enter breaks
// the line, and the house Cmd/Ctrl+Enter still works. Since the 2026-08-21
// rework the admin chat ALWAYS researches (the old Deep research toggle is
// gone); the second toggle is Web search, for admin and portal keyholders
// (each search is budget-metered). Field Report (2026-09-28) is a third mode,
// same admin/portal-only availability: on, it replaces the normal send with a
// plan-then-run flow and hides Web search (a report always uses the web to
// fill gaps, so the standalone toggle would be redundant).
export default function AskComposer({
  streaming, onSend, onStop, researchMode,
  webAvailable, web, onToggleWeb,
  fieldReportAvailable, fieldReport, onToggleFieldReport,
  showModel, model, onModel, v2On, onToggleV2,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  // true on the admin surface: every question runs the research loop.
  researchMode: boolean;
  webAvailable: boolean;
  web: boolean;
  onToggleWeb: () => void;
  fieldReportAvailable: boolean;
  fieldReport: boolean;
  onToggleFieldReport: () => void;
  // Admin only: the model selector and the v2 chat toggle.
  showModel: boolean;
  model: string;
  onModel: (id: string) => void;
  v2On: boolean;
  onToggleV2: () => void;
}) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText('');
    onSend(t);
  }

  const freshNote = ' Recent-events questions still search the web automatically.';
  const hint = fieldReport
    ? 'drafts a research plan first, you edit it and pick Brief or Full, then it runs in the background · enter to send'
    : researchMode
      ? web
        ? 'researches the Atlas, then the web, before answering · sources listed under the answer'
        : `researches the Atlas in rounds before answering, may take a minute.${freshNote}`
      : web
        ? 'web search on: the Atlas stays primary, the web fills gaps, sources listed under the answer'
        : `grounded in the Atlas database · enter to send, shift+enter for a new line.${freshNote}`;

  return (
    <div className="ask-composer">
      <div className="ask-composer-inner">
        {!text && <span className="lobby-ask-caret" aria-hidden="true" />}
        <textarea
          className="input"
          rows={1}
          placeholder={fieldReport ? 'Ask for a Field Report: the Atlas drafts a research plan first' : 'Ask the Atlas anything it tracks'}
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
        {fieldReportAvailable && (
          <button
            type="button"
            className="ask-deep-toggle"
            aria-pressed={fieldReport}
            onClick={onToggleFieldReport}
            disabled={streaming}
            title="Draft an editable research plan, then run a longer report with citations, a PDF, and a place in the Report Portal"
          >
            Field Report
          </button>
        )}
        {showModel && !fieldReport && (
          <>
            <select
              className="ask-model-select"
              value={model}
              onChange={(e) => onModel(e.target.value)}
              disabled={streaming}
              aria-label="Answer model"
              title="Auto lets the Atlas pick a model for each question; a manual pick uses the v2 chat"
            >
              <option value="auto">Auto</option>
              {(['claude', 'open-weight'] as const).map((fam) => (
                <optgroup key={fam} label={fam === 'claude' ? 'Claude' : 'Open-weight'}>
                  {MODEL_OPTIONS.filter((m) => m.family === fam).map((m) => (
                    <option key={m.id} value={m.id}>{m.label} · {formatTurnCost(estimateTurnUsd(m))}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              className="ask-deep-toggle"
              aria-pressed={v2On || model !== 'auto'}
              onClick={onToggleV2}
              disabled={streaming || model !== 'auto'}
              title="Use the v2 chat path (tool-calling loop with model choice). Always on when a model is picked"
            >
              v2
            </button>
          </>
        )}
        {webAvailable && !fieldReport && (
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
