import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Seed for /concepts, the semantic scaffold (migration 0017). Idempotent:
// upserts on slug WITHOUT clobbering prose (the create/edit form is the source
// of truth once a concept exists, same philosophy as seed.mjs), and edges insert
// with `on conflict do nothing`. Separate from db:seed on purpose: the main seed
// resets every confidence to 0.50, so it must never be re-run casually just to
// load concepts. Run with: npm run db:seed:concepts
//
// Claim wiring is intentionally left empty, the admin wires concepts to claims
// by hand (or via the AI suggestions) in the authoring form.

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------- concepts
// status: most terms are settled in definition; 'emergent-capability' and
// 'alignment' are genuinely contested, the dispute is over what the word means,
// not just whether some claim about it is true.
const concepts = [
  {
    slug: 'token',
    name: 'Token',
    status: 'settled',
    short: 'The basic unit of text a language model reads and writes, roughly a word fragment.',
    explanation: `A language model never sees words or characters the way a person does. Text is first split into tokens: a common word may be one token, a rarer word several pieces, on average about three to four English characters each. Everything downstream is measured and priced in tokens: context windows, API bills, generation speed.

When a model "writes," it is choosing one next token at a time from a probability distribution over its whole vocabulary. The tokenizer's choices quietly shape behavior, arithmetic, spelling, and non-English text are all harder where the unit boundaries fall awkwardly.`,
    prereqs: [],
  },
  {
    slug: 'neural-network',
    name: 'Neural network',
    status: 'settled',
    short: 'A function built from layers of simple weighted units, tuned by training on data rather than programmed by hand.',
    explanation: `Nobody writes the rules a neural network follows. Instead, a network is a stack of layers of simple numeric operations whose weights start random and are adjusted, example by example, until its outputs improve, a process called training. The behavior is learned, not coded, which is why nobody can point to the line of code where a model "knows" something.

Modern AI models are neural networks at extreme scale. Their learned, statistical character is the root of both their power (capabilities no one explicitly programmed) and their characteristic failures (confident errors no one explicitly programmed either).`,
    prereqs: [],
  },
  {
    slug: 'compute',
    name: 'Compute',
    status: 'settled',
    short: 'The raw processing work (chips, time, and energy) consumed to train or run a model.',
    explanation: `Compute is the physical input of the AI era, usually measured in floating-point operations (FLOPs). Training a frontier model concentrates enormous compute in clusters of specialized accelerators for months; serving it consumes compute again on every request.

Much of the AI-economy debate is really a debate about compute: who can buy it, what it costs, whether the build-out of chips, power, and data centers that supplies it is justified by returns, and whether controlling its flow (export controls) can steer the trajectory.`,
    prereqs: [],
  },
  {
    slug: 'parameters',
    name: 'Parameters',
    status: 'settled',
    short: "The learned numeric weights inside a neural network; 'model size' counts them.",
    explanation: `Parameters are the numbers training actually adjusts, the weights on the connections inside a neural network. A "175-billion-parameter model" is a network with that many learned values. Everything the model has learned is encoded, opaquely, in them.

Parameter count is the standard shorthand for model size and capacity: more parameters can store more, but cost proportionally more compute to train and to run. It is a useful but rough proxy, architecture, data quality, and training technique move capability at the same parameter count.`,
    prereqs: ['neural-network'],
  },
  {
    slug: 'embedding',
    name: 'Embedding',
    status: 'settled',
    short: "A list of numbers representing a token's or document's meaning as a position in space.",
    explanation: `An embedding turns a discrete symbol, a token, a sentence, a whole document, into a vector of numbers placed so that similar meanings sit near each other. "Dog" lands close to "puppy" and far from "invoice." This is the representation models actually compute with; text goes in, geometry happens, text comes out.

Embeddings also stand alone as infrastructure: semantic search, recommendation, clustering, and the retrieval step in RAG all work by comparing embedding distances rather than matching keywords.`,
    prereqs: ['token'],
  },
  {
    slug: 'inference',
    name: 'Inference',
    status: 'settled',
    short: "Running a trained model to produce output: the 'using it' phase, as opposed to training.",
    explanation: `Inference is what happens every time someone uses a model: the trained network runs forward on an input and produces output, one token at a time. No learning occurs; the weights are frozen.

The distinction from training matters economically. Training is a lumpy, capex-like cost paid up front; inference is the recurring cost of serving every request, forever. Falling inference cost per token is the load-bearing fact in most optimistic unit-economics arguments, and how far it falls, and who captures the savings, is a live dispute.`,
    prereqs: ['neural-network', 'token'],
  },
  {
    slug: 'attention-mechanism',
    name: 'Attention mechanism',
    status: 'settled',
    short: 'The operation that lets a model weigh every token against every other to decide what matters in context.',
    explanation: `Attention lets each position in a sequence look at every other position and decide how much each one matters for interpreting it, resolving what "it" refers to, connecting a question to the relevant clause three paragraphs back. The model learns these weighting patterns; nobody specifies them.

Attention is the core operation of the transformer, and its cost grows with how much text is being related to how much text, the fundamental reason context windows are finite and long ones are expensive.`,
    prereqs: ['embedding'],
  },
  {
    slug: 'pre-training',
    name: 'Pre-training',
    status: 'settled',
    short: 'The compute-heavy first phase where a model learns general capabilities by predicting tokens across vast text corpora.',
    explanation: `Pre-training is the giant first pass: the model reads an enormous corpus and is trained on one simple objective, predict the next token. Done at sufficient scale, that objective forces the network to absorb grammar, facts, idioms, code, and reasoning patterns, because they all help prediction.

It is where almost all the compute (and money) goes, and it produces a raw "base model": broadly capable but unsteered. Pre-training is the phase scaling laws describe, and the phase people mean when they say a model "cost hundreds of millions to train."`,
    prereqs: ['parameters', 'token', 'compute'],
  },
  {
    slug: 'context-window',
    name: 'Context window',
    status: 'settled',
    short: 'The maximum amount of text, measured in tokens, a model can take into account at once.',
    explanation: `The context window is the model's working memory: instructions, documents, and the conversation so far must all fit inside it, and anything outside it simply does not exist for the model. It is measured in tokens because that is what the model reads.

Window sizes have grown from a few thousand tokens to millions, but bigger windows cost more compute per call (attention relates everything to everything), and models use the middle of very long contexts less reliably than the edges. The window's limits are why retrieval techniques like RAG exist.`,
    prereqs: ['token', 'attention-mechanism'],
  },
  {
    slug: 'transformer',
    name: 'Transformer',
    status: 'settled',
    short: 'The neural-network architecture, built around attention, that underlies virtually all modern AI models.',
    explanation: `The transformer (introduced in 2017's "Attention Is All You Need") arranges attention and standard network layers so that a whole sequence can be processed in parallel rather than word by word. That parallelism is what let training scale onto huge GPU clusters, and that scalability, more than any single insight, opened the current era.

Nearly every prominent model, GPT ("generative pre-trained transformer"), Claude, Gemini, Llama, is a transformer. When people debate whether progress requires "a new architecture," the transformer is the incumbent they mean.`,
    prereqs: ['attention-mechanism', 'embedding'],
  },
  {
    slug: 'foundation-model',
    name: 'Foundation model',
    status: 'settled',
    short: 'A single large pre-trained model that serves as a general-purpose base for many downstream uses.',
    explanation: `Older AI built one model per task. A foundation model inverts that: one very large pre-trained model is adapted, by prompting, fine-tuning, or tool wiring, to thousands of tasks it was never specifically built for. "Frontier model" means a foundation model at the current capability edge.

The industrial structure of the field follows from this idea: a few labs spend enormously to train general-purpose bases, and an application layer builds on top. Whether value accrues to the foundation layer or the application layer is one of the Atlas's central economic questions.`,
    prereqs: ['transformer', 'pre-training'],
  },
  {
    slug: 'scaling-law',
    name: 'Scaling law',
    status: 'settled',
    short: 'The empirical regularity that model performance improves predictably as compute, data, and parameters grow.',
    explanation: `Scaling laws are measured curves, not theory: across many orders of magnitude, a model's loss falls as a smooth, predictable function of how much compute, data, and parameters go in. Their discovery turned training-run budgeting from a gamble into something like engineering, and underwrote the multi-billion-dollar bet that bigger would keep being better.

The definition is settled; the extrapolation is not. Whether the curves are bending, and whether new axes like inference-time compute reset them, is precisely the capability question the Argument Map tracks. A scaling law is an observed regularity, not a guarantee.`,
    prereqs: ['pre-training', 'parameters', 'compute'],
  },
  {
    slug: 'fine-tuning',
    name: 'Fine-tuning',
    status: 'settled',
    short: 'Further training of a pre-trained model on a narrower dataset to specialize or steer its behavior.',
    explanation: `Fine-tuning takes a finished base model and continues training briefly on targeted data, examples of following instructions, a company's domain documents, a desired style. It is cheap relative to pre-training because the heavy general learning is already done.

It is the step that turns a raw next-token predictor into a usable product, and the standard lever for specialization. When a vendor offers "a model tuned on your data," fine-tuning is usually what is meant.`,
    prereqs: ['foundation-model'],
  },
  {
    slug: 'rlhf',
    name: 'RLHF',
    status: 'settled',
    short: 'Reinforcement learning from human feedback: tuning a model toward outputs people rate highly.',
    explanation: `RLHF closes the loop with human judgment: people compare pairs of model outputs, a reward model learns to predict those preferences, and the language model is then optimized against that learned reward. It is the technique that turned raw base models into helpful, conversational assistants.

It is also the main practical alignment tool in production today, with a known caveat baked into its design: it optimizes for what evaluators approve of, which is not the same thing as what is true or what is good. Models can learn to be agreeable rather than accurate.`,
    prereqs: ['fine-tuning'],
  },
  {
    slug: 'rag',
    name: 'RAG (retrieval-augmented generation)',
    status: 'settled',
    short: 'Pairing a model with a search step that retrieves relevant documents into its context before it answers.',
    explanation: `A model's weights are frozen at training time and its context window is finite, so it cannot know yesterday's news or a company's private files. RAG bolts on a retrieval step: the question is used to fetch relevant documents, typically by embedding similarity, and those documents are placed into the context window before the model answers.

It is the dominant enterprise pattern for grounding models in current or proprietary knowledge, cheaper and faster to update than fine-tuning. It narrows hallucination by giving the model the right material, but does not eliminate it, the model can still misread or override what it retrieved.`,
    prereqs: ['foundation-model', 'embedding', 'context-window'],
  },
  {
    slug: 'hallucination',
    name: 'Hallucination',
    status: 'settled',
    short: 'Confidently produced output that is fluent but factually wrong or fabricated.',
    explanation: `A language model generates plausible next tokens; it does not consult a store of verified facts. Fabrication, invented citations, confident wrong answers, plausible nonexistent details, is therefore a failure mode of normal operation, not a malfunction. The fluency is the trap: errors arrive in the same confident voice as truths.

The term itself draws criticism (some prefer "confabulation"; some argue it anthropomorphizes), but the phenomenon it names is well established. It sits at the center of the reliability question: how much human oversight can be removed from a system that can fabricate?`,
    prereqs: ['inference', 'foundation-model'],
  },
  {
    slug: 'benchmark',
    name: 'Benchmark',
    status: 'settled',
    short: 'A standardized test set used to score and compare model capabilities.',
    explanation: `Benchmarks are the field's exams, fixed question sets (knowledge, math, coding, reasoning) on which models are scored and compared. Headlines, marketing, and a surprising amount of capital allocation key off them.

Their weaknesses are as load-bearing as their scores: test questions leak into training data (contamination), labs tune toward the tests, and saturated benchmarks stop discriminating. Whether benchmark gains still track real economic usefulness is one of the sharpest live disputes on the capability question.`,
    prereqs: ['foundation-model', 'inference'],
  },
  {
    slug: 'tool-use',
    name: 'Tool use',
    status: 'settled',
    short: 'A model invoking external functions (search, code execution, APIs) instead of answering from its weights alone.',
    explanation: `In tool use, the model emits a structured call ("search for X", "run this code", "query this database"), the surrounding system executes it, and the result is placed back into the model's context to continue from. The model stops being a closed text predictor and starts acting on external systems.

Tool use is what extends models past their frozen knowledge and unreliable arithmetic, and it is the substrate agents are built on, each tool is a capability the model can decide to reach for.`,
    prereqs: ['foundation-model'],
  },
  {
    slug: 'agent',
    name: 'Agent',
    status: 'settled',
    short: 'A system that runs a model in a loop: planning, calling tools, and reacting to results to pursue a goal.',
    explanation: `An agent wraps a model in a loop: given a goal, it plans, takes an action (usually a tool call), observes the result, and decides what to do next, across many steps without a human between them. That loop is the difference between answering a question and completing a task.

The catch is compounding reliability: a step that succeeds 99% of the time fails alarmingly often across a fifty-step chain. Much of the labor-displacement and valuation debate is really a debate about whether agents reach unsupervised reliability in high-stakes work, which is why "agents" appear all over the Argument Map's tests.`,
    prereqs: ['foundation-model', 'tool-use'],
  },
  {
    slug: 'emergent-capability',
    name: 'Emergent capability',
    status: 'contested',
    short: 'An ability that appears in larger models without being present, or predictable, in smaller ones.',
    explanation: `The claim: as models scale, some abilities, multi-step arithmetic, certain kinds of reasoning, seem to appear abruptly at a size threshold rather than improving smoothly, making the next scale-up's capabilities hard to predict.

The dispute is about whether that abruptness is real. Influential work argues many "emergent" jumps are artifacts of all-or-nothing metrics: the underlying competence improves smoothly, but the score snaps from zero to passing. The definition itself is contested, and the stakes are large either way, if emergence is real and unpredictable, both capability forecasts and safety arguments inherit that unpredictability.`,
    prereqs: ['scaling-law', 'foundation-model'],
  },
  {
    slug: 'alignment',
    name: 'Alignment',
    status: 'contested',
    short: "Making AI systems pursue the goals their operators and society actually intend, and the open question of whether that's achievable.",
    explanation: `At its narrowest, alignment is product work: tuning a model (largely via RLHF) to be helpful, follow instructions, and refuse harm. At its broadest, it is a research agenda about whether the goals of systems more capable than their evaluators can be specified, verified, or trusted at all.

The word is contested because both camps use it and mean different things. Practitioners disagree about whether alignment is an engineering problem being solved incrementally, a hard open research frontier, or unachievable in principle for sufficiently capable systems, and, beneath that, whose intentions the system is supposed to be aligned with. An argument that "alignment is going well" and one that "alignment is unsolved" may not be about the same thing.`,
    prereqs: ['rlhf', 'emergent-capability'],
  },
  // ---- Transformer internals. Added for /traceroute, which links its 3D captions straight
  // ---- into these pages; they stand on their own on /concepts too.
  {
    slug: 'residual-stream',
    name: 'Residual stream',
    status: 'settled',
    short: 'The running representation a transformer carries from layer to layer, which each block adds to rather than replaces.',
    explanation: `A transformer does not hand a fresh answer from one layer to the next. It carries a single vector per token, the residual stream, and every block reads that vector, computes a small adjustment, and adds the adjustment back. Nothing is overwritten.

That additive structure is what makes very deep stacks trainable, and it is also why interpretability research treats the stream as a shared workspace: different blocks can write features into it that a much later block reads out.`,
    prereqs: ['transformer', 'embedding'],
  },
  {
    slug: 'layer-norm',
    name: 'Layer normalisation',
    status: 'settled',
    short: 'A rescaling step applied before each block so the numbers flowing through stay in a workable range.',
    explanation: `Activations in a deep network drift in scale as they pass through layers, and unchecked drift makes training unstable. Layer normalisation rescales each vector to a consistent statistical shape before the next block reads it.

It is unglamorous and load-bearing. Where exactly it sits, before or after the block, is one of the small architectural choices that separates model families.`,
    prereqs: ['neural-network', 'transformer'],
  },
  {
    slug: 'query-key-value',
    name: 'Query, key, value',
    status: 'settled',
    short: 'The three learned projections of each token that attention uses to decide what to read from where.',
    explanation: `Attention gives every position three views of itself, each a learned projection of the same vector: a query for what this position is looking for, a key for what it offers to others, and a value for what it passes on when selected. Scores come from comparing queries against keys; the values are what actually get mixed.

The separation matters. A token can advertise something quite different from what it contributes, which is what lets attention route information rather than merely blend it.`,
    prereqs: ['attention-mechanism'],
  },
  {
    slug: 'kv-cache',
    name: 'KV cache',
    status: 'settled',
    short: 'Stored keys and values for tokens already processed, so generating each new token does not recompute the whole sequence.',
    explanation: `Generation is one token at a time, and each new token attends to everything before it. Recomputing keys and values for the entire history on every step would make the tenth token roughly ten times as expensive as the first. Instead they are computed once and cached.

This is why serving cost scales with context length in memory rather than in repeated compute, and why long-context serving is a memory-capacity problem as much as a compute one.`,
    prereqs: ['attention-mechanism', 'context-window', 'inference'],
  },
  {
    slug: 'feed-forward',
    name: 'Feed-forward network',
    status: 'settled',
    short: 'The second half of every transformer block: a widening projection, a nonlinearity, and a projection back down.',
    explanation: `After attention has moved information between positions, each position is processed independently by a small network that projects it up to several times its width, applies a simple elementwise function, and projects it back. Most of a model's parameters sit in these two matrices.

Attention decides what to look at. The feed-forward layers are where a great deal of what the model knows appears to be stored.`,
    prereqs: ['transformer', 'parameters'],
  },
  {
    slug: 'positional-encoding',
    name: 'Positional encoding',
    status: 'settled',
    short: 'Information about token order, added to the embeddings because attention alone is order-blind.',
    explanation: `Attention compares every position with every other and has no inherent notion of sequence. Without a positional signal a model would treat a sentence as an unordered bag of tokens.

Schemes vary, from fixed sinusoids to learned vectors to rotary encodings applied inside attention itself. The choice matters most for how gracefully a model handles sequences longer than the ones it was trained on.`,
    prereqs: ['embedding', 'attention-mechanism'],
  },
  {
    slug: 'logits',
    name: 'Logits',
    status: 'settled',
    short: 'The raw score a model assigns to every token in its vocabulary before those scores become probabilities.',
    explanation: `At the top of the stack the final vector is projected back out to one number per vocabulary entry, often a hundred thousand or more. These raw scores are logits: unnormalised, freely positive or negative, and meaningful only relative to each other.

Everything downstream of them, the probability distribution, the sampling, the visible token, is a transformation of this one long list of numbers.`,
    prereqs: ['neural-network', 'vocabulary'],
  },
  {
    slug: 'softmax',
    name: 'Softmax',
    status: 'settled',
    short: 'The function that turns raw scores into a probability distribution summing to one.',
    explanation: `Softmax exponentiates every logit and divides by the total, producing values between zero and one that sum to one. It appears twice in a transformer: over the vocabulary at the output head, and inside attention to turn comparison scores into mixing weights.

Because it exponentiates, small differences in logits become large differences in probability. That sensitivity is why a model can be overwhelmingly confident about one token and why temperature, which scales logits before this step, has such a pronounced effect.`,
    prereqs: ['logits'],
  },
  {
    slug: 'vocabulary',
    name: 'Vocabulary',
    status: 'settled',
    short: 'The fixed set of tokens a model can read and write, typically tens to hundreds of thousands of entries.',
    explanation: `A model's vocabulary is decided before training and never changes. Every input must be expressible in it and every output is drawn from it, which is why an unusual word arrives as several fragments rather than as itself.

Vocabulary size is a real design tradeoff: larger vocabularies mean shorter sequences and cheaper attention, but a bigger embedding table and output projection, and less data behind each rare entry.`,
    prereqs: ['token'],
  },
  {
    slug: 'sampling',
    name: 'Sampling',
    status: 'settled',
    short: 'Choosing the next token from the probability distribution, rather than always taking the most likely one.',
    explanation: `Once the output head has produced probabilities, something has to pick. Always taking the highest is available and produces flat, repetitive text, so most systems draw from the distribution under controls such as temperature, top-k, or nucleus sampling.

This is the step that makes a model non-deterministic, and it sits entirely outside the network. The same weights and the same prompt can yield different text because of a choice made after all the arithmetic is finished.`,
    prereqs: ['softmax', 'inference'],
  },
];


async function main() {
  await client.connect();
  await client.query('begin');

  // concepts, prose (name, definitions, status) is owned by the edit form once a
  // row exists, so on conflict we only no-op to recover the id.
  const id = {};
  for (const c of concepts) {
    const r = await client.query(
      `insert into concepts (slug, name, short_definition, explanation, status)
       values ($1,$2,$3,$4,$5)
       on conflict (slug) do update set slug = excluded.slug
       returning id`,
      [c.slug, c.name, c.short, c.explanation, c.status]
    );
    id[c.slug] = r.rows[0].id;
  }

  // dependency edges (status 'confirmed' by default, these are author-curated)
  let edgeCount = 0;
  for (const c of concepts) {
    for (const p of c.prereqs) {
      if (!id[p]) throw new Error(`prerequisite not found: ${p} (for ${c.slug})`);
      await client.query(
        `insert into concept_edges (concept_id, prerequisite_id)
         values ($1,$2) on conflict (concept_id, prerequisite_id) do nothing`,
        [id[c.slug], id[p]]
      );
      edgeCount++;
    }
  }

  await client.query('commit');

  const count = async (t) => (await client.query(`select count(*)::int n from ${t}`)).rows[0].n;
  console.log('concept seed complete:');
  console.log('  concepts      ', await count('concepts'));
  console.log('  concept_edges ', await count('concept_edges'), `(${edgeCount} seeded)`);
  await client.end();
}

main().catch(async (e) => {
  try { await client.query('rollback'); } catch {}
  console.error('CONCEPT SEED FAILED:', e.message);
  process.exit(1);
});
