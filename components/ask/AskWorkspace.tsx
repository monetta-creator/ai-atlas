'use client';

import { useEffect, useRef, useState } from 'react';
import type { ValidIdsPlain, SignalMap } from '@/lib/ask/verify';
import type { PeekKind } from '@/lib/ask/search';
import type { DatasetSuggestionMeta } from '@/components/datasets/AskDatasetCard';
import type { VerifyReport } from '@/lib/ask/deep';
import {
  appendMessage, createConvo, deleteConvo, dropLastAssistant, getConvo,
  maxSignalSuffix, mergedSignalMap, setMessageFieldReport, setMessageVerify, useAskConvos,
  type AskMessage,
} from '@/components/ask/store';
import { extractCostReport, extractWebSources, parseCostReport, type AskCostReport, type AskWebSource } from '@/lib/ask/history';
import { extractDecline, parseLane, type DeclinePayload, type Lane } from '@/lib/ask/lanes';
import { fieldReportContext } from '@/components/ask/field-report-context';
import type { FieldReportPlanResponse } from '@/lib/field-report/core';
import AskRail from '@/components/ask/AskRail';
import AskThread from '@/components/ask/AskThread';
import AskComposer from '@/components/ask/AskComposer';
import AskPeek from '@/components/ask/AskPeek';
import { buildHighlight, type DocHighlight } from '@/components/ask/AskDoc';
import PortalUnlock from '@/components/datasets/PortalUnlock';
import type { RenewalState } from '@/components/portal/RenewalNotice';

export type AskMode = 'admin' | 'portal' | 'locked';

const DATASET_TOKEN = /\[dataset\s+([a-z0-9-]+)\]/gi;

// The Ask workspace: the app's one viewport-height shell. Owns the active
// conversation, the streaming turn, and the mobile history sheet. Conversations
// persist in localStorage (components/ask/store.ts); the in-flight answer lives
// in state here and is committed to the store once, at completion/abort/error.
// A Field Report message carries no answer text; on the wire it becomes a
// short line with the report's title and summary so the model sees it in the
// history, and the report ids travel beside the messages so the Ask routes can
// add the report's sections as context (lib/field-report/followup.ts).
function wireMessage(m: AskMessage): { role: AskMessage['role']; content: string } {
  const r = m.fieldReport?.report;
  if (m.role === 'assistant' && r) {
    return { role: m.role, content: `[I wrote a Field Report: "${r.title}". Summary: ${r.summary.join(' ')}]` };
  }
  return { role: m.role, content: m.content };
}
function reportIdsIn(messages: AskMessage[]): string[] {
  return messages.map((m) => m.fieldReport?.report?.id).filter((id): id is string => Boolean(id)).slice(-3);
}

export default function AskWorkspace({
  mode, validIds, datasets, initialQuestion, keyState,
}: {
  mode: AskMode;
  validIds: ValidIdsPlain;
  datasets: DatasetSuggestionMeta[];
  initialQuestion?: string;
  // Locked mode only: a lapsed key's state, for the unlock panel's notice.
  keyState?: RenewalState | null;
}) {
  const convos = useAskConvos();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftMap, setDraftMap] = useState<SignalMap>({});
  const [draftSteps, setDraftSteps] = useState<string[]>([]);
  const [draftLane, setDraftLane] = useState<Lane | undefined>(undefined);
  const [webOn, setWebOn] = useState(false);
  const [fieldReportOn, setFieldReportOn] = useState(false);
  const [frPlanning, setFrPlanning] = useState(false);
  const [verifyingIndex, setVerifyingIndex] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [activePeek, setActivePeek] = useState<{ kind: PeekKind; id: string } | null>(null);
  const [peekDoc, setPeekDoc] = useState(false);
  const [peekHighlight, setPeekHighlight] = useState<DocHighlight>({ terms: [], phrases: [] });
  const abortRef = useRef<AbortController | null>(null);
  const seededRef = useRef(false);

  const endpoint = mode === 'admin' ? '/api/ask' : '/api/portal/ask';
  // The admin chat always researches (the deep loop is the default engine
  // since 2026-08-21); the portal stays on the quick route for budget reasons.
  const researchMode = mode === 'admin';
  const webAvailable = mode !== 'locked'; // admin + portal key; each search is budget-metered
  const fieldReportAvailable = mode !== 'locked'; // admin + portal key; the run itself is budget-metered per key
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
    // Bold markers stay in the text: the renderer turns **span** into a real
    // <strong> (the answer's section headers) since the 2026-08-21 rework.
    const clean = text
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
    if (researchMode) return runDeep(convoId);
    return runPlain(convoId);
  }

  // Field Report's first leg (2026-09-28): the user turn is already appended
  // by send(); this drafts the plan and appends it as a fieldReport-carrying
  // assistant message with no content (the card renders in its place, see
  // AskThread). frPlanning stands in for `streaming` here so the composer
  // stays disabled and the thread shows a pending line, without touching the
  // quick/deep streaming state machines at all.
  async function runFieldReportPlan(convoId: string) {
    const convo = getConvo(convoId);
    if (!convo) return;
    const last = convo.messages[convo.messages.length - 1];
    const question = last?.role === 'user' ? last.content : '';
    const context = fieldReportContext(convo, convo.messages.length - 1);
    setFrPlanning(true);
    try {
      const res = await fetch('/api/field-report/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: context || undefined }),
      });
      const data = (await res.json().catch(() => null)) as (FieldReportPlanResponse & { error?: string; reason?: string }) | null;
      if (!res.ok || !data?.plan) {
        const capped = res.status === 402 || data?.reason === 'cap';
        appendMessage(convoId, {
          role: 'assistant',
          content: '',
          fieldReport: {
            stage: 'error',
            runId: (data && typeof data.runId === 'string' && data.runId) || '',
            error: capped
              ? 'The daily limit for Field Reports on this access key is reached. Try again tomorrow.'
              : (data && typeof data.error === 'string' && data.error) || 'Something went wrong drafting the plan. Please try again.',
          },
        });
        return;
      }
      appendMessage(convoId, {
        role: 'assistant',
        content: '',
        fieldReport: {
          stage: 'plan',
          runId: data.runId,
          plan: data.plan,
          estimates: data.estimates,
          capRoomUsd: data.capRoomUsd ?? null,
        },
      });
    } catch {
      appendMessage(convoId, {
        role: 'assistant',
        content: '',
        fieldReport: { stage: 'error', runId: '', error: 'Something went wrong drafting the plan. Please try again.' },
      });
    } finally {
      setFrPlanning(false);
    }
  }

  async function runPlain(convoId: string) {
    const convo = getConvo(convoId);
    if (!convo || streaming) return;
    const wire = convo.messages.map(wireMessage);
    const fieldReportIds = reportIdsIn(convo.messages);
    const priorMap = mergedSignalMap(convo);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setDraft('');
    setDraftMap(priorMap);
    setDraftLane(undefined);

    let acc = '';
    let mergedMap: SignalMap = priorMap;
    let lane: Lane | undefined;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: wire, signalOffset: maxSignalSuffix(convo), web: webAvailable && webOn, fieldReportIds }),
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
      lane = parseLane(res.headers.get('X-Ask-Lane'));
      setDraftLane(lane);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        // The decline sentinel (a coded "unrelated" answer), the cost sentinel
        // and the web-sources sentinel are all kept out of the visible draft;
        // a decline shows nothing until the card renders at completion.
        setDraft(extractCostReport(extractWebSources(extractDecline(acc).text).text).text);
      }
      const { decline } = extractDecline(acc);
      if (decline) {
        appendMessage(convoId, { role: 'assistant', content: '', lane: lane ?? 'unrelated', decline });
        return;
      }
      const { text: withCost, sources } = extractWebSources(acc);
      const { text: bodyText, cost } = extractCostReport(withCost);
      const { clean, slugs } = extractDatasets(bodyText);
      appendMessage(convoId, {
        role: 'assistant',
        content: clean || 'The answer came back empty. Please try again.',
        signalMap: mergedMap,
        datasets: slugs.length ? slugs : undefined,
        webSources: sources.length ? sources : undefined,
        cost: cost ?? undefined,
        lane,
        error: clean ? undefined : true,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const { text: withCost, sources } = extractWebSources(extractDecline(acc).text);
        const { text: bodyText, cost } = extractCostReport(withCost);
        const { clean, slugs } = extractDatasets(bodyText);
        if (clean) {
          appendMessage(convoId, {
            role: 'assistant', content: clean, signalMap: mergedMap,
            datasets: slugs.length ? slugs : undefined,
            webSources: sources.length ? sources : undefined,
            cost: cost ?? undefined,
            lane,
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
      setDraftLane(undefined);
    }
  }

  // The research chat: NDJSON from /api/ask/deep. Status lines build the
  // research trail (persisted on the message as `steps`), delta lines build
  // the answer, web_sources / verify / cost lines attach their payloads, and
  // the terminal done line carries the full signal tag map.
  async function runDeep(convoId: string) {
    const convo = getConvo(convoId);
    if (!convo || streaming) return;
    const wire = convo.messages.map(wireMessage);
    const fieldReportIds = reportIdsIn(convo.messages);
    const priorMap = mergedSignalMap(convo);
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    setDraft('');
    setDraftMap(priorMap);
    setDraftSteps([]);
    setDraftLane(undefined);

    let acc = '';
    let mergedMap: SignalMap = priorMap;
    let steps: string[] = [];
    let errText = '';
    let verifyReport: VerifyReport | undefined;
    let costReport: AskCostReport | undefined;
    let webSources: AskWebSource[] | undefined;
    let lane: Lane | undefined;
    let declinePayload: DeclinePayload | undefined;
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: { type?: string; text?: unknown; signals?: unknown; report?: unknown; sources?: unknown; lane?: unknown; payload?: unknown };
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
      } else if (ev.type === 'lane' && typeof ev.lane === 'string') {
        const l = parseLane(ev.lane);
        if (l) {
          lane = l;
          setDraftLane(l);
        }
      } else if (ev.type === 'decline' && ev.payload && typeof ev.payload === 'object') {
        declinePayload = ev.payload as DeclinePayload;
      } else if (ev.type === 'done' && ev.signals && typeof ev.signals === 'object') {
        mergedMap = { ...priorMap, ...(ev.signals as SignalMap) };
        setDraftMap(mergedMap);
      } else if (ev.type === 'verify' && ev.report && typeof ev.report === 'object') {
        verifyReport = ev.report as VerifyReport;
      } else if (ev.type === 'cost' && ev.report && typeof ev.report === 'object') {
        costReport = parseCostReport(ev.report) ?? undefined;
      } else if (ev.type === 'web_sources' && Array.isArray(ev.sources)) {
        const list = (ev.sources as AskWebSource[])
          .filter((s) => !!s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
          .map((s) => ({ url: s.url.slice(0, 600), title: String(s.title ?? '').slice(0, 200) || s.url }))
          .slice(0, 8);
        webSources = list.length ? list : undefined;
      } else if (ev.type === 'error' && typeof ev.text === 'string') {
        errText = ev.text;
      }
    };

    try {
      const res = await fetch('/api/ask/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: wire, signalOffset: maxSignalSuffix(convo), signalMap: priorMap, fieldReportIds,
          web: webAvailable && webOn,
        }),
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

      if (declinePayload) {
        appendMessage(convoId, { role: 'assistant', content: '', lane: lane ?? 'unrelated', decline: declinePayload });
        return;
      }

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
        cost: costReport,
        webSources,
        lane,
        stopped: errText ? true : undefined, // cut short server-side; partial stands
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        const { clean, slugs } = extractDatasets(acc);
        if (clean) {
          appendMessage(convoId, {
            role: 'assistant', content: clean, signalMap: mergedMap,
            datasets: slugs.length ? slugs : undefined, stopped: true,
            lane,
            steps: steps.length ? steps : undefined,
            verify: verifyReport,
            cost: costReport,
            webSources,
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
      setDraftLane(undefined);
    }
  }

  function send(text: string) {
    const content = text.trim();
    if (!content || streaming || frPlanning || locked) return;
    let convoId = activeId;
    if (!convoId || !getConvo(convoId)) {
      convoId = createConvo(content);
      setActiveId(convoId);
    } else {
      appendMessage(convoId, { role: 'user', content });
    }
    if (fieldReportOn) {
      void runFieldReportPlan(convoId);
    } else {
      void run(convoId);
    }
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
          frPlanning={frPlanning}
          draft={draft}
          draftMap={draftMap}
          draftSteps={draftSteps}
          draftLane={draftLane}
          validIds={validIds}
          datasets={datasets}
          locked={locked}
          admin={mode === 'admin'}
          canVerify={mode === 'admin'}
          verifyingIndex={verifyingIndex}
          onPickStarter={pickStarter}
          onRegenerate={regenerate}
          onGenerate={() => { if (activeId) void run(activeId); }}
          onCite={openPeek}
          onVerify={(i) => { void verifyMessage(i); }}
          onFieldReportUpdate={(i, patch) => { if (activeId) setMessageFieldReport(activeId, i, patch); }}
        />

        {locked ? (
          <div className="ask-composer">
            <div className="ask-composer-inner" style={{ display: 'block' }}>
              <PortalUnlock keyState={keyState} />
            </div>
          </div>
        ) : (
          <AskComposer
            streaming={streaming || frPlanning}
            onSend={send}
            onStop={stop}
            researchMode={researchMode}
            webAvailable={webAvailable}
            web={webOn}
            onToggleWeb={() => setWebOn((v) => !v)}
            fieldReportAvailable={fieldReportAvailable}
            fieldReport={fieldReportOn}
            onToggleFieldReport={() => setFieldReportOn((v) => !v)}
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
