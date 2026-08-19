'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileRun, type Step, type Timeline } from '@/lib/traceroute/compile';
import {
  atEnd,
  currentStep,
  initialState,
  overallProgress,
  reduce,
  type PlayerCmd,
  type PlayerState,
  type Rate,
} from '@/lib/traceroute/player';
import { PROVENANCE_COPY, contextAt, makeToken, type ScriptedRun, type TokenRec } from '@/lib/traceroute/run-types';
import { DEFAULT_RUN_ID, RUNS, RUN_BY_ID, nearestRun, spliceRun } from '@/lib/traceroute/runs';
import { hasWebGL } from '@/lib/traceroute/webgl';
import PropDrawer, { type DrawerTarget } from './PropDrawer';
import type { ArchPartId } from '@/lib/traceroute/architecture';

// three.js is about 150KB gzipped on a public reader surface, so the canvas is split out and
// only fetched when a browser can actually use it. The DOM walkthrough below is the whole
// explanation on its own, which is why this can fail to load with nothing lost.
const Stage = dynamic(() => import('./Stage'), { ssr: false });

// Stop 09, the payoff: the autoregressive loop, played out one beat at a time.
//
// Everything visible here is derived from (timeline, index, progress). The player reducer is
// pure and lives in lib/traceroute/player.ts; this component only renders what it is told and
// dispatches commands. That separation is what makes scrubbing land on exactly the same
// picture as playing, and it is the property the whole feature rests on.

const RATES: Rate[] = [0.5, 1, 1.5, 2];

/** Architecture parts have no supply-chain sources; the drawer's node map is unused here. */
const EMPTY_NODES = new Map<string, never>();

function pct(p: number): string {
  return `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
}

function TokenStrip({
  tokens,
  promptLen,
  lit,
}: {
  tokens: TokenRec[];
  promptLen: number;
  lit: number[];
}) {
  const litSet = useMemo(() => new Set(lit), [lit]);
  return (
    <div className="tr-strip" role="list" aria-label="Tokens in context">
      {tokens.map((t, i) => (
        <span
          key={`${i}-${t.id}`}
          role="listitem"
          className="tr-tok"
          data-lit={litSet.has(i) ? '' : undefined}
          data-generated={i >= promptLen ? '' : undefined}
          title={`id ${t.id}`}
        >
          {t.display}
        </span>
      ))}
    </div>
  );
}

function Panel({ step, context }: { step: Step; context: TokenRec[] }) {
  const p = step.panel;
  if (!p) return null;

  if (p.kind === 'topk' && p.candidates) {
    const max = Math.max(...p.candidates.map((c) => c.prob), 0.001);
    return (
      <div className="tr-panel">
        <div className="section-label">What could come next</div>
        <ul className="tr-bars">
          {p.candidates.map((c, i) => (
            <li
              key={`${c.token.id}-${i}`}
              className="tr-bar"
              data-chosen={p.chosen && c.token.id === p.chosen.id ? '' : undefined}
            >
              <span className="tr-bar-tok">{c.token.display}</span>
              <span className="tr-bar-track">
                <span className="tr-bar-fill" style={{ width: `${(c.prob / max) * 100}%` }} />
              </span>
              <span className="tr-bar-pct">{pct(c.prob)}</span>
            </li>
          ))}
        </ul>
        <p className="tr-panel-note">
          Only the top {p.candidates.length} are shown. The remaining probability is spread
          across the rest of the vocabulary.
        </p>
      </div>
    );
  }

  if (p.kind === 'attention' && p.weights) {
    const max = Math.max(...p.weights, 0.001);
    return (
      <div className="tr-panel">
        <div className="section-label">
          What this position is reading · layer {p.attendLayer} · head {p.attendHead}
        </div>
        <ul className="tr-bars tr-bars--attn">
          {p.weights.map((w, i) => (
            <li key={i} className="tr-bar">
              <span className="tr-bar-tok">{context[i]?.display ?? String(i)}</span>
              <span className="tr-bar-track">
                <span className="tr-bar-fill" style={{ width: `${(w / max) * 100}%` }} />
              </span>
              <span className="tr-bar-pct">{pct(w)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (p.kind === 'dims' && p.dims) {
    return (
      <div className="tr-panel">
        <div className="section-label">Shape</div>
        <ul className="tr-dims">
          {p.dims.map((d) => (
            <li key={d.label}>
              <b>{d.value}</b>
              <span>{d.label}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return null;
}

function RunPlayer({ run, condensed }: { run: ScriptedRun; condensed: boolean }) {
  const timeline: Timeline = useMemo(
    () => compileRun(run, { condenseAfterCycle: condensed ? 1 : Infinity }),
    [run, condensed]
  );

  // Structural state (which step, playing, rate) is React state: it changes a few times a
  // second at most. Sub-step progress is a ref, advanced by the loop below and read only
  // inside animation callbacks, never during render. That keeps React re-rendering once per
  // STEP rather than once per frame, which matters a great deal with a canvas in the tree.
  const [state, setState] = useState<PlayerState>(initialState);
  const elapsedRef = useRef(0);

  const dispatch = useCallback(
    (c: PlayerCmd) => {
      if (c.t !== 'tick') elapsedRef.current = 0;
      setState((s) => reduce(s, c, timeline));
    },
    [timeline]
  );

  const stepDuration = timeline.steps[state.index]?.durationMs ?? 1;
  const atLastStep = state.index >= timeline.steps.length - 1;

  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(now - last, 250); // a backgrounded tab must not fast-forward
      last = now;
      elapsedRef.current += dt * state.rate;
      if (elapsedRef.current >= stepDuration) {
        elapsedRef.current = 0;
        dispatch(atLastStep ? { t: 'pause' } : { t: 'next' });
        return; // the effect re-runs for the next step
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state.playing, state.rate, stepDuration, atLastStep, dispatch]);

  const step = currentStep(state, timeline);
  const context = useMemo(
    () => (step ? contextAt(run, step.cycle < 0 ? -1 : step.cycle) : run.promptTokens),
    [run, step]
  );
  // At and after the append beat the new token is already part of the visible context.
  const shown = useMemo(() => {
    if (!step || step.cycle < 0) return context;
    const emitted = run.outputs[step.cycle]?.token;
    const past = step.phase === 'append' || step.phase === 'done';
    return past && emitted ? [...context, emitted] : context;
  }, [context, run, step]);

  // Resolved after mount so server and first client render agree.
  const [canvas, setCanvas] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const openArch = useCallback((id: ArchPartId) => setDrawer({ kind: 'arch', id }), []);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCanvas(hasWebGL()));
    return () => cancelAnimationFrame(id);
  }, []);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === ' ') { e.preventDefault(); dispatch({ t: 'toggle' }); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); dispatch({ t: 'next' }); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); dispatch({ t: 'prev' }); }
  }, [dispatch]);

  if (!step) return null;

  return (
    <div className="tr-player" onKeyDown={onKey} tabIndex={0} role="group" aria-label="Inference walkthrough">
      <div className="tr-prov">
        <span className="tr-prov-tag">{run.provenance === 'tokenizer' ? 'submitted' : 'scripted'}</span>
        <p>{PROVENANCE_COPY[run.provenance]}</p>
      </div>

      {canvas && (
        <Stage timeline={timeline} index={state.index} elapsedRef={elapsedRef} onPickPart={openArch} />
      )}

      <TokenStrip tokens={shown} promptLen={run.promptTokens.length} lit={step.tokensLit} />

      <div className="tr-transport">
        <button type="button" className="tr-btn" onClick={() => dispatch({ t: 'restart' })} aria-label="Restart">
          ⟲
        </button>
        <button type="button" className="tr-btn" onClick={() => dispatch({ t: 'prev' })} aria-label="Previous step">
          ‹
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--primary"
          onClick={() => dispatch({ t: 'toggle' })}
        >
          {state.playing ? 'Pause' : atEnd(state, timeline) ? 'Replay' : 'Play'}
        </button>
        <button type="button" className="tr-btn" onClick={() => dispatch({ t: 'next' })} aria-label="Next step">
          ›
        </button>
        <div className="tr-rates">
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              className="tr-rate"
              aria-pressed={state.rate === r}
              onClick={() => dispatch({ t: 'rate', rate: r })}
            >
              {r}x
            </button>
          ))}
        </div>
        <span className="tr-counter">
          {state.index + 1} / {timeline.steps.length}
        </span>
      </div>

      <input
        className="tr-scrub"
        type="range"
        min={0}
        max={Math.max(0, timeline.steps.length - 1)}
        value={state.index}
        onChange={(e) => dispatch({ t: 'seek', index: Number(e.target.value) })}
        aria-label="Scrub through the walkthrough"
      />

      <ol className="tr-cycles" aria-label="Generation cycles">
        {timeline.cycles.map((c) => (
          <li key={c.cycle}>
            <button
              type="button"
              className="tr-cycle"
              data-active={step.cycle === c.cycle ? '' : undefined}
              onClick={() => dispatch({ t: 'seekCycle', cycle: c.cycle })}
            >
              {c.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="tr-stage">
        <div className="tr-phase">
          <span className="tr-phase-name">{step.phase.replace(/-/g, ' ')}</span>
          {step.blockIndex != null && <span className="tr-phase-block">block {step.blockIndex + 1}</span>}
        </div>
        <p className="tr-caption">{step.caption}</p>
        {step.note && <p className="tr-note">{step.note}</p>}
        <Panel step={step} context={context} />
        <PropDrawer target={drawer} nodes={EMPTY_NODES} onClose={() => setDrawer(null)} />
        <div className="tr-progress" aria-hidden="true">
          <span style={{ width: `${overallProgress(state, timeline) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function InferencePlayer() {
  const [runId, setRunId] = useState(DEFAULT_RUN_ID);
  const [condensed, setCondensed] = useState(true);
  const [custom, setCustom] = useState<ScriptedRun | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = custom ?? RUN_BY_ID.get(runId) ?? RUNS[0];

  // Tokenizing happens on the server. The vocabulary is the expensive part of a BPE
  // tokenizer (o200k_base is about 1MB gzipped), which is far too much to download the
  // moment someone starts typing. The route is pure string processing: no model, no DB.
  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/traceroute/tokenize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as
        | { tokens: { id: number; text: string }[]; text: string }
        | { error: string };
      if (!res.ok || !('tokens' in data)) {
        setErr('error' in data ? data.error : 'Could not tokenize that.');
        return;
      }
      const tokens = data.tokens.map((t) => makeToken(t.id, t.text));
      setCustom(spliceRun(tokens, data.text, nearestRun(data.text)));
    } catch {
      setErr('Could not reach the tokenizer.');
    } finally {
      setBusy(false);
    }
  }, [draft]);

  return (
    <div className="tr-inference">
      <div className="tr-picker">
        <div className="section-label">Pick a sentence</div>
        <div className="tr-picker-row">
          {RUNS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="tr-pick"
              aria-pressed={!custom && runId === r.id}
              onClick={() => {
                setCustom(null);
                setRunId(r.id);
              }}
            >
              <span className="tr-pick-teaser">{r.teaser}</span>
              <span className="tr-pick-title">{r.title}</span>
            </button>
          ))}
        </div>

        <div className="tr-custom">
          <label className="lbl" htmlFor="tr-prompt">Or submit another</label>
          <div className="tr-custom-row">
            <input
              id="tr-prompt"
              className="input"
              value={draft}
              placeholder="The best thing about mornings is"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={busy || !draft.trim()}
              onClick={() => void submit()}
            >
              {busy ? 'Tokenizing…' : 'Send'}
            </button>
          </div>
          {err && <p className="tr-custom-err">{err}</p>}
          <p className="tr-custom-note">
            Submitted text is tokenized for real. The continuation is a scripted walkthrough,
            not a live model. The tokenizer is a byte-pair encoder of the kind these models use,
            not the exact one behind any particular assistant.
          </p>
        </div>
      </div>

      <div className="tr-detail-toggle">
        <button type="button" className="tr-rate" aria-pressed={!condensed} onClick={() => setCondensed((c) => !c)}>
          {condensed ? 'Show every step' : 'Condense repeats'}
        </button>
        <span className="tr-detail-hint">
          {condensed
            ? 'Later tokens are shortened, since the machine is the same every time.'
            : 'Every beat of every token, including the repeats.'}
        </span>
      </div>

      <RunPlayer key={`${run.id}:${condensed}`} run={run} condensed={condensed} />
    </div>
  );
}
