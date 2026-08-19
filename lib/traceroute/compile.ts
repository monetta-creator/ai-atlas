// Turns a ScriptedRun into a Timeline: the flat list of steps the player walks.
//
// The autoregressive loop is NOT in the data. The data holds `outputs`, one entry per token
// the model produced. This compiler expands that into cycles, and emits an explicit `append`
// phase whose visual is a loop-back connector from the sampler to the embedding table.
// Change the sentence, get a new loop for free.
//
// Pure: no React, no three.js, no DOM. Testable with plain node.

import { ARCH_PART_IDS, MODEL_SPEC, type ArchPartId } from './architecture';
import { PHASE_COPY, type CaptionCtx } from './copy';
import {
  CONDENSED_CYCLE,
  FULL_CYCLE,
  PHASES,
  PROLOGUE,
  type FlowKind,
  type PhaseId,
  type PoseKey,
} from './phases';
import { contextAt, type Candidate, type ScriptedRun, type TokenRec } from './run-types';

interface StepPanel {
  kind: 'topk' | 'attention' | 'dims' | 'tokens';
  /** topk */
  candidates?: Candidate[];
  chosen?: TokenRec;
  /** attention */
  weights?: number[];
  attendLayer?: number;
  attendHead?: number;
  /** dims */
  dims?: { label: string; value: string }[];
}

export interface Step {
  /** Stable and deep-linkable: `${cycle}:${phase}`. */
  key: string;
  /** -1 is the prompt prologue. */
  cycle: number;
  phase: PhaseId;
  blockIndex: number | null;
  focus: ArchPartId[];
  dim: ArchPartId[];
  flow: { from: ArchPartId; to: ArchPartId; kind: FlowKind }[];
  /** Token positions moving through the stack this step. The KV cache story. */
  positionsActive: number[];
  /** Token-strip positions to highlight. */
  tokensLit: number[];
  caption: string;
  panel?: StepPanel;
  poseKey: PoseKey;
  durationMs: number;
  /** Editorial aside carried up from the run data. */
  note?: string;
}

export interface Timeline {
  runId: string;
  steps: Step[];
  byKey: ReadonlyMap<string, number>;
  cycles: { cycle: number; label: string; startIndex: number; endIndex: number }[];
  totalMs: number;
  condensed: boolean;
}

interface CompileOpts {
  /**
   * Cycles at or after this index are condensed. Default 1, so the first generated token
   * gets the full twenty-beat pass and everything after it is the short form. Pass
   * Infinity for "show every step".
   */
  condenseAfterCycle?: number;
}

const { dModel, dFF, vocab, nHeads, dHead } = MODEL_SPEC.dims;

function dimsFor(phase: PhaseId, contextLen: number): { label: string; value: string }[] {
  switch (phase) {
    case 'embed':
      return [
        { label: 'tokens in context', value: String(contextLen) },
        { label: 'numbers per token', value: dModel.toLocaleString('en-US') },
        { label: 'total', value: (contextLen * dModel).toLocaleString('en-US') },
      ];
    case 'attn-qkv':
      return [
        { label: 'heads', value: String(nHeads) },
        { label: 'per head', value: String(dHead) },
        { label: 'projections', value: 'query, key, value' },
      ];
    case 'mlp-up':
      return [
        { label: 'in', value: dModel.toLocaleString('en-US') },
        { label: 'out', value: dFF.toLocaleString('en-US') },
        { label: 'ratio', value: `${(dFF / dModel).toFixed(1)}x` },
      ];
    case 'unembed':
      return [
        { label: 'in', value: dModel.toLocaleString('en-US') },
        { label: 'out', value: vocab.toLocaleString('en-US') },
        { label: 'one score per', value: 'vocabulary entry' },
      ];
    default:
      return [];
  }
}

function panelFor(
  phase: PhaseId,
  run: ScriptedRun,
  cycle: number,
  contextLen: number
): StepPanel | undefined {
  const kind = PHASES[phase].panel;
  if (!kind) return undefined;
  const out = cycle >= 0 ? run.outputs[cycle] : undefined;

  if (kind === 'topk') {
    if (!out) return undefined;
    return { kind, candidates: out.top, chosen: phase === 'sample' ? out.token : undefined };
  }
  if (kind === 'attention') {
    if (!out?.attention) return undefined;
    return {
      kind,
      weights: out.attention.weights,
      attendLayer: out.attention.layer,
      attendHead: out.attention.head,
    };
  }
  if (kind === 'dims') {
    const dims = dimsFor(phase, contextLen);
    return dims.length ? { kind, dims } : undefined;
  }
  return { kind: 'tokens' };
}

/**
 * Which token positions are actually moving through the stack.
 *
 * During the prologue every prompt position is processed together. From the first generated
 * token onward only the newest position is, because keys and values for everything earlier
 * are already cached. Most explainers get this wrong and re-run the whole sequence per
 * token; it costs one field to get right.
 */
function positionsFor(cycle: number, contextLen: number): number[] {
  if (cycle < 0) return Array.from({ length: contextLen }, (_, i) => i);
  return [contextLen - 1];
}

export function compileRun(run: ScriptedRun, opts: CompileOpts = {}): Timeline {
  const condenseAfter = opts.condenseAfterCycle ?? 1;
  const steps: Step[] = [];
  const cycles: Timeline['cycles'] = [];

  const pushCycle = (cycle: number, phases: PhaseId[], condensed: boolean) => {
    const startIndex = steps.length;
    const context = contextAt(run, cycle);
    const contextLen = context.length;
    const out = cycle >= 0 ? run.outputs[cycle] : undefined;

    for (const phase of phases) {
      const spec = PHASES[phase];
      const ctx: CaptionCtx = {
        run,
        cycle,
        token: out?.token ?? null,
        contextLen,
        blockIndex: FULL_CYCLE.includes(phase) && phase !== 'blocks-repeat' ? 0 : null,
        condensed,
      };
      const focus = spec.focus;
      const focusSet = new Set<string>(focus);
      steps.push({
        key: `${cycle}:${phase}`,
        cycle,
        phase,
        blockIndex: ctx.blockIndex,
        focus,
        // Everything not lit is explicitly pushed back, so the renderer never has to guess.
        dim: ARCH_PART_IDS.filter((id) => !focusSet.has(id)),
        flow: spec.flow,
        positionsActive: positionsFor(cycle, contextLen),
        tokensLit:
          cycle < 0
            ? Array.from({ length: contextLen }, (_, i) => i)
            : phase === 'append' || phase === 'done'
              ? [contextLen]
              : [contextLen - 1],
        caption: PHASE_COPY[phase](ctx),
        panel: panelFor(phase, run, cycle, contextLen),
        poseKey: spec.poseKey,
        durationMs: spec.ms,
        // Attach the run's editorial note to the beat where the choice actually happens.
        note: phase === 'sample' ? out?.note : undefined,
      });
    }

    cycles.push({
      cycle,
      label:
        cycle < 0
          ? 'Prompt'
          : `Token ${cycle + 1} · ${run.outputs[cycle].token.text.trim() || run.outputs[cycle].token.display}`,
      startIndex,
      endIndex: steps.length - 1,
    });
  };

  pushCycle(-1, PROLOGUE, false);
  for (let c = 0; c < run.outputs.length; c++) {
    const condensed = c >= condenseAfter;
    pushCycle(c, condensed ? CONDENSED_CYCLE : FULL_CYCLE, condensed);
  }

  // Closing beat. Belongs to the last cycle's rail entry rather than its own.
  const lastContext = contextAt(run, run.outputs.length).length;
  steps.push({
    key: `${run.outputs.length}:done`,
    cycle: run.outputs.length - 1,
    phase: 'done',
    blockIndex: null,
    focus: PHASES.done.focus,
    dim: ARCH_PART_IDS.filter((id) => !PHASES.done.focus.includes(id)),
    flow: [],
    positionsActive: [],
    tokensLit: Array.from({ length: lastContext }, (_, i) => i),
    caption: PHASE_COPY.done({
      run, cycle: run.outputs.length - 1, token: null,
      contextLen: lastContext, blockIndex: null, condensed: true,
    }),
    panel: { kind: 'tokens' },
    poseKey: 'loop',
    durationMs: PHASES.done.ms,
  });
  if (cycles.length) cycles[cycles.length - 1].endIndex = steps.length - 1;

  return {
    runId: run.id,
    steps,
    byKey: new Map(steps.map((s, i) => [s.key, i])),
    cycles,
    totalMs: steps.reduce((sum, s) => sum + s.durationMs, 0),
    condensed: condenseAfter <= run.outputs.length,
  };
}
