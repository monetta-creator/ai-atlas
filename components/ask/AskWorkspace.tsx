'use client';

import { useEffect, useRef, useState } from 'react';
import type { ValidIdsPlain, SignalMap } from '@/lib/ask/verify';
import type { PeekKind } from '@/lib/ask/search';
import type { DatasetSuggestionMeta } from '@/components/datasets/AskDatasetCard';
import type { VerifyReport } from '@/lib/ask/deep';
import {
  appendMessage, createConvo, deleteConvo, dropLastAssistant, enableServerSync, getConvo, importServerConvos,
  maxSignalSuffix, mergedSignalMap, setConvoModel, setMessageFieldReport, setMessageVerify, useAskConvos,
  type AskChip, type AskCostStored, type AskMessage, type EnhanceCardData,
} from '@/components/ask/store';
import { extractCostReport, extractWebSources, parseCostReport, type AskWebSource } from '@/lib/ask/history';
import type { AtlasView } from '@/lib/tools/types';
import type { V2Decision } from '@/lib/ask/v2-events';
import type { TrendingTab } from '@/lib/ask/trending';
import { extractDecline, parseLane, type DeclinePayload, type Lane } from '@/lib/ask/lanes';
import { fieldReportContext } from '@/components/ask/field-report-context';
import type { FieldReportPlanResponse } from '@/lib/field-report/core';
import AskRail from '@/components/ask/AskRail';
import AskThread from '@/components/ask/AskThread';
import AskComposer from '@/components/ask/AskComposer';
import EnhanceCard from '@/components/ask/EnhanceCard';
import AskPeek from '@/components/ask/AskPeek';
import AskTrending from '@/components/ask/AskTrending';
import StartHere from '@/components/lobby/StartHere';
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
  mode, validIds, datasets, initialQuestion, keyState, trending = [],
}: {
  mode: AskMode;
  validIds: ValidIdsPlain;
  datasets: DatasetSuggestionMeta[];
  initialQuestion?: string;
  // Locked mode only: a lapsed key's state, for the unlock panel's notice.
  keyState?: RenewalState | null;
  // The empty state's "what is moving" tabs (lib/ask/trending.ts).
  trending?: TrendingTab[];
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
  const [v2On, setV2On] = useState(false);
  // Selector pick for a conversation that does not exist yet; once it does the pick lives on the convo.
  const [pendingModel, setPendingModel] = useState('auto');
  const [frPlanning, setFrPlanning] = useState(false);
  // Enhance (P4.6): the call in flight, the card of an Enhance-only run (not sent yet), and a text the composer should load.
  const [enhancing, setEnhancing] = useState(false);
  const [pendingEnhance, setPendingEnhance] = useState<EnhanceCardData | null>(null);
  const [seed, setSeed] = useState<{ id: number; text: string } | null>(null);
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
  const showModel = mode === 'admin';
  const model = active ? active.model ?? 'auto' : pendingModel;
  function pickModel(id: string) {
    if (activeId && getConvo(activeId)) setConvoModel(activeId, id);
    else setPendingModel(id);
  }

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

  // Server mirror (redo P4.1): admin and access-key sessions keep a server copy
  // of every conversation and pull in threads started on another device. The
  // store is external (useSyncExternalStore), so no component state is set here.
  useEffect(() => {
    if (locked) return;
    enableServerSync(true);
    void importServerConvos();
    return () => enableServerSync(false);
  }, [locked]);

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
    let costReport: AskCostStored | undefined;
    let webSources: AskWebSource[] | undefined;
    let lane: Lane | undefined;
    let declinePayload: DeclinePayload | undefined;
    let decision: V2Decision | undefined;
    let skill: AskMessage['skill'];
    let chips: AskChip[] | undefined;
    let views: AtlasView[] = [];
    // Admin turns take the v2 path when picked by ?v=2, a manual model, or the toggle;
    // a /skill or @agent turn, or an enhanced one, always does (skills only exist there).
    const lastUser = convo.messages[convo.messages.length - 1];
    const lastText = lastUser?.role === 'user' ? lastUser.content.trimStart() : '';
    const enhanced = lastUser?.role === 'user' ? lastUser.enhanced : undefined;
    const useV2 = mode === 'admin' && (new URLSearchParams(window.location.search).get('v') === '2' || (convo.model ?? 'auto') !== 'auto' || v2On
      || lastText.startsWith('/') || lastText.startsWith('@') || !!enhanced);
    const webForTurn = webAvailable && (webOn || !!enhanced?.decision.web);
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let ev: { type?: string; text?: unknown; signals?: unknown; report?: unknown; sources?: unknown; lane?: unknown; payload?: unknown; decision?: unknown; slug?: unknown; title?: unknown; kind?: unknown; chips?: unknown; view?: unknown };
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
        const parsed = parseCostReport(ev.report);
        if (parsed) {
          const r = ev.report as { cache_write_tokens?: unknown; tool_calls?: unknown };
          const extra: AskCostStored = { ...parsed };
          if (typeof r.cache_write_tokens === 'number' && r.cache_write_tokens > 0) extra.cache_write_tokens = Math.floor(r.cache_write_tokens);
          if (typeof r.tool_calls === 'number' && r.tool_calls > 0) extra.tool_calls = Math.floor(r.tool_calls);
          costReport = extra;
        }
      } else if (ev.type === 'decision' && ev.decision && typeof ev.decision === 'object') {
        decision = ev.decision as V2Decision;
      } else if (ev.type === 'skill' && typeof ev.slug === 'string') {
        const kind = ev.kind === 'agent' || ev.kind === 'unknown' ? ev.kind : 'skill';
        skill = { slug: ev.slug.slice(0, 60), title: typeof ev.title === 'string' ? ev.title.slice(0, 80) : ev.slug, kind };
      } else if (ev.type === 'chips' && Array.isArray(ev.chips)) {
        const list = (ev.chips as AskChip[])
          .filter((c) => !!c && typeof c.label === 'string' && typeof c.prompt === 'string' && c.label && c.prompt)
          .map((c) => ({ label: c.label.slice(0, 80), prompt: c.prompt.slice(0, 600), kind: typeof c.kind === 'string' ? c.kind : '' }))
          .slice(0, 3);
        chips = list.length ? list : undefined;
      } else if (ev.type === 'view' && ev.view && typeof ev.view === 'object') {
        const v = ev.view as AtlasView;
        if ((v.kind === 'table' || v.kind === 'timeline' || v.kind === 'chart') && Array.isArray(v.rows) && typeof v.title === 'string') {
          views = [...views, v].slice(0, 6);
        }
      } else if (ev.type === 'retract') {
        // v2: the text so far was narration before a tool call; drop it.
        acc = '';
        setDraft('');
      } else if (ev.type === 'tool_call') {
        // v2: tool progress already arrives as status lines; nothing to render.
      } else if ((ev.type === 'web_sources' || ev.type === 'sources') && Array.isArray(ev.sources)) {
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
      const res = await fetch(useV2 ? '/api/ask/v2' : '/api/ask/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: wire, signalOffset: maxSignalSuffix(convo), signalMap: priorMap, fieldReportIds,
          web: webForTurn,
          ...(useV2 ? { model: convo.model ?? 'auto' } : {}),
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
        decision,
        skill,
        chips,
        views: views.length ? views : undefined,
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
            decision,
            skill,
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

  function send(text: string, enhanced?: EnhanceCardData) {
    // `@field-report <question>` launches the agent from the bar: the same
    // editable plan card the Field Report switch opens (redo P4.4, first agent).
    const agentRe = /^\s*@field-report\b\s*/i;
    const agentCall = fieldReportAvailable && agentRe.test(text);
    const content = agentCall ? text.replace(agentRe, '').trim() : text.trim();
    if (!content || streaming || frPlanning || locked) return;
    setPendingEnhance(null);
    let convoId = activeId;
    if (!convoId || !getConvo(convoId)) {
      convoId = createConvo(content, enhanced);
      if (pendingModel !== 'auto') setConvoModel(convoId, pendingModel);
      setActiveId(convoId);
    } else {
      appendMessage(convoId, { role: 'user', content, ...(enhanced ? { enhanced } : {}) });
    }
    if (fieldReportOn || agentCall) {
      void runFieldReportPlan(convoId);
    } else {
      void run(convoId);
    }
  }

  // Enhance (admin): tidy the ask, then either send the cleaned question
  // (andSend) or hand it back to the composer with the card shown. Any failure
  // falls back to a plain send (or nothing, for Enhance-only) without a word.
  async function enhance(text: string, andSend: boolean): Promise<void> {
    const query = text.trim();
    if (!query || streaming || frPlanning || locked || enhancing) return;
    const prevConvo = activeId ? getConvo(activeId) : null;
    const prev = prevConvo ? [...prevConvo.messages].reverse().find((m) => m.role === 'user')?.content : undefined;
    setEnhancing(true);
    let card: EnhanceCardData | null = null;
    try {
      const res = await fetch('/api/ask/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, ...(prev ? { prev } : {}) }),
      });
      if (res.ok) {
        const d = (await res.json()) as Partial<EnhanceCardData> & { decision?: Partial<EnhanceCardData['decision']> };
        if (d && typeof d.question === 'string' && d.question.trim() && d.decision && typeof d.decision.label === 'string') {
          const dec = d.decision;
          card = {
            original: query,
            question: d.question.trim(),
            plan: Array.isArray(d.plan) ? d.plan.map(String) : [],
            clarify: Array.isArray(d.clarify) ? d.clarify.map(String) : [],
            records: Array.isArray(d.records) ? d.records.map(String) : [],
            decision: {
              model: String(dec.model ?? ''), label: dec.label ?? '', tier: String(dec.tier ?? ''),
              web: !!dec.web, depth: String(dec.depth ?? ''), reason: String(dec.reason ?? ''),
              estUsd: typeof dec.estUsd === 'number' ? dec.estUsd : 0,
              budgetMessage: typeof dec.budgetMessage === 'string' ? dec.budgetMessage : null,
            },
            enhanceUsd: typeof d.enhanceUsd === 'number' ? d.enhanceUsd : undefined,
          };
        }
      }
    } catch {
      // fall through to the plain path
    } finally {
      setEnhancing(false);
    }
    if (andSend) {
      send(card ? card.question : query, card ?? undefined);
    } else if (card) {
      setPendingEnhance(card);
      setSeed({ id: Date.now(), text: card.question });
    }
  }

  function editQuestion(question: string) {
    setSeed({ id: Date.now(), text: question });
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

      <div className="ask-main" data-empty={active ? undefined : ''}>
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
          onEditQuestion={editQuestion}
        />

        {locked ? (
          <div className="ask-composer">
            <div className="ask-composer-inner" style={{ display: 'block' }}>
              <PortalUnlock keyState={keyState} />
            </div>
          </div>
        ) : (
          <AskComposer
            above={pendingEnhance ? <EnhanceCard card={pendingEnhance} onEdit={editQuestion} /> : null}
            streaming={streaming || frPlanning}
            onSend={(t) => send(t)}
            audience={mode === 'admin' ? 'admin' : null /* the portal path runs no skills yet */}
            enhanceAvailable={mode === 'admin'}
            enhancing={enhancing}
            onEnhance={(t, andSend) => { void enhance(t, andSend); }}
            seed={seed}
            onStop={stop}
            researchMode={researchMode}
            webAvailable={webAvailable}
            web={webOn}
            onToggleWeb={() => setWebOn((v) => !v)}
            fieldReportAvailable={fieldReportAvailable}
            fieldReport={fieldReportOn}
            onToggleFieldReport={() => setFieldReportOn((v) => !v)}
            showModel={showModel}
            model={model}
            onModel={pickModel}
            v2On={v2On}
            onToggleV2={() => setV2On((v) => !v)}
          />
        )}

        {!active && (
          <AskTrending
            tabs={trending}
            onOpen={(kind, id) => openPeek(kind, id)}
            onAsk={pickStarter}
            footer={<StartHere variant="link" onPick={pickStarter} />}
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
