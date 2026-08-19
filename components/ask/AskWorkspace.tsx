'use client';

import { useEffect, useRef, useState } from 'react';
import type { ValidIdsPlain, SignalMap } from '@/lib/ask/verify';
import type { PeekKind } from '@/lib/ask/search';
import type { DatasetSuggestionMeta } from '@/components/datasets/AskDatasetCard';
import type { VerifyReport } from '@/lib/ask/deep';
import {
  appendMessage, createConvo, deleteConvo, dropLastAssistant, getConvo,
  maxSignalSuffix, mergedSignalMap, setMessageVerify, useAskConvos,
} from '@/components/ask/store';
import { extractWebSources } from '@/lib/ask/history';
import AskRail from '@/components/ask/AskRail';
import AskThread from '@/components/ask/AskThread';
import AskComposer from '@/components/ask/AskComposer';
import AskPeek from '@/components/ask/AskPeek';
import { buildHighlight, type DocHighlight } from '@/components/ask/AskDoc';
import PortalUnlock from '@/components/datasets/PortalUnlock';

export type AskMode = 'admin' | 'portal' | 'locked';

const DATASET_TOKEN = /\[dataset\s+([a-z0-9-]+)\]/gi;

// The Ask workspace: the app's one viewport-height shell. Owns the active
// conversation, the streaming turn, and the mobile history sheet. Conversations
// persist in localStorage (components/ask/store.ts); the in-flight answer lives
// in state here and is committed to the store once, at completion/abort/error.
export default function AskWorkspace({
  mode, validIds, datasets, initialQuestion,
}: {
  mode: AskMode;
  validIds: ValidIdsPlain;
  datasets: DatasetSuggestionMeta[];
  initialQuestion?: string;
}) {
  const convos = useAskConvos();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftMap, setDraftMap] = useState<SignalMap>({});
  const [draftSteps, setDraftSteps] = useState<string[]>([]);
  const [deepOn, setDeepOn] = useState(false);
  const [webOn, setWebOn] = useState(false);
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [activePeek, setActivePeek] = useState<{ kind: PeekKind; id: string } | null>(null);
  const [peekDoc, setPeekDoc] = useState(false);
  const [peekHighlight, setPeekHighlight] = useState<DocHighlight>({ terms: [], phrases: [] });
  const abortRef = useRef<AbortController | null>(null);
  const seededRef = useRef(false);

  const endpoint = mode === 'admin' ? '/api/ask' : '/api/portal/ask';
  const deepAvailable = mode === 'admin'; // admin-first; portal deep comes with a call multiplier
  const webAvailable = mode !== 'locked'; // admin + portal key; each search is budget-metered
  const locked = mode === 'locked';
  const active = activeId ? convos.find((c) => c.id === activeId) ?? null : null;

  // A ?q= seed (the lobby's chat launcher) fires once as the first turn. The
  // guard lives inside the deferred callback (not the effect body) so Strict
  // Mode's mount-cleanup-mount cycle still fires exactly once; the URL is
  // stripped so reload and back/forward never re-fire it. Deferred because
  // send() sets state synchronously, which an effect body must not.
  useEffect(() => {
    if (!initialQuestion || locked) return;
    const t = setTimeout(() => {
      if (seededRef.current) return;
      seededRef.current = true;
      window.history.replaceState(null, '', '/ask');
      send(initialQuestion);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the mobile history sheet first, then steps the peek panel
  // back out: document view returns to the record before the panel closes.
  useEffect(() => {
    if (!railOpen && !activePeek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (railOpen) setRailOpen(false);
      else if (peekDoc) setPeekDoc(false);
      else setActivePeek(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [railOpen, activePeek, peekDoc]);

  // A citation click opens the peek and freezes the highlight context for the
  // document viewer: prefix terms from the question the cited answer follows,
  // exact phrases from the answer's double-quoted spans. msgIndex is absent for
  // the streaming draft; the live draft text stands in for the answer then.
  function openPeek(kind: PeekKind, id: string, msgIndex?: number) {
    let question = '';
    let answer = '';
    const convo = activeId ? getConvo(activeId) : null;
    if (convo) {
      const idx = Math.min(msgIndex ?? convo.messages.length - 1, convo.messages.length - 1);
      const cited = convo.messages[idx];
      if (cited?.role === 'assistant') answer = cited.content;
      for (let i = idx; i >= 0; i--) {
        if (convo.messages[i].role === 'user') { question = convo.messages[i].content; break; }
      }
    }
    if (msgIndex === undefined && streaming) answer = draft;
    setPeekHighlight(buildHighlight(question, answer));
    setPeekDoc(false);
    setActivePeek({ kind, id });
  }

  function extractDatasets(text: string): { clean: string; slugs: string[] } {
    const slugs: string[] = [];
    // Also drop markdown bold markers: answers render as plain text, and deep
    // mode's Haiku slips them in as section labels despite the prompt.
    const clean = text
      .replace(/\*\*/g, '')
      .replace(DATASET_TOKEN, (m, slug: string) => {
        if (datasets.some((d) => d.slug === slug)) {
          if (!slugs.includes(slug)) slugs.push(slug);
          return '';
        }
        return m;
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { clean, slugs };
  }

  async function run(convoId: string) {
    if (deepAvailable && deepOn) return runDeep(convoId);
    return runPlain(convoId);
  }

  async function runPlain(convoId: string) {
    const convo = getConvo(convoId);
    if (!convo || streaming) return;
    const wire = convo.messages.map((m) => ({ role: m.role, content: m.content }));
    const priorMap = mergedSignalMap(convo);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setDraft('');
    setDraftMap(priorMap);

    let acc = '';
    let mergedMap: SignalMap = priorMap;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire, signalOffset: maxSignalSuffix(convo), web: webAvailable && webOn }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        appendMessage(convoId, {
          role: 'assistant',
          content: res.status === 401
            ? 'Your access has expired. Reload the page and unlock the workspace again to continue.'
            : 'Something went wrong. Please try again.',
          error: true,
        });
        return;
      }
      const hdr = res.headers.get('X-Ask-Signals');
      if (hdr) {
        try { mergedMap = { ...priorMap, ...(JSON.parse(hdr) as SignalMap) }; } catch { /* keep prior */ }
      }
      setDraftMap(mergedMap);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        // The web-sources sentinel arrives in the final chunk; keep it out of
        // the visible draft.
        setDraft(extractWebSources(acc).text);
      }
      const { text: bodyText, sources } = extractWebSources(acc);
      const { clean, slugs } = extractDatasets(bodyText);
      appendMessage(convoId, {
        role: 'assistant',
        content: clean || 'The answer came back empty. Please try again.',
        signalMap: mergedMap,
        datasets: slugs.length ? slugs : undefined,
        webSources: sources.length ? sources : undefined,
        error: clean ? undefined : true,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const { text: bodyText, sources } = extractWebSources(acc);
        const { clean, slugs } = extractDatasets(bodyText);
        if (clean) {
          appendMessage(convoId, {
            role: 'assistant', content: clean, signalMap: mergedMap,
            datasets: slugs.length ? slugs : undefined,
            webSources: sources.length ? sources : undefined,
            stopped: true,
          });
        }
        // An abort with no text yet leaves the user turn trailing; the thread
        // offers "Generate answer" for exactly that state.
      } else {
        appendMessage(convoId, { role: 'assistant', content: 'Something went wrong. Please try again.', error: true });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setDraft('');
    }
  }

  // Deep research: NDJSON from /api/ask/deep. Status lines build the research
  // trail (persisted on the message as `steps`), delta lines build the answer,
  // and the terminal done line carries the full signal tag map.
  async function runDeep(convoId: string) {
    const convo = getConvo(convoId);
    if (!convo || streaming) return;
    const wire = convo.messages.map((m) => ({ role: m.role, content: m.content }));
    const priorMap = mergedSignalMap(convo);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setDraft('');
    setDraftMap(priorMap);
    setDraftSteps([]);

    let acc = '';
    let mergedMap: SignalMap = priorMap;
    let steps: string[] = [];
    let errText = '';
    let verifyReport: VerifyReport | undefined;
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: { type?: string; text?: unknown; signals?: unknown; report?: unknown };
      try {
        ev = JSON.parse(line) as typeof ev;
      } catch {
        return; // a torn line; ignorable
      }
      if (ev.type === 'status' && typeof ev.text === 'string') {
        steps = [...steps, ev.text];
        setDraftSteps(steps);
      } else if (ev.type === 'delta' && typeof ev.text === 'string') {
        acc += ev.text;
        setDraft(acc);
      } else if (ev.type === 'done' && ev.signals && typeof ev.signals === 'object') {
        mergedMap = { ...priorMap, ...(ev.signals as SignalMap) };
        setDraftMap(mergedMap);
      } else if (ev.type === 'verify' && ev.report && typeof ev.report === 'object') {
        verifyReport = ev.report as VerifyReport;
      } else if (ev.type === 'error' && typeof ev.text === 'string') {
        errText = ev.text;
      }
    };

    try {
      const res = await fetch('/api/ask/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire, signalOffset: maxSignalSuffix(convo), signalMap: priorMap }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        appendMessage(convoId, {
          role: 'assistant',
          content: res.status === 401
            ? 'Your access has expired. Reload the page and unlock the workspace again to continue.'
            : 'Something went wrong. Please try again.',
          error: true,
        });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.trim()) handleLine(buf);

      const { clean, slugs } = extractDatasets(acc);
      if (!clean) {
        appendMessage(convoId, {
          role: 'assistant',
          content: errText || 'The answer came back empty. Please try again.',
          error: true,
          steps: steps.length ? steps : undefined,
        });
        return;
      }
      appendMessage(convoId, {
        role: 'assistant',
        content: clean,
        signalMap: mergedMap,
        datasets: slugs.length ? slugs : undefined,
        steps: steps.length ? steps : undefined,
        verify: verifyReport,
        stopped: errText ? true : undefined, // cut short server-side; partial stands
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const { clean, slugs } = extractDatasets(acc);
        if (clean) {
          appendMessage(convoId, {
            role: 'assistant', content: clean, signalMap: mergedMap,
            datasets: slugs.length ? slugs : undefined, stopped: true,
            steps: steps.length ? steps : undefined,
            verify: verifyReport,
          });
        }
        // An abort before any text leaves the user turn trailing; the thread
        // offers "Generate answer" for exactly that state.
      } else {
        appendMessage(convoId, { role: 'assistant', content: 'Something went wrong. Please try again.', error: true });
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setDraft('');
      setDraftSteps([]);
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || streaming || locked) return;
    let convoId = activeId;
    if (!convoId || !getConvo(convoId)) {
      convoId = createConvo(content);
      setActiveId(convoId);
    } else {
      appendMessage(convoId, { role: 'user', content });
    }
    void run(convoId);
  }

  function pickStarter(question: string) {
    if (locked) {
      document.querySelector<HTMLInputElement>('input[name="key"]')?.focus();
      return;
    }
    send(question);
  }

  function regenerate() {
    if (!activeId || streaming) return;
    dropLastAssistant(activeId);
    void run(activeId);
  }

  // On-demand "Check this answer": POST the finished answer + its frozen
  // signal map; the server fetches every cited record and judges faithfulness.
  async function verifyMessage(index: number) {
    if (!activeId || streaming || verifyingIndex !== null) return;
    const convo = getConvo(activeId);
    const msg = convo?.messages[index];
    if (!convo || !msg || msg.role !== 'assistant') return;
    let question = '';
    for (let i = index - 1; i >= 0; i--) {
      if (convo.messages[i].role === 'user') { question = convo.messages[i].content; break; }
    }
    setVerifyingIndex(index);
    try {
      const res = await fetch('/api/ask/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          answer: msg.content,
          signalMap: msg.signalMap ?? {},
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { verify?: VerifyReport };
        if (data.verify) setMessageVerify(activeId, index, data.verify);
      }
      // Non-OK or missing report: the button stays, which IS the retry affordance.
    } catch {
      // network failure: same, the button stays
    } finally {
      setVerifyingIndex(null);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function removeConvo(id: string) {
    deleteConvo(id);
    if (id === activeId) setActiveId(null);
  }

  const rail = (
    <AskRail
      convos={convos}
      activeId={activeId}
      onSelect={(id) => { setActiveId(id); setRailOpen(false); }}
      onNew={() => { setActiveId(null); setRailOpen(false); }}
      onDelete={removeConvo}
    />
  );

  return (
    <div className="ask-shell" data-peek={activePeek ? '' : undefined}>
      <div className="ask-rail">{rail}</div>

      <div className="ask-main">
        <div className="ask-topbar">
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setRailOpen(true)}>
            History
          </button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setActiveId(null)}>
            New chat
          </button>
          <span style={{ fontSize: 12, color: 'var(--faint-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active?.title ?? 'Ask the Atlas'}
          </span>
        </div>

        <AskThread
          convo={active}
          streaming={streaming}
          draft={draft}
          draftMap={draftMap}
          draftSteps={draftSteps}
          validIds={validIds}
          datasets={datasets}
          locked={locked}
          canVerify={mode === 'admin'}
          verifyingIndex={verifyingIndex}
          onPickStarter={pickStarter}
          onRegenerate={regenerate}
          onGenerate={() => { if (activeId) void run(activeId); }}
          onCite={openPeek}
          onVerify={(i) => { void verifyMessage(i); }}
        />

        {locked ? (
          <div className="ask-composer">
            <div className="ask-composer-inner" style={{ display: 'block' }}>
              <PortalUnlock />
            </div>
          </div>
        ) : (
          <AskComposer
            streaming={streaming}
            onSend={send}
            onStop={stop}
            deepAvailable={deepAvailable}
            deep={deepOn}
            onToggleDeep={() => setDeepOn((v) => !v)}
            webAvailable={webAvailable}
            web={webOn}
            onToggleWeb={() => setWebOn((v) => !v)}
          />
        )}
      </div>

      {activePeek && (
        <>
          {/* Backdrop styles exist only on mobile; on desktop the peek is the
              shell's third grid column and this div renders inert. */}
          <div className="ask-peek-backdrop" onClick={() => setActivePeek(null)} />
          <AskPeek
            peek={activePeek}
            onClose={() => setActivePeek(null)}
            canReadDoc={mode !== 'locked'}
            docOpen={peekDoc}
            onDocOpen={setPeekDoc}
            highlight={peekHighlight}
          />
        </>
      )}

      {railOpen && (
        <>
          <div className="ask-drawer-backdrop" onClick={() => setRailOpen(false)} />
          <div className="ask-drawer ask-drawer--left" role="dialog" aria-modal="true" aria-label="Conversation history">
            {rail}
          </div>
        </>
      )}
    </div>
  );
}
