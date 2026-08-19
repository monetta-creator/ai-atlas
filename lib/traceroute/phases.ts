// The phase table: what each beat of the inference loop lights up.
//
// Kept separate from ./compile so the compiler stays thin and this stays readable as a
// single source of truth for "which parts of the architecture does this step concern".
// Because `focus` and `flow` are typed as ArchPartId, a typo here is a compile error rather
// than a silently missing highlight at runtime.
//
// `poseKey` names a camera position rather than carrying coordinates, so this module stays
// free of geometry and the camera can be retuned without recompiling any timeline.

import type { ArchPartId } from './architecture';

export type PhaseId =
  | 'tokenize'
  | 'embed'
  | 'position'
  | 'block-enter'
  | 'attn-norm'
  | 'attn-qkv'
  | 'kv-reuse'
  | 'attn-scores'
  | 'attn-mix'
  | 'attn-out'
  | 'residual-a'
  | 'mlp-norm'
  | 'mlp-up'
  | 'mlp-act'
  | 'mlp-down'
  | 'residual-b'
  | 'blocks-repeat'
  | 'block-exit'
  | 'head-norm'
  | 'unembed'
  | 'softmax'
  | 'sample'
  | 'append'
  | 'done';

export type FlowKind = 'data' | 'weights' | 'loop';
export type PoseKey = 'input' | 'block' | 'attention' | 'mlp' | 'stack' | 'head' | 'loop';

export interface PhaseSpec {
  /** Parts lit at full strength this step. */
  focus: ArchPartId[];
  /** Connectors that pulse this step. */
  flow: { from: ArchPartId; to: ArchPartId; kind: FlowKind }[];
  poseKey: PoseKey;
  /** Base duration at rate 1. */
  ms: number;
  /** Which panel the DOM should show alongside. */
  panel?: 'topk' | 'attention' | 'dims' | 'tokens';
}

const f = (from: ArchPartId, to: ArchPartId, kind: FlowKind = 'data') => ({ from, to, kind });

export const PHASES: Record<PhaseId, PhaseSpec> = {
  tokenize: {
    focus: ['io.prompt', 'tok.split'],
    flow: [f('io.prompt', 'tok.split')],
    poseKey: 'input', ms: 2200, panel: 'tokens',
  },
  embed: {
    focus: ['tok.split', 'emb.table', 'emb.vectors'],
    flow: [f('tok.split', 'emb.vectors'), f('emb.table', 'emb.vectors', 'weights')],
    poseKey: 'input', ms: 1600, panel: 'dims',
  },
  position: {
    focus: ['pos.encode', 'emb.vectors', 'res.stream'],
    flow: [f('pos.encode', 'emb.vectors'), f('emb.vectors', 'res.stream')],
    poseKey: 'input', ms: 1200,
  },

  'block-enter': {
    focus: ['res.stream'],
    flow: [], poseKey: 'block', ms: 1100,
  },
  'attn-norm': {
    focus: ['res.stream', 'attn.norm'],
    flow: [f('res.stream', 'attn.norm')],
    poseKey: 'attention', ms: 900,
  },
  'attn-qkv': {
    focus: ['attn.norm', 'attn.qkv'],
    flow: [f('attn.norm', 'attn.qkv'), f('attn.qkv', 'attn.qkv', 'weights')],
    poseKey: 'attention', ms: 1600, panel: 'dims',
  },
  'kv-reuse': {
    focus: ['attn.qkv', 'attn.kcache', 'attn.vcache'],
    flow: [f('attn.qkv', 'attn.kcache'), f('attn.qkv', 'attn.vcache')],
    poseKey: 'attention', ms: 1800, panel: 'tokens',
  },
  'attn-scores': {
    focus: ['attn.qkv', 'attn.kcache', 'attn.scores'],
    flow: [f('attn.kcache', 'attn.scores'), f('attn.qkv', 'attn.scores')],
    poseKey: 'attention', ms: 1800, panel: 'attention',
  },
  'attn-mix': {
    focus: ['attn.scores', 'attn.vcache', 'attn.mix'],
    flow: [f('attn.scores', 'attn.mix'), f('attn.vcache', 'attn.mix')],
    poseKey: 'attention', ms: 1700, panel: 'attention',
  },
  'attn-out': {
    focus: ['attn.mix', 'attn.out'],
    flow: [f('attn.mix', 'attn.out')],
    poseKey: 'attention', ms: 1000,
  },
  'residual-a': {
    focus: ['attn.out', 'res.stream'],
    flow: [f('attn.out', 'res.stream')],
    poseKey: 'block', ms: 1200,
  },
  'mlp-norm': {
    focus: ['res.stream', 'mlp.norm'],
    flow: [f('res.stream', 'mlp.norm')],
    poseKey: 'mlp', ms: 900,
  },
  'mlp-up': {
    focus: ['mlp.norm', 'mlp.up'],
    flow: [f('mlp.norm', 'mlp.up'), f('mlp.up', 'mlp.up', 'weights')],
    poseKey: 'mlp', ms: 1500, panel: 'dims',
  },
  'mlp-act': {
    focus: ['mlp.up', 'mlp.act'],
    flow: [f('mlp.up', 'mlp.act')],
    poseKey: 'mlp', ms: 1100,
  },
  'mlp-down': {
    focus: ['mlp.act', 'mlp.down'],
    flow: [f('mlp.act', 'mlp.down'), f('mlp.down', 'mlp.down', 'weights')],
    poseKey: 'mlp', ms: 1100,
  },
  'residual-b': {
    focus: ['mlp.down', 'res.stream'],
    flow: [f('mlp.down', 'res.stream')],
    poseKey: 'block', ms: 1100,
  },
  'blocks-repeat': {
    focus: ['res.stream'],
    flow: [], poseKey: 'stack', ms: 2200,
  },
  'block-exit': {
    focus: ['res.stream'],
    flow: [], poseKey: 'stack', ms: 900,
  },
  'head-norm': {
    focus: ['res.stream', 'head.norm'],
    flow: [f('res.stream', 'head.norm')],
    poseKey: 'head', ms: 900,
  },
  unembed: {
    focus: ['head.norm', 'head.unembed', 'head.logits'],
    flow: [f('head.norm', 'head.logits'), f('head.unembed', 'head.logits', 'weights')],
    poseKey: 'head', ms: 1600, panel: 'dims',
  },
  softmax: {
    focus: ['head.logits', 'head.softmax'],
    flow: [f('head.logits', 'head.softmax')],
    poseKey: 'head', ms: 1800, panel: 'topk',
  },
  sample: {
    focus: ['head.softmax', 'head.sample'],
    flow: [f('head.softmax', 'head.sample')],
    poseKey: 'head', ms: 2200, panel: 'topk',
  },
  append: {
    focus: ['head.sample', 'io.output', 'emb.table'],
    flow: [f('head.sample', 'io.output'), f('io.output', 'emb.table', 'loop')],
    poseKey: 'loop', ms: 1900, panel: 'tokens',
  },
  done: {
    focus: ['io.output'],
    flow: [], poseKey: 'loop', ms: 3000, panel: 'tokens',
  },
};

/** The prompt prologue: everything that happens once, before the loop starts. */
export const PROLOGUE: PhaseId[] = ['tokenize', 'embed', 'position'];

/** A full pass, shown for the first generated token so the reader sees the whole machine. */
export const FULL_CYCLE: PhaseId[] = [
  'block-enter',
  'attn-norm',
  'attn-qkv',
  'kv-reuse',
  'attn-scores',
  'attn-mix',
  'attn-out',
  'residual-a',
  'mlp-norm',
  'mlp-up',
  'mlp-act',
  'mlp-down',
  'residual-b',
  'blocks-repeat',
  'block-exit',
  'head-norm',
  'unembed',
  'softmax',
  'sample',
  'append',
];

/**
 * Every cycle after the first. The reader has seen the machine once; repeating all twenty
 * beats per token is what turns an explanation into a slog. The toolbar's "show every step"
 * toggle recompiles with condensing switched off.
 */
export const CONDENSED_CYCLE: PhaseId[] = [
  'embed',
  'kv-reuse',
  'blocks-repeat',
  'unembed',
  'softmax',
  'sample',
  'append',
];
