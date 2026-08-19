// Stop 08: the shape of the thing being computed.
//
// There is no ground truth here. A transformer has no native spatial form, so this file
// invents one and says so out loud: MODEL_SPEC.disclaimer is rendered in the UI, not
// optional, and the stop's own beat tells the reader the physical scale has stopped
// applying. Inventing a metaphor is fine. Presenting an invention as a photograph is not.
//
// The metaphor: the residual stream is a vertical shaft the reader stands beside. Data
// enters at the bottom, every block reads from the shaft and writes back to it, and the
// output head sits at the top. Attention machinery hangs off one side of the shaft and the
// feed-forward machinery off the other, so the two halves of a block are legible at a
// glance. Block 1 is modelled in full at eye level; blocks 2 through 32 recede upward as a
// repeated lattice, which is honest (they are identical) and cheap (one InstancedMesh).
//
// The dimensions below are self-consistent and land at roughly 7 billion parameters:
//   embed        128000 x 4096                        =  524M
//   per block    3(4096^2) + 4096^2 + 2(4096 x 14336) =  184M   x32 = 5.9B
//   unembed      128000 x 4096                        =  524M
// Chosen to be representative of an open-weight model of this class, and of no specific one.

import type { Anchor } from './types';

export const MODEL_SPEC = {
  label: 'A decoder-only transformer',
  dims: {
    vocab: 128_000,
    dModel: 4096,
    nLayers: 32,
    nHeads: 32,
    dHead: 128,
    dFF: 14_336,
    ctx: 8192,
  },
  totalParams: 7_000_000_000,
  disclaimer:
    'Illustrative proportions, representative of an open-weight model of this class. Not any specific released model, and not drawn to any physical scale.',
} as const;

/**
 * The shared vocabulary between the geometry and the inference script.
 *
 * This being a literal union rather than `string` is load bearing: a compiled step that
 * references a part which does not exist becomes a TypeScript error rather than a silently
 * missing highlight. It is what lets the inference timeline be authored and tested against
 * placeholder geometry and still be correct when the real geometry lands.
 */
export const ARCH_PART_IDS = [
  'io.prompt',
  'tok.split',
  'emb.table',
  'emb.vectors',
  'pos.encode',
  'res.stream',
  'attn.norm',
  'attn.qkv',
  'attn.kcache',
  'attn.vcache',
  'attn.scores',
  'attn.mix',
  'attn.out',
  'mlp.norm',
  'mlp.up',
  'mlp.act',
  'mlp.down',
  'head.norm',
  'head.unembed',
  'head.logits',
  'head.softmax',
  'head.sample',
  'io.output',
] as const;

export type ArchPartId = (typeof ARCH_PART_IDS)[number];

export type ArchRole = 'io' | 'stream' | 'weights' | 'activation' | 'cache';

interface ArchPart {
  id: ArchPartId;
  label: string;
  /** One or two sentences. No em dashes. */
  blurb: string;
  role: ArchRole;
  at: [number, number, number];
  size: [number, number, number];
  /** Radial push for the explode control. */
  explodeTo: [number, number, number];
  anchor?: Anchor;
  /** Parameters held by this part, so the reader can see where the weights actually are. */
  params?: number;
}

const { dModel, dFF, vocab } = MODEL_SPEC.dims;

export const ARCH_PARTS: ArchPart[] = [
  // ---- input
  {
    id: 'io.prompt', label: 'The prompt', role: 'io',
    blurb: 'Still plain text at this point. The last stage that is human readable.',
    at: [0, -1.6, 0], size: [6, 0.5, 2], explodeTo: [0, -2, 0],
    anchor: { conceptSlug: 'token' },
  },
  {
    id: 'tok.split', label: 'The tokenizer', role: 'io',
    blurb: 'Splits the text into pieces from a fixed vocabulary. Common words survive whole, rarer ones shatter into fragments.',
    at: [0, -0.2, 0], size: [6, 0.5, 2], explodeTo: [0, -1, 0],
    anchor: { conceptSlug: 'token' },
  },
  {
    id: 'emb.table', label: 'The embedding table', role: 'weights',
    blurb: 'One learned vector per vocabulary entry. Looking up a token is a row lookup, nothing more.',
    at: [-5, 1.2, 0], size: [2.6, 2.6, 2.6], explodeTo: [-4, 0, 0],
    params: vocab * dModel, anchor: { conceptSlug: 'embedding' },
  },
  {
    id: 'emb.vectors', label: 'Token vectors', role: 'activation',
    blurb: 'Each token is now a list of a few thousand numbers. From here the model never sees words again.',
    at: [0, 1.2, 0], size: [5, 0.5, 2], explodeTo: [0, 0, 3],
    anchor: { conceptSlug: 'embedding' },
  },
  {
    id: 'pos.encode', label: 'Position', role: 'activation',
    blurb: 'Order is added to the vectors. Without this the model would see a bag of tokens rather than a sentence.',
    at: [3.8, 1.8, 0], size: [2, 0.5, 2], explodeTo: [3, 0, 0],
    anchor: { conceptSlug: 'positional-encoding' },
  },

  // ---- the shaft
  {
    id: 'res.stream', label: 'The residual stream', role: 'stream',
    blurb: 'The running representation. Every block reads it, computes an adjustment, and adds that adjustment back.',
    at: [0, 7.5, 0], size: [1.3, 13, 1.3], explodeTo: [0, 0, 0],
    anchor: { conceptSlug: 'residual-stream' },
  },

  // ---- block 1, attention half (-X)
  {
    id: 'attn.norm', label: 'Layer norm', role: 'activation',
    blurb: 'Rescales the stream before the block reads it. Keeps the numbers in a range the rest of the arithmetic can handle.',
    at: [0, 3, 0], size: [2.2, 0.4, 2.2], explodeTo: [0, 0, 2.5],
    anchor: { conceptSlug: 'layer-norm' },
  },
  {
    id: 'attn.qkv', label: 'Query, key, value', role: 'weights',
    blurb: 'Three learned projections of the same vector. Roughly: what am I looking for, what do I offer, and what do I pass on.',
    at: [-3.4, 3.9, 0], size: [2.4, 1.1, 2.4], explodeTo: [-3.5, 0, 0],
    params: 3 * dModel * dModel, anchor: { conceptSlug: 'query-key-value' },
  },
  {
    id: 'attn.kcache', label: 'Key cache', role: 'cache',
    blurb: 'Keys for every earlier token, computed once and kept. This is why generating the tenth token costs no more than the second.',
    at: [-6.1, 4.6, -1.5], size: [1.6, 1.6, 1.6], explodeTo: [-3, 0, -2],
    anchor: { conceptSlug: 'kv-cache' },
  },
  {
    id: 'attn.vcache', label: 'Value cache', role: 'cache',
    blurb: 'The matching values, also kept. Together with the key cache it is the model’s short-term memory of this conversation.',
    at: [-6.1, 4.6, 1.5], size: [1.6, 1.6, 1.6], explodeTo: [-3, 0, 2],
    anchor: { conceptSlug: 'kv-cache' },
  },
  {
    id: 'attn.scores', label: 'Attention scores', role: 'activation',
    blurb: 'Every position scored against every earlier position. High scores mean this token is reading heavily from that one.',
    at: [-3.4, 5.3, 0], size: [2.8, 0.6, 2.8], explodeTo: [-3, 1, 0],
    anchor: { conceptSlug: 'attention-mechanism' },
  },
  {
    id: 'attn.mix', label: 'Weighted sum', role: 'activation',
    blurb: 'The values are mixed in proportion to those scores. Information moves sideways between positions here, and nowhere else in the block.',
    at: [-1.9, 6, 0], size: [2, 0.5, 2], explodeTo: [-2, 1, 0],
    anchor: { conceptSlug: 'attention-mechanism' },
  },
  {
    id: 'attn.out', label: 'Attention output', role: 'weights',
    blurb: 'One more projection, then the result is added back into the stream. The block has done its reading.',
    at: [0, 6.5, 0], size: [2.2, 0.5, 2.2], explodeTo: [0, 0, -2.5],
    params: dModel * dModel,
  },

  // ---- block 1, feed-forward half (+X)
  {
    id: 'mlp.norm', label: 'Layer norm', role: 'activation',
    blurb: 'Rescales again before the second half of the block.',
    at: [0, 7.1, 0], size: [2.2, 0.4, 2.2], explodeTo: [0, 0, 2.5],
    anchor: { conceptSlug: 'layer-norm' },
  },
  {
    id: 'mlp.up', label: 'Expand', role: 'weights',
    blurb: 'Projects each vector up to several times its width. Most of a model’s parameters live in this step and its partner below.',
    at: [3.4, 7.6, 0], size: [2.6, 1.2, 2.6], explodeTo: [3.5, 0, 0],
    params: dModel * dFF, anchor: { conceptSlug: 'feed-forward' },
  },
  {
    id: 'mlp.act', label: 'Nonlinearity', role: 'activation',
    blurb: 'A simple elementwise function. Without it the whole stack would collapse into a single matrix multiply.',
    at: [5.2, 8.2, 0], size: [1.4, 0.5, 1.4], explodeTo: [3, 1, 0],
    anchor: { conceptSlug: 'feed-forward' },
  },
  {
    id: 'mlp.down', label: 'Contract', role: 'weights',
    blurb: 'Projects back down to the stream’s width and adds the result in. The block is finished.',
    at: [3.4, 8.8, 0], size: [2.6, 1.2, 2.6], explodeTo: [3.5, 1, 0],
    params: dFF * dModel, anchor: { conceptSlug: 'feed-forward' },
  },

  // ---- the output head
  {
    id: 'head.norm', label: 'Final layer norm', role: 'activation',
    blurb: 'One last rescale after every block has had its turn.',
    at: [0, 12.8, 0], size: [2.2, 0.4, 2.2], explodeTo: [0, 0, 2.5],
    anchor: { conceptSlug: 'layer-norm' },
  },
  {
    id: 'head.unembed', label: 'The unembedding', role: 'weights',
    blurb: 'Projects the final vector back out to one number per vocabulary entry. Often the same weights as the embedding table, used in reverse.',
    at: [-4.2, 13.6, 0], size: [3, 2, 3], explodeTo: [-4, 0, 0],
    params: vocab * dModel, anchor: { conceptSlug: 'logits' },
  },
  {
    id: 'head.logits', label: 'Logits', role: 'activation',
    blurb: 'One raw score for every token the model knows. Around 128,000 numbers, most of them very low.',
    at: [0, 14.5, 0], size: [4.2, 0.4, 2], explodeTo: [0, 0, 3],
    anchor: { conceptSlug: 'logits' },
  },
  {
    id: 'head.softmax', label: 'Softmax', role: 'activation',
    blurb: 'Turns those scores into probabilities that sum to one. Now the model has an opinion about what comes next.',
    at: [0, 15.3, 0], size: [4.2, 0.4, 2], explodeTo: [0, 0, 3],
    anchor: { conceptSlug: 'softmax' },
  },
  {
    id: 'head.sample', label: 'Sampling', role: 'io',
    blurb: 'One token is drawn from that distribution. Always taking the most likely option produces flat, repetitive text, so usually it does not.',
    at: [0, 16.1, 0], size: [2.2, 0.6, 2.2], explodeTo: [0, 1, 0],
    anchor: { conceptSlug: 'sampling' },
  },
  {
    id: 'io.output', label: 'The next token', role: 'io',
    blurb: 'Appended to the context, and the whole stack runs again. That loop is autoregressive decoding.',
    at: [0, 17.2, 0], size: [6, 0.5, 2], explodeTo: [0, 2, 0],
    anchor: { conceptSlug: 'inference' },
  },
];

export const ARCH_PART_BY_ID: ReadonlyMap<ArchPartId, ArchPart> = new Map(
  ARCH_PARTS.map((p) => [p.id, p])
);

/** Where the repeated blocks 2..N are drawn, above the modelled block. */
export const BLOCK_LATTICE = {
  from: 9.6,
  to: 12.2,
  count: MODEL_SPEC.dims.nLayers - 1,
} as const;

if (process.env.NODE_ENV !== 'production') {
  const seen = new Set<string>();
  for (const p of ARCH_PARTS) {
    if (seen.has(p.id)) throw new Error(`traceroute/architecture: duplicate part id "${p.id}"`);
    seen.add(p.id);
  }
  const missing = ARCH_PART_IDS.filter((id) => !seen.has(id));
  if (missing.length) {
    throw new Error(`traceroute/architecture: ARCH_PART_IDS without a part: ${missing.join(', ')}`);
  }
}
