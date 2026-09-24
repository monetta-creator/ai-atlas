// One-time backfill for the evidence-type column (migration 0065): classifies
// every signal (published or draft) whose evidence_type is still null, so
// report tallies and the signals-export corpus can stop counting a 25,000-
// worker field study the same as a product announcement.
//
// Loading constraint (same as scripts/backfill-relevance-votes.mjs and
// scripts/backfill-source-tiers.mjs): lib/pipeline/analysis.ts pulls in
// lib/dossier.ts and lib/scan/llm.ts, both of which import '../cost' / './cost'
// WITHOUT the .ts extension Node's type stripping needs, so that chain does
// not resolve under plain Node. This script therefore does NOT import
// lib/pipeline/analysis.ts, lib/scan/llm.ts, lib/dossier.ts, or lib/data/
// signals.ts / lib/mutations/signals.ts (which import '../db' the same
// extensionless way). Instead:
//   - the selection query and the write are raw SQL over a plain pg client;
//   - the classification prompt is a hand-kept copy of the evidence_type
//     sentence in lib/pipeline/analysis.ts's ANALYSIS_SYSTEM (kept in sync by
//     hand: if you change one, change the other), sent through a minimal
//     local OpenRouter fetch (same request shape as lib/scan/llm.ts's
//     chatJSONOpenRouter: JSON mode, 30s abort, max_tokens 60);
//   - the cost row is a direct insert into ai_cost_log mirroring
//     lib/cost.ts's recordApiCall, priced from ai_rate_cards or $0 if the
//     model has no card.
//
// Flags:
//   --dry-run           read-only: classifies NO rows, writes NOTHING, only
//                        reports what would happen. Safe against the live DB.
//   --limit=N            signals to consider (default 1000)
//   --concurrency=N       signals processed in parallel (default 4)
//
// Run: node scripts/backfill-evidence-type.mjs --dry-run   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { extractJsonObject } from '../lib/scan/core.ts';

const scriptStart = Date.now();
const FEATURE = 'evidence_type_backfill';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Copied from lib/pipeline/config.ts's DEFAULT_UTILITY_MODEL. Keep in sync by
// hand if the source changes.
const MODEL = 'qwen/qwen3.7-flash';

const EVIDENCE_TYPES = ['experiment', 'statistics', 'survey', 'projection', 'announcement', 'analysis', 'other'];

// Hand-kept copy of the evidence_type sentence in lib/pipeline/analysis.ts's
// ANALYSIS_SYSTEM (and the migration 0065 column comment). Keep this in sync
// by hand if the source changes.
const SYSTEM = `You classify what KIND of evidence a Signal Board entry is, not what it is about. Reply with a single JSON object {"evidence_type": "<one of the allowed values>"}.
Allowed values:
experiment: a controlled or field study with measured outcomes.
statistics: primary figures reported by the party that holds them (earnings, filings, official data).
survey: self-reported polling of people or firms.
projection: a forecast or consulting estimate.
announcement: a launch, deal, policy or release with no measured outcome.
analysis: commentary or a secondary synthesis.
other: none of the above.
Never use an em dash.`;

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { dryRun: false, limit: 1000, concurrency: 4 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.slice('--concurrency='.length));
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  for (const [name, v] of [['--limit', args.limit], ['--concurrency', args.concurrency]]) {
    if (!Number.isFinite(v) || v <= 0) {
      console.error(`${name} must be a positive number.`);
      process.exit(1);
    }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
console.log(`backfill-evidence-type: ${args.dryRun ? 'DRY RUN (read-only)' : 'LIVE'}, limit=${args.limit}, concurrency=${args.concurrency}, model=${MODEL}\n`);

// ------------------------------------------------------------------ db client
const client = process.env.DATABASE_URL
  ? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new pg.Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
await client.connect();

async function getUnclassifiedSignals(limit) {
  const { rows } = await client.query(
    `select id::text as id, title, summary,
            brief->>'what_happened'   as what_happened,
            brief->>'why_it_matters'  as why_it_matters,
            brief->>'whats_contested' as whats_contested
       from signals
      where evidence_type is null
      order by created_at desc
      limit $1`,
    [limit]
  );
  return rows;
}

async function writeEvidenceType(id, evidenceType) {
  await client.query(`update signals set evidence_type = $2, updated_at = now() where id = $1`, [id, evidenceType]);
}

// Mirrors lib/cost.ts's recordApiCall: price from the active rate card (or
// $0 with no card), insert one ai_cost_log row. Never throws.
async function recordCost(usage, wallMs, signalId) {
  try {
    const input = Number(usage?.prompt_tokens) || 0;
    const output = Number(usage?.completion_tokens) || 0;
    const { rows } = await client.query(
      `select id, input_per_mtok, output_per_mtok, context_window
         from ai_rate_cards
        where model = $1 and effective_date <= current_date
        order by effective_date desc
        limit 1`,
      [MODEL]
    );
    const rate = rows[0] ?? null;
    const M = 1_000_000;
    const cost = rate ? (input / M) * Number(rate.input_per_mtok) + (output / M) * Number(rate.output_per_mtok) : 0;
    const contextPct = rate && rate.context_window > 0 ? Math.min(100, Math.max(0, (input / rate.context_window) * 100)) : null;
    await client.query(
      `insert into ai_cost_log
         (feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          wall_ms, context_pct, cost_usd, rate_card_id, pipeline_run_id, metadata)
       values ($1,$2,$3,$4,0,0,$5,$6,$7,$8,null,$9::jsonb)`,
      [FEATURE, MODEL, input, output, Math.max(0, Math.round(wallMs)), contextPct, cost, rate?.id ?? null,
        JSON.stringify({ script: 'backfill-evidence-type', signal_id: signalId })]
    );
    return cost;
  } catch (e) {
    console.warn(`  (cost log insert failed, continuing: ${e.message})`);
    return 0;
  }
}

function userText(signal) {
  const parts = [`TITLE: ${signal.title}`];
  if (signal.summary) parts.push(`SUMMARY: ${signal.summary}`);
  if (signal.what_happened) parts.push(`WHAT HAPPENED: ${signal.what_happened}`);
  if (signal.why_it_matters) parts.push(`WHY IT MATTERS: ${signal.why_it_matters}`);
  if (signal.whats_contested) parts.push(`WHAT IS CONTESTED: ${signal.whats_contested}`);
  return parts.join('\n');
}

// Minimal local fetch to OpenRouter, same request shape and reasoning
// discipline as lib/scan/llm.ts's chatJSONOpenRouter: the first attempt
// disables reasoning (a bare-judgment call otherwise burns the whole
// max_tokens budget on reasoning before any content, landing an empty/
// unparseable body); a model whose endpoint REFUSES that ("reasoning is
// mandatory") gets one retry with reasoning bounded instead, with matching
// budget headroom. A 429 also waits 5s and retries once.
async function classifyOpenRouter(signal, mode = 'off', retried429 = false) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const t0 = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: mode === 'off' ? 60 : 460,
        response_format: { type: 'json_object' },
        reasoning: mode === 'off' ? { enabled: false } : { max_tokens: 200 },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userText(signal) },
        ],
      }),
    });
    const body = await res.text();
    if (res.status === 429 && !retried429) {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, 5000));
      return classifyOpenRouter(signal, mode, true);
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    if (!body.trim()) throw new Error('OpenRouter: empty response body');
    const data = JSON.parse(body);
    if (data.error?.message) throw new Error(`OpenRouter: ${String(data.error.message).slice(0, 200)}`);
    const content = data.choices?.[0]?.message?.content ?? '';
    const raw = extractJsonObject(content);
    if (!raw) throw new Error('no JSON object in model response');
    const value = typeof raw?.evidence_type === 'string' ? raw.evidence_type.trim() : null;
    const evidenceType = EVIDENCE_TYPES.includes(value) ? value : 'other';
    return { evidenceType, usage: data.usage ?? {}, wallMs: Date.now() - t0 };
  } catch (e) {
    if (mode === 'off' && /reasoning is mandatory/i.test(String(e?.message))) {
      clearTimeout(timer);
      return classifyOpenRouter(signal, 'bounded', retried429);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------- main
const stats = { considered: 0, classified: 0, failures: 0, spendUsd: 0, byType: Object.fromEntries(EVIDENCE_TYPES.map((t) => [t, 0])) };

async function processSignal(signal) {
  stats.considered += 1;
  try {
    const { evidenceType, usage, wallMs } = await classifyOpenRouter(signal);
    stats.spendUsd += await recordCost(usage, wallMs, signal.id);
    await writeEvidenceType(signal.id, evidenceType);
    stats.classified += 1;
    stats.byType[evidenceType] += 1;
  } catch (e) {
    stats.failures += 1;
    console.warn(`  classify failed (${signal.id}): ${e.message}`);
  }
}

async function runPool(items, size, worker) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => next()));
}

const signals = await getUnclassifiedSignals(args.limit);
console.log(`${signals.length} signal(s) have a null evidence_type.`);

if (args.dryRun) {
  stats.considered = signals.length;
  console.log(`would issue up to ${signals.length} classify call(s)`);
  console.log(`sample signal ids: ${signals.slice(0, 10).map((s) => s.id).join(', ')}${signals.length > 10 ? ', ...' : ''}`);
} else if (!process.env.OPENROUTER_API_KEY) {
  console.log('OPENROUTER_API_KEY not set: nothing to do.');
} else if (signals.length) {
  await runPool(signals, args.concurrency, processSignal);
}

console.log('\n=== Summary ===');
console.log(`signals considered: ${stats.considered}`);
console.log(`signals classified: ${stats.classified}`);
console.log(`failures: ${stats.failures}`);
console.log('distribution:');
for (const [type, count] of Object.entries(stats.byType)) {
  if (count) console.log(`  ${type}: ${count}`);
}
console.log(`spend this run: $${stats.spendUsd.toFixed(4)}`);
console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();
