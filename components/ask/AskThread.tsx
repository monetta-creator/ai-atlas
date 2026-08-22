'use client';

import { useEffect, useRef } from 'react';
import type { CitationKind, ParsedCode, ValidIdsPlain, SignalMap } from '@/lib/ask/verify';
import type { PeekKind } from '@/lib/ask/search';
import type { AskConvo } from '@/components/ask/store';
import { renderAnswer } from '@/components/ask/answer';
import AskStarters from '@/components/ask/AskStarters';
import AskVerify from '@/components/ask/AskVerify';
import AskCost from '@/components/ask/AskCost';
import AskDatasetCard, { type DatasetSuggestionMeta } from '@/components/datasets/AskDatasetCard';

const DATASET_TOKEN = /\[dataset\s+([a-z0-9-]+)\]/gi;

// CitationKind -> peek kind; signal and paper tags additionally resolve to
// uuids through the message's own frozen map before the peek opens.
const KIND_TO_PEEK: Record<CitationKind, PeekKind> = {
  claim: 'claim', bridge: 'bridge', stance: 'stance', Q: 'question', concept: 'concept', signal: 'signal',
  paper: 'paper', thread: 'thread',
};

// The message thread. Auto-scroll stays pinned to the bottom while streaming
// unless the reader scrolled up (tracked in a ref from the scroll handler;
// the ref is only read inside the effect, per the React Compiler rules).
export default function AskThread({
  convo, streaming, draft, draftMap, draftSteps, validIds, datasets, locked,
  canVerify, verifyingIndex,
  onPickStarter, onRegenerate, onGenerate, onCite, onVerify,
}: {
  convo: AskConvo | null;
  streaming: boolean;
  draft: string;
  draftMap: SignalMap;
  draftSteps: string[];
  validIds: ValidIdsPlain;
  datasets: DatasetSuggestionMeta[];
  locked: boolean;
  canVerify: boolean;
  verifyingIndex: number | null;
  onPickStarter: (q: string) => void;
  onRegenerate: () => void;
  onGenerate: () => void;
  onCite?: (kind: PeekKind, id: string, msgIndex?: number) => void;
  onVerify: (index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const messageCount = convo?.messages.length ?? 0;
  const stepCount = draftSteps.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messageCount, draft, streaming, stepCount]);

  // Strip verified dataset tokens from the live draft so they never flash as
  // raw text; unknown slugs stay visible (they read as prose and get flagged).
  // Bold markers stay: the renderer turns **span** into <strong>.
  const liveDraft = draft.replace(DATASET_TOKEN, (m, slug: string) =>
    datasets.some((d) => d.slug === slug) ? '' : m
  );

  const last = convo?.messages[convo.messages.length - 1];
  const showGenerate = !!convo && !streaming && last?.role === 'user';
  const showRegenerate =
    !!convo && !streaming && last?.role === 'assistant' && !last.error && !last.stopped;

  return (
    <div
      className="ask-thread"
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
    >
      {!convo ? (
        <div className="ask-thread-inner">
          <AskStarters onPick={onPickStarter} locked={locked} />
        </div>
      ) : (
        <div className="ask-thread-inner">
          {convo.messages.map((m, i) => {
            if (m.role === 'user') {
              return <div key={i} className="ask-msg--user">{m.content}</div>;
            }
            const map = m.signalMap ?? {};
            const citeOpts = onCite
              ? {
                  onCite: (c: ParsedCode) => {
                    if (c.kind === 'signal' || c.kind === 'paper') {
                      const uuid = map[c.id];
                      if (uuid) onCite(KIND_TO_PEEK[c.kind], uuid, i);
                      return;
                    }
                    onCite(KIND_TO_PEEK[c.kind], c.id, i);
                  },
                }
              : {};
            const { nodes, unverified } = renderAnswer(m.content, validIds, map, citeOpts);
            return (
              <div key={i}>
                {m.steps && m.steps.length > 0 && (
                  <details className="ask-steps">
                    <summary>Research · {m.steps.length} step{m.steps.length === 1 ? '' : 's'}</summary>
                    <ol>
                      {m.steps.map((s, j) => <li key={j}>{s}</li>)}
                    </ol>
                  </details>
                )}
                <div className="ask-msg--assistant" style={m.error ? { color: 'var(--faint-ink)' } : undefined}>
                  {nodes}
                </div>
                {m.stopped && (
                  <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                    stopped
                  </p>
                )}
                {m.verify && <AskVerify report={m.verify} />}
                {m.cost && <AskCost cost={m.cost} />}
                {canVerify && !m.verify && !m.error && !streaming && (
                  <div className="ask-msg-actions">
                    <button
                      type="button"
                      className="btn btn--quiet btn--sm"
                      onClick={() => onVerify(i)}
                      disabled={verifyingIndex !== null}
                    >
                      {verifyingIndex === i ? 'Checking against the records...' : 'Check this answer'}
                    </button>
                  </div>
                )}
                {m.datasets && m.datasets.length > 0 && (
                  <AskDatasetCard slugs={m.datasets} datasets={datasets} />
                )}
                {unverified > 0 && (
                  <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--heat-4)' }}>
                    {unverified} reference{unverified === 1 ? '' : 's'} could not be verified and {unverified === 1 ? 'is' : 'are'} flagged above.
                  </p>
                )}
                {i === convo.messages.length - 1 && (m.error || m.stopped) && !streaming && (
                  <div className="ask-msg-actions">
                    <button type="button" className="btn btn--quiet btn--sm" onClick={onRegenerate}>
                      {m.error ? 'Retry' : 'Regenerate'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {streaming && (
            <div>
              {draftSteps.length > 0 && (
                <div className="ask-steps ask-steps--live">
                  <ol>
                    {draftSteps.map((s, j) => <li key={j}>{s}</li>)}
                  </ol>
                </div>
              )}
              <div className="ask-msg--assistant">
                {renderAnswer(liveDraft, validIds, draftMap, onCite ? {
                  onCite: (c: ParsedCode) => {
                    if (c.kind === 'signal' || c.kind === 'paper') {
                      const uuid = draftMap[c.id];
                      if (uuid) onCite(KIND_TO_PEEK[c.kind], uuid);
                      return;
                    }
                    onCite(KIND_TO_PEEK[c.kind], c.id);
                  },
                } : {}).nodes}
                <span aria-hidden="true" style={{ color: 'var(--faint-ink)' }}>▍</span>
              </div>
            </div>
          )}

          {showGenerate && (
            <div className="ask-msg-actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={onGenerate}>
                Generate answer
              </button>
            </div>
          )}
          {showRegenerate && (
            <div className="ask-msg-actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={onRegenerate}>
                Regenerate
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
