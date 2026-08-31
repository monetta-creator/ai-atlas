// One-off A/B script: head-to-head comparison of cheap OpenRouter candidate
// models against the existing Sonnet/Haiku extraction already saved on
// reviewed papers, for the research_analysis feature (papers.extraction).
// READ-ONLY on the database — no writes, no ai_cost_log rows (a deliberate
// deviation from house cost-metering discipline; this is a throwaway
// experiment, not a production call site). Token usage per call is printed
// instead so the operator can eyeball cost.
//
// The prompt is a minimal REPLICATION of lib/research/analysis.ts's
// analyzePaper (system text, schema, and user-prompt assembly copied by
// hand to avoid drift-by-import) rather than an import of that module: the
// lib/ chain uses extensionless relative imports (lib/dossier.ts -> '../cost'
// etc.) that plain Node's type-stripping loader cannot resolve. Everything
// this script needs is therefore self-contained below; a raw pg.Client
// (the scripts/backfill-intel-metrics.mjs pattern) reads the claim/bridge/
// concept/thread digests and the candidate papers directly.
//
// Flags:
//   --n=N            how many recently-reviewed extracted papers to test
//                     (default 8)
//   --models=a,b,c   comma-separated OpenRouter model ids to test (default:
//                     qwen/qwen3-30b-a3b-instruct-2507, z-ai/glm-5.3-flash,
//                     deepseek/deepseek-v4-flash)
//   --out=<dir>      REQUIRED. Directory to write <paperId>.json result
//                     files into (created if missing).
//
// Run: node scripts/ab-research-analysis.mjs --out=/tmp/ab-research

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const scriptStart = Date.now();

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = {
    n: 8,
    models: ['qwen/qwen3-30b-a3b-instruct-2507', 'z-ai/glm-5.3-flash', 'deepseek/deepseek-v4-flash'],
    out: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--n=')) args.n = Number(arg.slice('--n='.length));
    else if (arg.startsWith('--models=')) args.models = arg.slice('--models='.length).split(',').map((s) => s.trim()).filter(Boolean);
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
  if (!args.models.length) {
    console.error('--models must name at least one OpenRouter model id.');
    process.exit(1);
  }
  if (!args.out) {
    console.error('--out=<dir> is required (where per-paper result JSON files are written).');
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
// The replicated analysis prompt (lib/research/analysis.ts, analyzePaper).
// Keep these in sync by hand if the source prompt changes — see header note.
// ============================================================================

const SIGNAL_LENS_SLUGS = ['market', 'labor', 'geopolitics', 'regulatory', 'capability', 'society'];
const SIGNAL_LENS_LABEL = {
  market: 'Market & Valuation',
  labor: 'Labor & Knowledge Work',
  geopolitics: 'Geopolitics & Security',
  regulatory: 'Regulatory & Legal',
  capability: 'Technical Capability',
  society: 'Societal & Cultural',
};
const THREAD_RELATIONS = ['supports', 'complicates', 'contradicts', 'context'];
const MAX_INPUT_CHARS = 24_000;

const ANALYSIS_SYSTEM = [
  'You analyze one research paper for The AI Atlas, a tool for staying oriented in the AI-economy debate. Produce a structured FINDING, not a summary: a claim-shaped reading the author can test.',
  'headline_claim: what the paper actually asserts, one falsifiable sentence in plain language.',
  'the_test: what was actually measured, on what data or systems, at what scale.',
  'effect_size: how big the result is and where it holds or breaks (scope conditions). Use the paper\'s own numbers.',
  'limitations: what the authors themselves concede, plus any obvious unstated ones.',
  'counterpoint: what a fair skeptic would say (benchmark gaming, tiny n, lab PR dressed as science, prompt sensitivity, no baselines).',
  'econ_implication: what this means for the ECONOMICS of AI in the next 12 to 24 months, stated with restraint. If the honest answer is "little or nothing yet", say exactly that.',
  'who_cares: for each audience lens the paper genuinely speaks to (often just one or two), one concrete sentence on why that audience should care. Omit lenses it does not speak to.',
  'claim_codes: ONLY codes from the provided claim/bridge list this paper genuinely bears on, not merely thematically related. Often empty. These are advisory, they never write evidence.',
  'concept_slugs: listed concepts the paper directly concerns. thread_placements: listed threads this paper would move, each with a relation (supports / complicates / contradicts / context) and a one-sentence why.',
  'proposed_rigor: 0-100, your suggested methodological-rigor prior for this paper, a suggestion only: venue signal, sample size, baselines, code availability, claims-vs-evidence gap.',
  'Work only from the provided text. Do not fabricate numbers, codes, or slugs. Never use an em dash anywhere; use a comma, a colon, or separate sentences instead.',
].join(' ');

function buildSchema(codes, concepts, threads) {
  const strEnum = (values) => (values.length ? { type: 'string', enum: values } : { type: 'string' });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline_claim: { type: 'string' },
      the_test: { type: 'string' },
      effect_size: { type: 'string' },
      limitations: { type: 'string' },
      counterpoint: { type: 'string' },
      econ_implication: { type: 'string' },
      who_cares: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            lens: { type: 'string', enum: SIGNAL_LENS_SLUGS },
            note: { type: 'string' },
          },
          required: ['lens', 'note'],
        },
      },
      claim_codes: { type: 'array', items: strEnum(codes) },
      concept_slugs: { type: 'array', items: strEnum(concepts) },
      thread_placements: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slug: strEnum(threads),
            relation: { type: 'string', enum: THREAD_RELATIONS },
            why: { type: 'string' },
          },
          required: ['slug', 'relation', 'why'],
        },
      },
      proposed_rigor: { type: 'integer' },
    },
    required: [
      'headline_claim', 'the_test', 'effect_size', 'limitations', 'counterpoint',
      'econ_implication', 'who_cares', 'claim_codes', 'concept_slugs', 'thread_placements',
      'proposed_rigor',
    ],
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
// returned to the caller for printing instead.
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

const targetList = [
  ...claims.map((c) => `[${c.code}] (claim) ${c.statement}`),
  ...bridges.map((b) => `[${b.code}] (bridge-claim) ${b.statement}`),
].join('\n');
const conceptList = concepts.map((c) => `[${c.slug}] ${c.name}: ${c.short_definition}`).join('\n');
const threadList = threads.map((t) => `[${t.slug}] ${t.title}: ${t.question}`).join('\n');
const lensGuide = SIGNAL_LENS_SLUGS.map((s) => `[${s}] ${SIGNAL_LENS_LABEL[s]}`).join('\n');

const schema = buildSchema(codes, conceptSlugs, threadSlugs);

const system = [
  ANALYSIS_SYSTEM,
  `\nAUDIENCE LENSES (use only these codes):\n${lensGuide}`,
  `\nARGUMENT-MAP CLAIMS & BRIDGE-CLAIMS (use ONLY these codes):\n${targetList || '(none)'}`,
  `\nCONCEPTS (use ONLY these slugs):\n${conceptList || '(none)'}`,
  `\nRESEARCH THREADS (use ONLY these slugs):\n${threadList || '(none)'}`,
].join('\n');

// ----------------------------------------------------------------------- papers
const { rows: papers } = await client.query(
  `select id::text as id, title, arxiv_id, authors, categories, comments, raw_content, extraction,
          to_char(published_at, 'YYYY-MM-DD') as published_at
     from papers
    where extraction is not null and raw_content is not null
    order by reviewed_at desc nulls last
    limit $1`,
  [args.n]
);
console.log(`Papers in scope: ${papers.length} (--n=${args.n})`);
console.log(`Candidate models: ${args.models.join(', ')}`);
console.log(`Output directory: ${outDir}\n`);

function buildUserPrompt(p) {
  const meta = [
    p.arxiv_id && `arXiv: ${p.arxiv_id}`,
    p.published_at && `Published: ${p.published_at}`,
    Array.isArray(p.authors) && p.authors.length && `Authors: ${p.authors.slice(0, 12).join(', ')}`,
    Array.isArray(p.categories) && p.categories.length && `Categories: ${p.categories.join(', ')}`,
    p.comments && `Comment: ${p.comments}`,
  ].filter(Boolean).join('\n');
  const body = (p.raw_content || '').trim() || '';
  return `PAPER: ${p.title}\n${meta}\n\n--- FULL TEXT ---\n${body.slice(0, MAX_INPUT_CHARS)}`;
}

// The only-JSON instruction + embedded schema, matching lib/research/model-route.ts's
// generic OpenRouter framing (dump the schema itself rather than a hand-written key
// list, since this script tests three models against one schema).
function buildOpenRouterUser(userPrompt) {
  return `${userPrompt}

Reply with ONLY a single JSON object, no prose and no code fence, matching this schema exactly:
${JSON.stringify(schema)}`;
}

// -------------------------------------------------------------------------- run
const MAX_TOKENS = 3000;
const TIMEOUT_MS = 60_000;

const summary = {}; // model -> { ok, error, totalMs, calls }
for (const model of args.models) summary[model] = { ok: 0, error: 0, totalMs: 0, calls: 0 };

for (const p of papers) {
  console.log(`--- Paper ${p.id} "${p.title.slice(0, 80)}" ---`);
  const userPrompt = buildUserPrompt(p);
  const orUser = buildOpenRouterUser(userPrompt);

  const result = {
    paper: { id: p.id, title: p.title, arxiv_id: p.arxiv_id },
    baseline: p.extraction,
    candidates: {},
  };

  for (const model of args.models) {
    process.stdout.write(`  ${model} ... `);
    try {
      const { parsed, usage, wallMs } = await callOpenRouter(model, system, orUser, MAX_TOKENS, TIMEOUT_MS);
      result.candidates[model] = parsed;
      summary[model].ok += 1;
      summary[model].totalMs += wallMs;
      summary[model].calls += 1;
      console.log(`ok (${wallMs}ms, ${usage.prompt_tokens} in / ${usage.completion_tokens} out tokens)`);
    } catch (e) {
      const message = String(e?.message ?? e);
      result.candidates[model] = { error: message };
      summary[model].error += 1;
      summary[model].calls += 1;
      console.log(`FAILED (${message.slice(0, 160)})`);
    }
  }

  const outFile = path.join(outDir, `${p.id}.json`);
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`  wrote ${outFile}\n`);
}

// ------------------------------------------------------------------- summary table
console.log('=== Summary ===');
console.log(['model', 'ok', 'error', 'mean latency (ms)'].join('\t'));
for (const model of args.models) {
  const s = summary[model];
  const mean = s.calls ? Math.round(s.totalMs / s.calls) : 0;
  console.log([model, s.ok, s.error, mean].join('\t'));
}

console.log(`\nElapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();
