# Traceroute

**Route:** `/traceroute` (public) · **Built:** July 2026 · **Status:** shipped, uncommitted at time of writing

A single-page interactive explainer answering one question: what physically happens between
pressing enter on a cloud language model and the first token coming back.

The name is literal. `traceroute` is a network diagnostic that reports every hop a packet takes
to reach its destination; this page does the same for a prompt.

---

## The premise

The Atlas explains the AI economy in argument form: claims, evidence, confidence, supply-chain
dependencies. Every other public surface is text or a 2D diagram. A reader can follow the entire
debate about compute without ever picturing what compute *is*, where it sits, what it costs to
run, or what happens when it runs.

Traceroute closes that gap as one continuous descent, from a client machine down to a single
piece of silicon and into the arithmetic running on it.

The throughline: **where compute lives → what runs on it → what happens when it runs.**

---

## The journey

Four movements. Each is titled with a **claim, never a noun**. This is deliberate: an earlier
draft used eleven numbered stops with labels like "The hall", which read as a table of contents
rather than an argument. Readers meet a rack as an *object inside a movement*, not as a heading
announcing that they have arrived at a rack.

### I. Local hardware cannot hold the weights

> A frontier model's parameters run to hundreds of gigabytes and need memory bandwidth measured
> in terabytes per second. Consumer hardware has neither, so the client sends an HTTPS request
> instead of running anything.

Two places: the desk, then inside the client machine. The reader goes looking for the model in
their own computer and finds a CPU with a few wide general-purpose cores, 16 to 32 GB of system
memory at roughly 50 GB/s, a consumer GPU that is the right architecture but roughly 100x short,
and a network interface. **The reveal is absence.** The only part that matters is the one that
hands the request to the wire.

### II. The request routes to a datacenter

> Out over fibre to a facility with its own substation, chiller plant, and tens of megawatts of
> contracted power. Inside, rows of cabinets under overhead busway and hot-aisle containment.

Three places: through the wall, the campus, the hall. Two things cross the boundary of a home in
opposite directions, low-voltage service in and the request out on single-mode fibre, and both
are physical. The campus has its own high-voltage intake, chillers sized to the electrical load,
and standby diesel. The hall is rows of identical cabinets: density is the constraint, not floor
area.

This movement carries the **power path**, the piece almost no other explainer shows. A toggle
dims everything non-electrical and lights the service line, meter, busway, PDU, VRMs, and cold
plate in amber, threading grid to chip.

### III. It lands on one accelerator

> One rack, one node, one board. The package holds a compute die and HBM stacks bonded to a
> silicon interposer, under a cold plate that carries off roughly a kilowatt.

Three places: the cabinet, the board, the die. A 19-inch cabinet with eight compute nodes, a
scale-up fabric switch, power up one side and coolant up the other. One board pulled and opened:
twenty-plus impedance-controlled PCB layers, the package, high-bandwidth memory beside the die
where the weights are resident during inference, multiphase regulation delivering hundreds of
amps under a volt. Then the heat spreader lifts off and underneath is a lattice of near-identical
tiles joined to adjacent memory through tens of thousands of microbumps at tens of microns pitch.

### IV. One forward pass per token

> The prompt is tokenised, embedded, and pushed through every transformer block. The output head
> produces logits over the vocabulary, one token is sampled, and the pass repeats with that token
> appended.

Physical scale stops applying. This movement holds the architecture schematic and the inference
walkthrough, and it is **the payoff**: the other three exist to give it a stage.

---

## The architecture schematic

There is no ground truth for what a transformer looks like, so the page invents a spatial
metaphor and says so out loud. `MODEL_SPEC.disclaimer` is rendered, not optional.

**The metaphor:** the residual stream is a vertical shaft. Data enters at the bottom, every block
reads the shaft and writes an adjustment back into it, and the output head sits at the top.
Attention machinery hangs off one side and feed-forward off the other, so the two halves of a
block are legible at a glance. Block 1 is modelled in full at eye level; blocks 2 through 32
recede upward as a repeated lattice, which is honest (they are identical) and cheap (one
`InstancedMesh`).

**Dimensions** are self-consistent and land at roughly 7 billion parameters, chosen to be
representative of an open-weight model of this class and of no specific one:

| | |
|---|---|
| vocabulary | 128,000 |
| d_model | 4,096 |
| layers | 32 |
| heads | 32 (d_head 128) |
| d_ff | 14,336 |
| context | 8,192 |
| embed / unembed | 524M each |
| per block | 184M · ×32 = 5.9B |

23 named parts, each with a role (`io`, `stream`, `weights`, `activation`, `cache`), a plain
caption, and where relevant a parameter count, so a reader can see that most of the weights sit
in the feed-forward projections and the embedding tables.

---

## The inference walkthrough

The centrepiece. A transport with play, pause, step, scrub, 0.5x–2x, a cycle rail, and a "show
every step" toggle.

**Three curated sentences**, each teaching something different:

| Run | Prompt | Teaches |
|---|---|---|
| `capital-of-france` | "The capital of France is" | What near certainty looks like (96.8% on one token) |
| `genuinely-uncertain` | "The best thing about winter is" | What the output head *usually* looks like, and why sampling matters (nothing above 40%) |
| `tokenizer-seams` | "Antidisestablishmentarianism is" | That the vocabulary is fixed and rare words shatter: `Ant · idis · est · ablishment · arian · ism` |

A reader can also **submit their own sentence**. It is tokenised for real, server-side, with the
same encoder the curated runs were authored with.

### The loop, as modelled

The autoregressive loop is **not in the data**. The data holds one `OutputStep` per token the
model produced; a compiler expands that into cycles and emits an explicit `append` beat whose
visual is a loop-back connector from the sampler to the embedding table. Change the sentence and
the loop regenerates.

Beats per full cycle (20): block-enter, attn-norm, attn-qkv, kv-reuse, attn-scores, attn-mix,
attn-out, residual-a, mlp-norm, mlp-up, mlp-act, mlp-down, residual-b, blocks-repeat, block-exit,
head-norm, unembed, softmax, sample, append.

**Three rules keep it watchable and correct:**

1. **Never a step per block.** 32 blocks × 8 phases × 8 tokens is thousands of steps. Block 1 is
   shown in full, then one `blocks-repeat` beat sweeps the stack captioned "blocks 2 through 32
   do exactly the same thing".
2. **Condense from cycle 2 onward.** The reader has seen the machine once. Later cycles emit 7
   beats instead of 20. The toggle recompiles with condensing off.
3. **Model the KV cache.** From cycle 1, only the newest position is processed; keys and values
   for everything earlier are cached. Most explainers get this wrong and re-run the whole
   sequence per token. It costs one field (`positionsActive`) and one phase to get right, and it
   is the difference between a nice animation and one an engineer will not wince at.

Runtime at 1x: 102 to 128 seconds depending on the run.

### Honesty

`ScriptedRun.provenance` is a rendered field with three values:

- `authored`: the token split is real, produced by a byte-pair tokenizer; probabilities and
  attention weights are hand-authored to be representative
- `tokenizer`: the reader's own sentence, really tokenized; the continuation is scripted
- `model`: reserved, nothing produces it yet

The plate renders on every run, always. The tokenizer is `o200k_base`, a byte-pair encoder of the
kind these models use, **not** the exact one behind any particular assistant, and the page says
so.

---

## Writing conventions

These are enforced and were arrived at through several rounds of correction:

- **Never "you" or "your".** Name the actor: the client, the request, the prompt, the model.
  Zero occurrences on the rendered page.
- **No em dashes.** Commas, colons, ` · ` for label separators, `–` for null placeholders.
- **Technical register, plain sentences.** Written for a reader who knows what a GPU is. Neither
  florid ("Quartz, lithography, and forty years of process development end here") nor folksy
  ("Right kind of chip. About 100 times too small"). Where a number is the point, the number is
  there.
- **Section titles are claims, not nouns.**
- **Text on the page is minimal**, about 70 words of headings and ledes. Detail lives on the
  objects, revealed on hover.

---

## How it is built

### Data (pure modules, no three.js, no DB)

```
lib/traceroute/
  types.ts          StopId, SceneId, Pose, Anchor, LookBounds, MaterialKey
  movements.ts      the four movements; maps each to its camera stops
  stops.ts          ten places: camera pose, look bounds, scale label, supply-chain slugs
  props.ts          44 objects: size, position, explode offset, material, lattice, detail
  architecture.ts   MODEL_SPEC, ARCH_PART_IDS (literal union), 23 parts
  run-types.ts      ScriptedRun, TokenRec, Candidate, provenance
  runs/*.ts         three curated runs (generated, do not hand-edit)
  phases.ts         the 24 phases and what each lights up
  compile.ts        compileRun() -> Timeline
  copy.ts           per-phase caption functions
  player.ts         pure reducer: play/pause/step/seek/tick
  camera.ts         poses, easing, look-blend
  geometry.ts       kind + detail -> merged BufferGeometry, contact shadow
  webgl.ts          capability probe, CSS tokens -> THREE.Color
  scene-world.ts    build/paint/dispose the physical scenes    [three.js, module scope]
  scene-silicon.ts  build/paint/dispose the architecture scene [three.js, module scope]
```

### UI

```
app/traceroute/page.tsx                  server, force-dynamic, no maxDuration
app/api/traceroute/tokenize/route.ts     public, bounded, no model call
components/traceroute/
  Traceroute.tsx        the four movements, scroll-spy, drawer owner
  StopRail.tsx          sticky four-item rail
  WorldStage.tsx        canvas per movement, place tabs, explode, power toggle
  Stage.tsx             canvas for the architecture + inference
  InferencePlayer.tsx   picker, transport, token strip, probability bars
  PartsDiagram.tsx      SVG elevation fallback, generated from the same geometry data
  PropDrawer.tsx        click-into detail for props and architecture parts
app/styles/traceroute.css                scoped to .tr
```

### Load-bearing decisions

- **`ArchPartId` is a literal union, not `string`.** A compiled step referencing a part that does
  not exist is a TypeScript error, not a silently missing highlight.
- **Every frame is a pure function of `(timeline, index, progress)`.** No accumulated animation
  state. Scrubbing to step 47 produces a picture identical to playing there. This is the property
  the whole feature rests on.
- **React re-renders once per step, not per frame.** Structural state is React state; sub-step
  progress is a ref read only inside animation callbacks.
- **All scene mutation lives in module-scope functions** in `lib/`, because the React Compiler
  lint rules (`react-hooks/refs`, `set-state-in-effect`, `immutability`, `purity`) are errors
  with no opt-out in this repo.
- **Geometry is described in data, never modelled.** Every object is a primitive plus optional
  detail features (fins, slots, layers, fan, screen, ports), merged into one BufferGeometry.
  No external assets, no pipeline.
- **The palette is read from CSS design tokens** at runtime and recoloured in place on a
  `data-theme` flip, so light and dark work with no second definition.
- **Nothing calls a model.** The walkthrough is scripted and the tokenizer endpoint is pure
  string processing, which preserves the app's property that no public surface can trigger an
  Anthropic call.
- **Presence, not a game.** Perspective camera at 45 to 50 degrees, guided framing with free look,
  and a hard exclusion list: no post-processing, no bloom, no depth of field, no particles, no
  locomotion, no shadow maps. Flat Lambert fills with wireframe outlines. The outline is the
  drawing; the fill is the shade.
- **Zoom is off until the reader clicks in**, so a full-bleed canvas never steals page scroll.

### Integrations

- Object captions link to `/concepts/[slug]`. Ten transformer-internals concepts were seeded for
  this (`residual-stream`, `layer-norm`, `query-key-value`, `kv-cache`, `feed-forward`,
  `positional-encoding`, `logits`, `softmax`, `vocabulary`, `sampling`).
- Physical stops resolve supply-chain slugs against `lib/supply-chain/map.ts` and read the live
  DB overlay via `getSupplyChain(personal)`, so risk level and signal counts are current.
- Validated at module load: a stop naming a slug that no longer exists throws at startup.

### Fallbacks

The SVG elevations in `PartsDiagram` are generated from the same geometry data and serve as the
no-WebGL, narrow-screen, and pre-hydration rendering. The DOM walkthrough is server-rendered and
is the complete explanation on its own; three.js (81KB gzipped) only loads where it can be used.

---

## Tests

```
node scripts/test-traceroute.mjs           6,396 checks: compiler + player
node scripts/test-traceroute-geometry.mjs  44 props: geometry builds, no NaN, detail adds mass
node scripts/author-run.mjs                regenerates the curated runs (real tokenization)
```

The player test asserts the property that matters: playing to step N produces the same frame as
scrubbing to it. The geometry test caught a real bug where all 20 detail features were silently
failing to merge and rendering as bare boxes.

---

## Not built

- **Travel between stops.** Switching place is a tab that rebuilds the scene. There are no
  authored camera paths and no threshold transitions between the physical and silicon scenes.
  Deliberately dropped.
- **Deep links.** No `?stop=` or `&step=`, so a specific moment is not shareable.
- **Editable copy.** `lib/content.ts` `KEY_RE` does not admit a `traceroute.` namespace, so none
  of the prose is admin-editable the way the About pages are.
- **Real model internals.** Attention weights and probabilities are authored. The seam for
  upgrading is `RunSource`: anything producing a `ScriptedRun` drops in without touching the
  compiler, the player, or either scene.
