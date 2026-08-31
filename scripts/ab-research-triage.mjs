// One-off A/B script: replay historical Sonnet/Haiku research-triage decisions
// (papers.triage_status) through a candidate OpenRouter model and measure
// agreement. READ-ONLY on the database — no writes, no ai_cost_log rows (same
// deliberate deviation from house cost-metering discipline as
// scripts/ab-research-analysis.mjs: this is a throwaway experiment). Token
// usage is summed and printed instead so the operator can eyeball cost.
//
// The prompt is a hand-copied REPLICATION of lib/research/triage.ts's
// triagePapersChunk (system text, schema, chunking, and per-paper user-prompt
// assembly) rather than an import of that module or lib/research/model-route.ts's
// researchStructured: the lib/ chain uses extensionless relative imports that
// plain Node's type-stripping loader cannot resolve (see
// scripts/ab-research-analysis.mjs's header note — same landmine). The
// OpenRouter call shape (response_format json_object, reasoning disabled with
// a bounded-reasoning retry, schema dumped into the user message) matches
// researchStructured's OpenRouter branch exactly, so this exercises the same
// code path production would take if z-ai/glm-5.3-flash were picked as
// research_prefs.triage_model.
//
// Flags:
//   --n=N          total sample size, split n/2 kept + n/2 rejected
//                  (default 120)
//   --model=id     OpenRouter model id to replay (default z-ai/glm-5.3-flash)
//   --out=<dir>    REQUIRED. Directory to write triage-replay.json into
//                  (created if missing).
//
// Run:
//   node scripts/ab-research-triage.mjs --out=/tmp/ab-research-triage

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const scriptStart = Date.now();

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { n: 120, model: 'z-ai/glm-5.3-flash', out: null, idsFile: null };
  for (const arg of argv) {
    if (arg.startsWith('--n=')) args.n = Number(arg.slice('--n='.length));
    else if (arg.startsWith('--ids-file=')) args.idsFile = arg.slice('--ids-file='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length).trim();
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(args.n) || args.n <= 0) {
    console.error('--n must be a positive number.');
    process.exit(1);
  }
  if (!args.model) {
    console.error('--model must name an OpenRouter model id.');
    process.exit(1);
  }
  if (!args.out) {
    console.error('--out=<dir> is required (where triage-replay.json is written).');
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args.out);
mkdirSync(outDir, { recursive: true });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is not set.');
  process.exit(1);
}

// ------------------------------------------------------------------ DB setup
const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ============================================================================
// The replicated triage prompt (lib/research/triage.ts, triagePapersChunk).
// Keep these in sync by hand if the source prompt changes — see header note.
// ============================================================================

const TRIAGE_SYSTEM = [
  'You triage new AI research papers for The AI Atlas, a tool for staying oriented in the AI-economy debate.',
  'For each paper decide keep (worth the author\'s attention) or reject, from the title and abstract alone.',
  'Judge by the CHARTER below: a paper is kept if and only if its central contribution lands in a listed family.',
  'KEEP, Tier A (direct evidence): A1 agent reliability: multi-step completion, failure modes, memory and recovery, long-horizon evals, agent infrastructure with measured reliability effects. A2 capability trajectory: returns to scale or inference-time compute continuing or saturating, benchmark contamination or measurement-validity results, frontier capability versus expert judgment on real tasks. A3 cost and efficiency: inference or training cost reductions with numbers, quantization, serving systems, KV-cache and attention runtimes, hardware co-design, MoE serving, training-efficiency gains that cut compute needs, token economics of deployed agents. A4 open-weight parity and commoditization: open models nearing frontier on economic use cases, switching and multi-homing evidence. A5 RL on verifiable rewards: what it changes about capability generalization versus narrowness, not routine RLVR engineering. A6 labor and productivity: empirical effects of AI on real work, productivity measurement, staffing effects, telemetry of AI use at work, human-AI collaboration economics. A7 deployment trust: prompt-injection exposure, monitoring reliability, policy-violation failure modes, agent auditing and release gates, whatever gates enterprise adoption.',
  'KEEP, Tier B (context): B1 frontier or near-frontier lab capability reports, including open-weight agent and model technical reports. B2 significant new benchmarks or evals for agentic work or economics-relevant capabilities, including cost-aware and real-task evals. B3 consolidating surveys of an A family.',
  'REJECT everything else, including: RL and training-technique engineering that does not change what RLVR or scaling means for the debate (GRPO variants, distillation frameworks, optimizer and batch-size theory), incremental architecture tweaks, narrow domain applications (medical, bio, quantum, robotics manipulation, geospatial, single-language or single-task NLP) with no economic or deployment angle, benchmark-only work on non-listed capabilities, pure theory, and interpretability or alignment work unless it bears on deployment reliability (A7).',
  'Tie-breaker when unsure between B and reject: would a fortnight report on the AI economy cite this paper? If genuinely unsure after that, keep it.',
  'For each KEPT paper: summary = 1-2 plain-language sentences on what the paper claims and shows, written for a smart non-specialist deciding whether to read it (what was done, what was found, how big). Start with a capital letter, no jargon walls. reason = one short sentence on why it matters to the Atlas specifically (distinct from the summary). claim_codes = ONLY codes from the provided list the paper genuinely bears on (advisory, often empty); concept_slugs = listed concepts the paper directly concerns; thread_slugs = listed threads the paper would move. Never invent a code or slug.',
  'For each REJECTED paper: summary = an empty string; reason = one short sentence. Start every reason with a capital letter. Never use an em dash anywhere; use a comma or a colon instead.',
].join(' ');

const TRIAGE_CHUNK = 25;
const ABSTRACT_CLIP = 1400;

function buildSchema(codes, concepts, threads) {
  const strArray = (values) => ({
    type: 'array',
    items: values.length ? { type: 'string', enum: values } : { type: 'string' },
  });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      decisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            index: { type: 'integer' },
            keep: { type: 'boolean' },
            summary: { type: 'string' },
            reason: { type: 'string' },
            claim_codes: strArray(codes),
            concept_slugs: strArray(concepts),
            thread_slugs: strArray(threads),
          },
          required: ['index', 'keep', 'summary', 'reason', 'claim_codes', 'concept_slugs', 'thread_slugs'],
        },
      },
    },
    required: ['decisions'],
  };
}

// -------------------------------------------------------- tolerant JSON extractor
// Copied from lib/scan/core.ts's extractJsonObject (pure function, no imports).
function extractJsonObject(text) {
  const s = String(text ?? '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('no JSON object in model response');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error('unterminated JSON object in model response');
}

// ------------------------------------------------------- OpenRouter call (raw)
// Mirrors lib/scan/llm.ts's chatJSONOpenRouter request shape (response_format
// json_object, reasoning disabled with a bounded-reasoning retry on models
// that refuse to fully disable it) but read-only: no recordApiCall, usage is
// returned to the caller for printing instead. Copied verbatim from
// scripts/ab-research-analysis.mjs.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(model, system, user, maxTokens, timeoutMs) {
  const attempt = async (mode) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: mode === 'off' ? maxTokens : maxTokens + 500,
          response_format: { type: 'json_object' },
          reasoning: mode === 'off' ? { enabled: false } : { max_tokens: 400 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      const body = await res.text();
      const wallMs = Date.now() - t0;
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
      if (!body.trim()) throw new Error('OpenRouter: empty response body');
      const data = JSON.parse(body);
      if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message.slice(0, 200)}`);
      const usage = {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      return { parsed: extractJsonObject(content), usage, wallMs };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt('off');
  } catch (e) {
    if (/reasoning is mandatory/i.test(String(e?.message))) return attempt('bounded');
    throw e;
  }
}

// Anthropic branch (claude-* model ids): forced tool use with the real schema,
// mirroring lib/dossier.ts runStructured's call shape. Same return contract as
// callOpenRouter so the dispatcher below can swap freely.
async function callAnthropic(model, system, user, toolSchema, maxTokens, timeoutMs) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [{ name: 'submit_triage', description: 'Return a keep/reject decision for every paper index.', input_schema: toolSchema }],
        tool_choice: { type: 'tool', name: 'submit_triage' },
        messages: [{ role: 'user', content: user }],
      }),
    });
    const body = await res.text();
    const wallMs = Date.now() - t0;
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body.slice(0, 200)}`);
    const data = JSON.parse(body);
    const block = (data.content || []).find((b) => b.type === 'tool_use');
    if (!block) throw new Error('Anthropic: no tool_use block in response');
    const usage = {
      prompt_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0),
      completion_tokens: data.usage?.output_tokens ?? 0,
    };
    return { parsed: block.input, usage, wallMs };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------- digests
// Inline equivalents of lib/data/map.ts's getTargets and
// lib/data/research.ts's getConceptDigest / getThreadDigest.
const { rows: claims } = await client.query(
  `select code, statement from claims where is_frame = false order by code`
);
const { rows: bridges } = await client.query(
  `select code, statement from bridge_claims order by code`
);
const { rows: concepts } = await client.query(
  `select slug, name, short_definition from concepts order by slug`
);
const { rows: threads } = await client.query(
  `select slug, title, question from research_threads where status = 'open' order by slug`
);

const codes = [...claims.map((c) => c.code), ...bridges.map((b) => b.code)];
const conceptSlugs = concepts.map((c) => c.slug);
const threadSlugs = threads.map((t) => t.slug);
const validCode = new Set(codes);
const validConcept = new Set(conceptSlugs);
const validThread = new Set(threadSlugs);

const targetList = [
  ...claims.map((c) => `[${c.code}] (claim) ${c.statement}`),
  ...bridges.map((b) => `[${b.code}] (bridge-claim) ${b.statement}`),
].join('\n');
const conceptList = concepts.map((c) => `[${c.slug}] ${c.name}: ${c.short_definition}`).join('\n');
const threadList = threads.map((t) => `[${t.slug}] ${t.title}: ${t.question}`).join('\n');

const schema = buildSchema(codes, conceptSlugs, threadSlugs);

// Matches triage.ts's system assembly exactly (no lens guide — triage's schema
// carries no lens field, unlike the analysis prompt).
const system = [
  TRIAGE_SYSTEM,
  `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes):\n${targetList || '(none)'}`,
  `\nCONCEPTS (use ONLY these slugs):\n${conceptList || '(none)'}`,
  `\nRESEARCH THREADS (use ONLY these slugs):\n${threadList || '(none)'}`,
].join('\n');

// ----------------------------------------------------------------------- sample
// n/2 kept + n/2 rejected, each half ordered by md5(id::text) (deterministic
// pseudo-random), then the combined 120 re-ordered by md5(id) again so chunks
// mix kept/rejected the way a live triage batch would.
const keptN = Math.ceil(args.n / 2);
const rejectedN = Math.floor(args.n / 2);
let papersQuery;
if (args.idsFile) {
  const { readFileSync } = await import('node:fs');
  const ids = readFileSync(args.idsFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  papersQuery = await client.query(
    `select id::text as id, title, categories, to_char(published_at, 'YYYY-MM-DD') as published_at,
            comments, abstract, triage_status::text as triage_status, triage_reason
       from papers where id::text = any($1) order by md5(id::text)`,
    [ids]
  );
}
const { rows: papers } = papersQuery ?? await client.query(
  `with kept as (
     select id::text as id, title, categories, to_char(published_at, 'YYYY-MM-DD') as published_at,
            comments, abstract, triage_status::text as triage_status, triage_reason
       from papers
      where triage_status = 'kept' and abstract is not null
      order by md5(id::text)
      limit $1
   ), rejected as (
     select id::text as id, title, categories, to_char(published_at, 'YYYY-MM-DD') as published_at,
            comments, abstract, triage_status::text as triage_status, triage_reason
       from papers
      where triage_status = 'rejected' and abstract is not null
      order by md5(id::text)
      limit $2
   )
   select * from (select * from kept union all select * from rejected) sub
   order by md5(sub.id)`,
  [keptN, rejectedN]
);
const sampledKept = papers.filter((p) => p.triage_status === 'kept').length;
const sampledRejected = papers.filter((p) => p.triage_status === 'rejected').length;

console.log(`Model under test: ${args.model}`);
console.log(`Sample: ${papers.length} papers (${sampledKept} kept, ${sampledRejected} rejected)`);
console.log(`Output directory: ${outDir}\n`);

// ------------------------------------------------------------------- chunking
function buildChunkList(chunk) {
  return chunk
    .map((p, i) => {
      const meta = [
        (p.categories || []).join(', '),
        p.published_at ?? '',
        p.comments ? `comment: ${p.comments.slice(0, 160)}` : '',
      ].filter(Boolean).join(' · ');
      return `[${i}] ${p.title}\n    (${meta})\n    ${(p.abstract ?? '').slice(0, ABSTRACT_CLIP)}`;
    })
    .join('\n\n');
}

// The only-JSON instruction + embedded schema, matching researchStructured's
// OpenRouter branch (lib/research/model-route.ts) exactly.
function buildOpenRouterUser(list) {
  return `PAPERS:\n\n${list}

Reply with ONLY a single JSON object, no prose and no code fence, matching this schema exactly:
${JSON.stringify(schema)}`;
}

const chunks = [];
for (let i = 0; i < papers.length; i += TRIAGE_CHUNK) chunks.push(papers.slice(i, i + TRIAGE_CHUNK));

// -------------------------------------------------------------------------- run
const MAX_TOKENS = 8000;
const TIMEOUT_MS = 90_000;

const results = [];
const anomalies = {
  extraTopKeys: 0, badIndex: 0, duplicateIndex: 0, outOfRangeIndex: 0, missingIndex: 0,
  nonBooleanKeep: 0, extraDecisionKeys: 0, invalidClaimCodes: 0, invalidConceptSlugs: 0, invalidThreadSlugs: 0,
};
let tokenTotals = { prompt: 0, completion: 0 };
let requestCount = 0;
let errorChunks = 0;
const ALLOWED_DECISION_KEYS = new Set(['index', 'keep', 'summary', 'reason', 'claim_codes', 'concept_slugs', 'thread_slugs']);

async function runChunkWithRetry(chunk, chunkIdx) {
  const list = buildChunkList(chunk);
  const anthropic = args.model.startsWith('claude-');
  const orUser = buildOpenRouterUser(list);
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return anthropic
        ? await callAnthropic(args.model, system, `PAPERS:\n\n${list}`, schema, MAX_TOKENS, TIMEOUT_MS)
        : await callOpenRouter(args.model, system, orUser, MAX_TOKENS, TIMEOUT_MS);
    } catch (e) {
      lastErr = e;
      console.log(`  chunk ${chunkIdx} attempt ${attempt} FAILED: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  throw lastErr;
}

for (let c = 0; c < chunks.length; c++) {
  const chunk = chunks[c];
  console.log(`--- Chunk ${c + 1}/${chunks.length} (${chunk.length} papers) ---`);
  let outcome;
  try {
    outcome = await runChunkWithRetry(chunk, c + 1);
  } catch (e) {
    const message = String(e?.message ?? e).slice(0, 300);
    for (const p of chunk) {
      results.push({
        id: p.id, title: p.title, sonnet: p.triage_status, glm: 'error', glm_reason: message,
        sonnet_reason: p.triage_reason,
      });
    }
    errorChunks += 1;
    console.log(`  chunk ${c + 1} errored out after retry, ${chunk.length} papers marked 'error'\n`);
    continue;
  }

  const { parsed, usage, wallMs } = outcome;
  tokenTotals.prompt += usage.prompt_tokens;
  tokenTotals.completion += usage.completion_tokens;
  requestCount += 1;
  console.log(`  ok (${wallMs}ms, ${usage.prompt_tokens} in / ${usage.completion_tokens} out tokens)`);

  const topKeys = Object.keys(parsed || {});
  if (topKeys.length !== 1 || topKeys[0] !== 'decisions') anomalies.extraTopKeys += 1;
  const decisionsArr = Array.isArray(parsed?.decisions) ? parsed.decisions : [];

  const byIndex = new Map();
  for (const d of decisionsArr) {
    if (typeof d?.index !== 'number' || !Number.isInteger(d.index)) { anomalies.badIndex += 1; continue; }
    if (d.index < 0 || d.index >= chunk.length) anomalies.outOfRangeIndex += 1;
    if (byIndex.has(d.index)) anomalies.duplicateIndex += 1;
    byIndex.set(d.index, d);
  }

  for (let i = 0; i < chunk.length; i++) {
    const p = chunk[i];
    const d = byIndex.get(i);
    if (!d) {
      anomalies.missingIndex += 1;
      results.push({
        id: p.id, title: p.title, sonnet: p.triage_status, glm: 'rejected', glm_reason: 'No decision returned',
        sonnet_reason: p.triage_reason,
      });
      continue;
    }
    if (typeof d.keep !== 'boolean') anomalies.nonBooleanKeep += 1;
    for (const k of Object.keys(d)) if (!ALLOWED_DECISION_KEYS.has(k)) anomalies.extraDecisionKeys += 1;
    const claimCodes = Array.isArray(d.claim_codes) ? d.claim_codes : [];
    const conceptSlugsD = Array.isArray(d.concept_slugs) ? d.concept_slugs : [];
    const threadSlugsD = Array.isArray(d.thread_slugs) ? d.thread_slugs : [];
    anomalies.invalidClaimCodes += claimCodes.filter((v) => !validCode.has(v)).length;
    anomalies.invalidConceptSlugs += conceptSlugsD.filter((v) => !validConcept.has(v)).length;
    anomalies.invalidThreadSlugs += threadSlugsD.filter((v) => !validThread.has(v)).length;

    results.push({
      id: p.id,
      title: p.title,
      sonnet: p.triage_status,
      glm: d.keep ? 'kept' : 'rejected',
      glm_reason: String(d.reason ?? '').slice(0, 300),
      sonnet_reason: p.triage_reason,
    });
  }
  console.log('');
}

// ---------------------------------------------------------------- comparison
const comparable = results.filter((r) => r.glm !== 'error');
const errors = results.length - comparable.length;

const cm = {
  sonnetKept_glmKept: 0, sonnetKept_glmRejected: 0, sonnetRejected_glmKept: 0, sonnetRejected_glmRejected: 0,
};
const falseRejects = []; // sonnet kept, glm rejected
const falseKeeps = []; // sonnet rejected, glm kept
for (const r of comparable) {
  if (r.sonnet === 'kept' && r.glm === 'kept') cm.sonnetKept_glmKept += 1;
  else if (r.sonnet === 'kept' && r.glm === 'rejected') { cm.sonnetKept_glmRejected += 1; falseRejects.push(r); }
  else if (r.sonnet === 'rejected' && r.glm === 'kept') { cm.sonnetRejected_glmKept += 1; falseKeeps.push(r); }
  else if (r.sonnet === 'rejected' && r.glm === 'rejected') cm.sonnetRejected_glmRejected += 1;
}
const agree = cm.sonnetKept_glmKept + cm.sonnetRejected_glmRejected;
const overallAgreementPct = comparable.length ? (agree / comparable.length) * 100 : 0;
const sonnetKeptTotal = cm.sonnetKept_glmKept + cm.sonnetKept_glmRejected;
const sonnetRejectedTotal = cm.sonnetRejected_glmKept + cm.sonnetRejected_glmRejected;
const falseRejectRatePct = sonnetKeptTotal ? (cm.sonnetKept_glmRejected / sonnetKeptTotal) * 100 : 0;
const falseKeepRatePct = sonnetRejectedTotal ? (cm.sonnetRejected_glmKept / sonnetRejectedTotal) * 100 : 0;

// Rate card as of migration 0041 (USD per Mtok); only covers the curated
// OpenRouter shortlist, cost estimate skipped for any other model.
const RATE_CARDS = {
  'qwen/qwen3.7-flash': { input: 0.0300, output: 0.1300 },
  'qwen/qwen3-30b-a3b-instruct-2507': { input: 0.0480, output: 0.1930 },
  'z-ai/glm-5.3-flash': { input: 0.0750, output: 0.2500 },
  'mistralai/mistral-small-3.2-24b-instruct': { input: 0.0750, output: 0.2000 },
  'deepseek/deepseek-v4-flash': { input: 0.0830, output: 0.1660 },
  'meta-llama/llama-4-scout': { input: 0.1100, output: 0.3400 },
};
const rate = RATE_CARDS[args.model];
const estCostUsd = rate
  ? (tokenTotals.prompt / 1e6) * rate.input + (tokenTotals.completion / 1e6) * rate.output
  : null;

// 5 sample glm reasons, evenly spaced across the comparable set for a mix of
// kept/rejected verdicts rather than clustering from one chunk.
const withReason = comparable.filter((r) => r.glm_reason);
const sampleReasons = [];
if (withReason.length) {
  const step = Math.max(1, Math.floor(withReason.length / 5));
  for (let i = 0; i < withReason.length && sampleReasons.length < 5; i += step) {
    sampleReasons.push({ title: withReason[i].title, sonnet: withReason[i].sonnet, glm: withReason[i].glm, reason: withReason[i].glm_reason });
  }
}

// -------------------------------------------------------------------- output
const outPayload = {
  meta: {
    model: args.model,
    n: args.n,
    sampledKept, sampledRejected,
    chunkSize: TRIAGE_CHUNK,
    chunks: chunks.length,
    errorChunks,
    generatedAt: new Date().toISOString(),
  },
  summary: {
    totalPapers: results.length,
    errors,
    comparable: comparable.length,
    overallAgreementPct: Number(overallAgreementPct.toFixed(2)),
    confusionMatrix: cm,
    falseRejectCount: cm.sonnetKept_glmRejected,
    falseRejectRatePct: Number(falseRejectRatePct.toFixed(2)),
    falseKeepCount: cm.sonnetRejected_glmKept,
    falseKeepRatePct: Number(falseKeepRatePct.toFixed(2)),
    tokenTotals: {
      promptTokens: tokenTotals.prompt,
      completionTokens: tokenTotals.completion,
      requests: requestCount,
      estCostUsd: estCostUsd === null ? null : Number(estCostUsd.toFixed(4)),
    },
    schemaIssues: anomalies,
  },
  falseRejects: falseRejects.map((r) => ({ id: r.id, title: r.title })),
  falseKeeps: falseKeeps.map((r) => ({ id: r.id, title: r.title })),
  sampleReasons,
  results,
};

const outFile = path.join(outDir, 'triage-replay.json');
writeFileSync(outFile, JSON.stringify(outPayload, null, 2));

// ------------------------------------------------------------------- console
console.log('=== Summary ===');
console.log(`Model: ${args.model}`);
console.log(`Papers: ${results.length} (errors: ${errors}, comparable: ${comparable.length})`);
console.log(`Overall agreement: ${overallAgreementPct.toFixed(1)}%\n`);

console.log('Confusion matrix (rows = sonnet, cols = glm):');
console.log(`  sonnet kept     -> glm kept: ${cm.sonnetKept_glmKept}   glm rejected: ${cm.sonnetKept_glmRejected}`);
console.log(`  sonnet rejected -> glm kept: ${cm.sonnetRejected_glmKept}   glm rejected: ${cm.sonnetRejected_glmRejected}\n`);

console.log(`False-reject rate (sonnet kept, glm rejected): ${cm.sonnetKept_glmRejected}/${sonnetKeptTotal} = ${falseRejectRatePct.toFixed(1)}%`);
if (falseRejects.length) {
  for (const r of falseRejects) console.log(`  - [${r.id}] ${r.title}`);
} else {
  console.log('  (none)');
}
console.log('');

console.log(`False-keep rate (sonnet rejected, glm kept): ${cm.sonnetRejected_glmKept}/${sonnetRejectedTotal} = ${falseKeepRatePct.toFixed(1)}%`);
if (falseKeeps.length) {
  for (const r of falseKeeps) console.log(`  - [${r.id}] ${r.title}`);
} else {
  console.log('  (none)');
}
console.log('');

console.log(`Token totals: ${tokenTotals.prompt} prompt / ${tokenTotals.completion} completion (${requestCount} requests)`);
console.log(`Est. cost: ${estCostUsd === null ? 'n/a (no rate card for this model)' : `$${estCostUsd.toFixed(4)}`}\n`);

console.log('Schema-discipline anomalies:');
for (const [k, v] of Object.entries(anomalies)) console.log(`  ${k}: ${v}`);
console.log('');

console.log('Sample glm reasons:');
for (const s of sampleReasons) console.log(`  - [sonnet=${s.sonnet} glm=${s.glm}] "${s.title.slice(0, 70)}" -> ${s.reason}`);

console.log(`\nWrote ${outFile}`);
console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();
