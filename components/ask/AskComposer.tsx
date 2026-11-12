'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { suggest } from '@/lib/capabilities/registry';
import { trigger, type Audience } from '@/lib/capabilities/types';
import { estimateTurnUsd, formatTurnCost, selectorModels } from '@/lib/llm/models';

const MODEL_OPTIONS = selectorModels();

// Dictation: the browser's speech recognition, where it exists. Minimal typings
// (lib.dom does not ship them); detection runs through useSyncExternalStore so
// the server render and hydration both say "unsupported".
interface SpeechResultLike { 0: { transcript: string }; isFinal: boolean; length: number }
interface SpeechEventLike { resultIndex: number; results: ArrayLike<SpeechResultLike> }
interface SpeechRec {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: SpeechEventLike) => void) | null; onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
}
type SpeechCtor = new () => SpeechRec;
const speechCtor = (): SpeechCtor | null => {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const noopSubscribe = () => () => {};
const speechSupported = () => speechCtor() !== null;

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
  audience, enhanceAvailable, enhancing, onEnhance, seed, above,
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
  // Smart bar: who the autocomplete lists for (null = none), Enhance (admin), a text to load, a node shown above the box.
  audience: Audience | null;
  enhanceAvailable: boolean;
  enhancing: boolean;
  onEnhance: (text: string, andSend: boolean) => void;
  seed: { id: number; text: string } | null;
  above?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [rec, setRec] = useState<SpeechRec | null>(null);
  const canDictate = useSyncExternalStore(noopSubscribe, speechSupported, () => false);

  // A parent-supplied text (Enhance, Edit and rerun) replaces the box once per
  // seed: the derived-state pattern, setState during render keyed on the prop.
  const [seenSeed, setSeenSeed] = useState<number | null>(null);
  if (seed && seed.id !== seenSeed) {
    setSeenSeed(seed.id);
    setText(seed.text);
  }

  // Stop dictation if the composer unmounts mid-listen.
  useEffect(() => () => { rec?.stop(); }, [rec]);

  const listening = rec !== null;
  function toggleDictation() {
    if (rec) { rec.stop(); setRec(null); return; }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-US';
    const base = text && !/\s$/.test(text) ? `${text} ` : text;
    r.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(base + t.trimStart());
    };
    r.onend = () => setRec(null);
    r.onerror = () => setRec(null);
    try { r.start(); setRec(r); } catch { setRec(null); }
  }

  // Autocomplete: only while the box holds a lone "/word" or "@word".
  const items = audience && /^[/@][a-z0-9-]*$/i.test(text) && dismissed !== text ? suggest(text, audience) : [];
  const popOpen = items.length > 0;
  const activeIdx = Math.min(active, Math.max(0, items.length - 1));
  function insert(i: number) {
    const c = items[i];
    if (!c) return;
    setText(`${trigger(c)} `);
    setActive(0);
    document.getElementById('ask-composer-input')?.focus();
  }

  function submit() {
    const t = text.trim();
    if (!t || streaming) return;
    setText('');
    onSend(t);
  }

  function enhance(andSend: boolean) {
    const t = text.trim();
    if (!t || streaming || enhancing) return;
    if (rec) { rec.stop(); setRec(null); }
    if (andSend) setText('');
    onEnhance(t, andSend);
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
      {above}
      <div className="ask-composer-inner">
        {popOpen && (
          <ul className="ask-ac" role="listbox" id="ask-ac-list" aria-label="Skills and agents">
            {items.map((c, i) => (
              <li
                key={`${c.kind}-${c.slug}`}
                id={`ask-ac-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className="ask-ac-row"
                onMouseDown={(e) => { e.preventDefault(); insert(i); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="ask-ac-trig">{trigger(c)}</span>
                <span className="ask-ac-title">{c.title}</span>
                <span className="ask-ac-one">{c.oneLiner}</span>
                <span className="ask-ac-use">{c.usage}</span>
              </li>
            ))}
          </ul>
        )}
        {!text && <span className="lobby-ask-caret" aria-hidden="true" />}
        <textarea
          id="ask-composer-input"
          className="input"
          rows={1}
          role="combobox"
          aria-expanded={popOpen}
          aria-controls={popOpen ? 'ask-ac-list' : undefined}
          aria-activedescendant={popOpen ? `ask-ac-${activeIdx}` : undefined}
          aria-autocomplete="list"
          placeholder={fieldReport ? 'Ask for a Field Report: the Atlas drafts a research plan first' : 'Ask the Atlas anything it tracks'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = `${Math.min(200, el.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (popOpen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((activeIdx + 1) % items.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((activeIdx - 1 + items.length) % items.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(activeIdx); return; }
              if (e.key === 'Escape') { e.preventDefault(); setDismissed(text); return; }
            }
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
        <div className="ask-composer-actions">
          {canDictate && !streaming && (
            <button
              type="button"
              className="ask-mic"
              aria-pressed={listening}
              aria-label={listening ? 'Stop dictation' : 'Dictate'}
              title={listening ? 'Stop dictation' : 'Dictate your question'}
              onClick={toggleDictation}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
          )}
          {streaming ? (
            <button type="button" className="btn btn--ghost" onClick={onStop}>Stop</button>
          ) : enhanceAvailable && !fieldReport ? (
            <>
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => enhance(false)} disabled={!text.trim() || enhancing} title="Tidy the question and show the plan, without sending">
                Enhance
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={submit} disabled={!text.trim() || enhancing}>
                Send
              </button>
              <button type="button" className="btn btn--primary" onClick={() => enhance(true)} disabled={!text.trim() || enhancing} title="Tidy the question, then send the cleaned version">
                {enhancing ? 'Enhancing...' : 'Enhance & send'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={submit} disabled={!text.trim()}>
              Send
            </button>
          )}
        </div>
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
