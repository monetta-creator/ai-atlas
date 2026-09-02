// One-time backfill for the relevance ensemble (migration 0053): casts the
// panel's missing score-only votes on scan_items enriched before the ensemble
// shipped, so the historical rows carry relevance_votes/relevance_spread too
// instead of waiting for a live run's per-item cast or per-run top-up
// (lib/scan/run.ts) to eventually reach them.
//
// Loading constraint (same as scripts/backfill-source-tiers.mjs): lib/scan/
// enrich.ts pulls in lib/dossier.ts and lib/scan/llm.ts, both of which import
// '../cost' / './cost' WITHOUT the .ts extension Node's type stripping needs,
// so that chain does not resolve under plain Node. This script therefore does
// NOT import lib/scan/relevance-vote.ts, lib/scan/enrich.ts, lib/scan/llm.ts,
// lib/dossier.ts, or lib/data/scan.ts / lib/mutations/scan.ts (which import
// '../db' the same extensionless way). Instead:
//   - the pure panel/median/spread/merge machinery comes from
//     lib/scan/ensemble.ts (dependency-free, Node-loadable);
//   - the selection query is the SAME predicate as getItemsMissingVotes in
//     lib/data/scan.ts, run over a $days window against a raw pg client;
//   - the write is the SAME SQL as setScanItemRelevanceVotes in
//     lib/mutations/scan.ts;
//   - the vote prompt is a hand-kept copy of lib/scan/relevance-vote.ts's
//     SYSTEM text and lib/scan/enrich.ts's RELEVANCE_RUBRIC (kept in sync by
//     hand: if you change either source, change the copy here too), sent
//     through a minimal local OpenRouter fetch (same request shape as
//     lib/scan/llm.ts's chatJSONOpenRouter: JSON mode, reasoning disabled
//     first with one bounded retry, 30s abort, max_tokens 60);
//   - the cost row is a direct insert into ai_cost_log mirroring
//     lib/cost.ts's recordApiCall, priced from ai_rate_cards or $0 if the
//     model has no card.
//
// Flags:
//   --dry-run           read-only: casts NO votes, writes NOTHING, only
//                        reports what would happen. Safe against the live DB.
//   --limit=N            items to consider (default 1000)
//   --days=N              lookback window in days (default 60)
//   --concurrency=N        items processed in parallel (default 4)
//
// Run: node scripts/backfill-relevance-votes.mjs --dry-run   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { ensemblePanel, mergeVotes, missingVoters, summarizeVotes, clamp01 } from '../lib/scan/ensemble.ts';
import { extractJsonObject } from '../lib/scan/core.ts';

const scriptStart = Date.now();
const VOTE_FEATURE = 'scan_relevance_vote';
const MAX_INPUT_CHARS = 12_000; // mirrors lib/scan/enrich.ts's MAX_INPUT_CHARS
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Hand-kept copy of lib/scan/enrich.ts's RELEVANCE_RUBRIC. Keep this in sync
// by hand if the source changes: the ensemble's whole premise is every panel
// model scoring on the SAME ruler.
const RELEVANCE_RUBRIC =
  'How relevant to banking and financial services strategy, 0.0 to 1.0. Anchors: 0.9 or higher means a named financial institution, regulator, or payments/AI vendor takes a concrete action with stated numbers or dates (an enforcement action, an earnings beat, a major platform policy change). 0.7 means clearly sector-relevant development without a named actor taking new action (industry trend data, a credible analysis of fraud or credit conditions). 0.4 to 0.5 means sector-adjacent context a strategy reader might skim (macro data, adjacent tech news with plausible spillover). 0.2 means tangential mention only. 0.0 to 0.1 means unrelated locale news, listicles, marketing pages. Score the substance of the text, not the headline. Off-topic items get a low score, not an error.';

// Hand-kept copy of lib/scan/relevance-vote.ts's SYSTEM text.
const SYSTEM = 'You are the relevance-only pass of an external news scan for a financial services strategy team. Score ONLY relevance using the stated anchors; reply with a single JSON object {"relevance": number}. Never use an em dash.';

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { dryRun: false, limit: 1000, days: 60, concurrency: 4 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--days=')) args.days = Number(arg.slice('--days='.length));
    else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.slice('--concurrency='.length));
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  for (const [name, v] of [['--limit', args.limit], ['--days', args.days], ['--concurrency', args.concurrency]]) {
    if (!Number.isFinite(v) || v <= 0) {
      console.error(`${name} must be a positive number.`);
      process.exit(1);
    }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
const panel = ensemblePanel([]);
console.log(`backfill-relevance-votes: ${args.dryRun ? 'DRY RUN (read-only)' : 'LIVE'}, limit=${args.limit}, days=${args.days}, concurrency=${args.concurrency}, panel=${panel.join(', ')}\n`);

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

// Same predicate as lib/data/scan.ts's getItemsMissingVotes, unscoped to a
// run and windowed by --days instead.
async function getMissingVoteItems(days, panelSize, limit) {
  const { rows } = await client.query(
    `select id::text as id, url, headline, source_domain, coalesce(raw_content, '') as raw_content,
            enriched_by, relevance, relevance_votes
       from scan_items
      where enrich_status = 'done' and raw_content is not null
        and created_at >= now() - ($1 || ' days')::interval
        and (relevance_votes is null or (select count(*) from jsonb_object_keys(relevance_votes)) < $2)
      order by created_at desc, id
      limit $3`,
    [days, panelSize, limit]
  );
  return rows;
}

// Same SQL as lib/mutations/scan.ts's setScanItemRelevanceVotes.
async function writeVotes(id, votes) {
  const s = summarizeVotes(votes);
  if (s.median === null) return s;
  await client.query(
    `update scan_items
        set relevance_votes = $2::jsonb, relevance = $3, relevance_spread = $4
      where id = $1`,
    [id, JSON.stringify(votes), s.median, s.spread]
  );
  return s;
}

// Mirrors lib/cost.ts's recordApiCall: price from the active rate card (or
// $0 with no card), insert one ai_cost_log row. Never throws.
async function recordCost(model, usage, wallMs, itemId) {
  try {
    const input = Number(usage?.prompt_tokens) || 0;
    const output = Number(usage?.completion_tokens) || 0;
    const { rows } = await client.query(
      `select id, input_per_mtok, output_per_mtok, context_window
         from ai_rate_cards
        where model = $1 and effective_date <= current_date
        order by effective_date desc
        limit 1`,
      [model]
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
      [VOTE_FEATURE, model, input, output, Math.max(0, Math.round(wallMs)), contextPct, cost, rate?.id ?? null,
        JSON.stringify({ script: 'backfill-relevance-votes', item_id: itemId })]
    );
    return cost;
  } catch (e) {
    console.warn(`  (cost log insert failed, continuing: ${e.message})`);
    return 0;
  }
}

function userText(item) {
  return `ITEM
URL: ${item.url}
SOURCE: ${item.source_domain ?? ''}
HEADLINE: ${item.headline ?? ''}

TEXT:
${(item.raw_content ?? '').slice(0, MAX_INPUT_CHARS)}`;
}

// Minimal local fetch to OpenRouter, the same request shape as
// lib/scan/llm.ts's chatJSONOpenRouter: JSON mode, reasoning disabled first,
// one bounded retry with reasoning capped if the endpoint refuses to disable
// it, 30s abort, max_tokens 60. A 429 waits 5s and retries once before giving
// up on that vote.
async function scoreVoteOpenRouter(item, model, retried429 = false) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  const system = `${SYSTEM}

Reply with ONLY a single JSON object, no prose and no code fence, with exactly this key:
  "relevance": number. ${RELEVANCE_RUBRIC}`;
  const user = userText(item);

  const attempt = async (mode) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const t0 = Date.now();
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 460, // 60 for the answer + 2x the 200-token reasoning budget (deepseek overshoots its bound ~20%; without any budget it flips to 0.0)
          response_format: { type: 'json_object' },
          reasoning: { max_tokens: 200 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
      const body = await res.text();
      if (res.status === 429 && !retried429) {
        await new Promise((r) => setTimeout(r, 5000));
        return scoreVoteOpenRouter(item, model, true);
      }
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
      if (!body.trim()) throw new Error('OpenRouter: empty response body');
      const data = JSON.parse(body);
      if (data.error?.message) throw new Error(`OpenRouter: ${String(data.error.message).slice(0, 200)}`);
      const content = data.choices?.[0]?.message?.content ?? '';
      const raw = extractJsonObject(content);
      return { relevance: clamp01(raw?.relevance), usage: data.usage ?? {}, wallMs: Date.now() - t0 };
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

// -------------------------------------------------------------- main
const stats = {
  itemsConsidered: 0,
  itemsUpdated: 0,
  perModel: Object.fromEntries(panel.map((m) => [m, { votes: 0, failures: 0 }])),
  spreadSum: 0,
  spreadCount: 0,
  spendUsd: 0,
};

async function processItem(item) {
  stats.itemsConsidered += 1;
  const base = item.enriched_by
    ? mergeVotes(item.relevance_votes, { [item.enriched_by]: item.relevance })
    : mergeVotes(item.relevance_votes, {});
  const need = missingVoters(panel, base);
  if (!need.length) return;

  const results = await Promise.all(
    need.map(async (model) => {
      try {
        const { relevance, usage, wallMs } = await scoreVoteOpenRouter(item, model);
        stats.spendUsd += await recordCost(model, usage, wallMs, item.id);
        if (relevance === null) {
          stats.perModel[model].failures += 1;
          return null;
        }
        stats.perModel[model].votes += 1;
        return [model, relevance];
      } catch (e) {
        stats.perModel[model].failures += 1;
        console.warn(`  vote failed (${model} · ${item.id}): ${e.message}`);
        return null;
      }
    })
  );
  const cast = Object.fromEntries(results.filter(Boolean));
  const votes = mergeVotes(base, cast);
  if (!Object.keys(votes).length) return;
  const summary = await writeVotes(item.id, votes);
  if (summary.median !== null) {
    stats.itemsUpdated += 1;
    if (summary.spread !== null) {
      stats.spreadSum += summary.spread;
      stats.spreadCount += 1;
    }
  }
}

// A small concurrency-limited pool over the item list (each item then fans
// out to at most panel.length - 1 model calls internally).
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

const items = await getMissingVoteItems(args.days, panel.length, args.limit);
console.log(`${items.length} item(s) in the last ${args.days} day(s) are missing at least one panel vote (of a ${panel.length}-model panel).`);

if (args.dryRun) {
  stats.itemsConsidered = items.length;
  const needCounts = items.map((item) => {
    const base = item.enriched_by
      ? mergeVotes(item.relevance_votes, { [item.enriched_by]: item.relevance })
      : mergeVotes(item.relevance_votes, {});
    return missingVoters(panel, base).length;
  });
  const totalCalls = needCounts.reduce((a, b) => a + b, 0);
  console.log(`would issue up to ${totalCalls} vote call(s) across ${items.length} item(s) (avg ${items.length ? (totalCalls / items.length).toFixed(1) : '0.0'} missing votes/item)`);
  console.log(`sample item ids: ${items.slice(0, 10).map((i) => i.id).join(', ')}${items.length > 10 ? ', ...' : ''}`);
} else if (!process.env.OPENROUTER_API_KEY) {
  console.log('OPENROUTER_API_KEY not set: nothing to do.');
} else if (items.length) {
  await runPool(items, args.concurrency, processItem);
}

console.log('\n=== Summary ===');
console.log(`items considered: ${stats.itemsConsidered}`);
console.log(`items updated: ${stats.itemsUpdated}`);
for (const [model, s] of Object.entries(stats.perModel)) {
  console.log(`  ${model}: ${s.votes} vote(s), ${s.failures} failure(s)`);
}
console.log(`avg spread on updated items: ${stats.spreadCount ? (stats.spreadSum / stats.spreadCount).toFixed(2) : 'n/a'}`);
console.log(`spend this run: $${stats.spendUsd.toFixed(4)}`);
console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();
