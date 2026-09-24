// One-time (then periodic) backfill for the embeddings table (migration
// 0066): reads every embeddable record across all eleven kinds, chunks it,
// embeds each new-or-changed chunk via OpenRouter, and upserts.
//
// Loading constraint (same family as scripts/backfill-relevance-votes.mjs and
// scripts/backfill-source-tiers.mjs): lib/embed/index.ts and lib/embed/client.ts
// import ../cost and ../db, both of which sit behind the app's extensionless
// relative-import convention, so that chain does not resolve under plain
// Node's type stripping. This script therefore does NOT import lib/embed/index.ts
// or lib/embed/client.ts. Instead:
//   - the SELECT queries are the SAME predicates as lib/embed/sources.ts's
//     assemblers, run over a raw pg client (KEEP THESE IN SYNC BY HAND if you
//     change sources.ts — a comment marks each query with which assembler it
//     mirrors);
//   - chunking is the REAL lib/embed/chunk.ts (pure, node:crypto only, no app
//     imports, so it loads directly here with no duplication);
//   - the embedding call is a local OpenRouter fetch mirroring lib/embed/client.ts's
//     request shape (batches of 64, 30s abort, one bounded retry);
//   - the upsert is the SAME SQL as lib/embed/index.ts's upsertEmbeddings,
//     including the text_hash skip and the stale-chunk delete;
//   - the cost row is a direct insert into ai_cost_log mirroring lib/cost.ts's
//     recordApiCall, priced from ai_rate_cards (the 0066 row) or $0 if absent.
//
// Flags:
//   --dry-run            read-only: embeds and writes NOTHING, reports counts only.
//   --kind=<kind>         restrict to one embed kind (repeatable: --kind=a --kind=b).
//   --limit=N              records per kind (default: no limit).
//   --concurrency=N        records embedded in parallel per kind (default 4).
//
// Run: node scripts/backfill-embeddings.mjs --dry-run   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { chunkRecord } from '../lib/embed/chunk.ts';

const scriptStart = Date.now();
const EMBED_FEATURE = 'embed_index';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBED_MODEL = process.env.EMBED_MODEL || 'openai/text-embedding-3-small';
const BATCH_SIZE = 64;

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { dryRun: false, kinds: [], limit: null, concurrency: 4 };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--kind=')) args.kinds.push(arg.slice('--kind='.length));
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.slice('--concurrency='.length));
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));

const ALL_KINDS = [
  'signal', 'candidate', 'scan_item', 'intel_item', 'intel_fact',
  'paper', 'claim', 'bridge', 'stance', 'concept', 'thread',
];
for (const k of args.kinds) {
  if (!ALL_KINDS.includes(k)) {
    console.error(`Unknown --kind=${k}. Valid kinds: ${ALL_KINDS.join(', ')}`);
    process.exit(1);
  }
}
const kinds = args.kinds.length ? args.kinds : ALL_KINDS;
console.log(`backfill-embeddings: ${args.dryRun ? 'DRY RUN (read-only)' : 'LIVE'}, kinds=${kinds.join(', ')}, model=${EMBED_MODEL}, limit=${args.limit ?? 'none'}, concurrency=${args.concurrency}\n`);

// ------------------------------------------------------------------ db client
// A Pool, not a single Client: FETCHERS run sequentially but the per-record
// embed/upsert work runs with --concurrency workers sharing one connection
// would interleave queries on a single Client (pg deprecation warning, and a
// real correctness risk); the pool gives each worker its own connection.
const poolOpts = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    };
const client = new pg.Pool({ ...poolOpts, max: Math.max(2, args.concurrency + 1) });

const j = (...xs) => xs.filter((x) => x != null && String(x).trim()).join('\n\n');
const stripHtml = (s) => (s ? String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null);

// Each fetcher mirrors ONE assembler in lib/embed/sources.ts, same predicate.
const limitClause = () => (Number.isFinite(args.limit) && args.limit > 0 ? ` limit ${Math.floor(args.limit)}` : '');

const FETCHERS = {
  // mirrors embeddableSignals
  async signal() {
    const { rows } = await client.query(
      `select id::text as id, title, summary,
              brief->>'what_happened' as what_happened,
              brief->>'why_it_matters' as why_it_matters,
              brief->>'whats_contested' as whats_contested,
              counterpoint->>'the_other_read' as counterpoint
         from signals where is_published = true${limitClause()}`
    );
    return rows.map((r) => ({
      record_id: r.id, title: r.title,
      text: j(r.summary, r.what_happened, r.why_it_matters, r.whats_contested, r.counterpoint),
    }));
  },
  // mirrors embeddableCandidates
  async candidate() {
    const { rows } = await client.query(
      `select sc.id::text as id, g.title, sc.raw_content
         from signal_candidates sc
         join signals g on g.id = sc.signal_id and g.is_published = true
        where sc.raw_content is not null${limitClause()}`
    );
    return rows.filter((r) => (r.raw_content ?? '').trim())
      .map((r) => ({ record_id: r.id, title: r.title, text: r.raw_content ?? '' }));
  },
  // mirrors embeddableScanItems
  async scan_item() {
    const { rows } = await client.query(
      `select id::text as id, headline, summary, raw_content from scan_items where raw_content is not null${limitClause()}`
    );
    return rows.filter((r) => (r.raw_content ?? '').trim())
      .map((r) => ({ record_id: r.id, title: r.headline ?? 'Scan item', text: j(r.headline, r.summary, r.raw_content) }));
  },
  // mirrors embeddableIntelItems
  async intel_item() {
    const { rows } = await client.query(
      `select id::text as id, headline, summary, raw_content from intel_items where raw_content is not null${limitClause()}`
    );
    return rows.filter((r) => (r.raw_content ?? '').trim())
      .map((r) => ({ record_id: r.id, title: r.headline ?? 'Intel item', text: j(r.headline, r.summary, r.raw_content) }));
  },
  // mirrors embeddableIntelFacts
  async intel_fact() {
    const { rows } = await client.query(
      `select id::text as id, fact, value_text, dimension, company_slug from intel_facts${limitClause()}`
    );
    return rows.map((r) => ({
      record_id: r.id, title: `${r.company_slug}: ${r.dimension}`,
      text: j(r.fact, r.value_text, `dimension: ${r.dimension}`, `company: ${r.company_slug}`),
    }));
  },
  // mirrors embeddablePapers
  async paper() {
    const { rows } = await client.query(
      `select id::text as id, title, abstract, extraction
         from papers where triage_status = 'kept' and review_status <> 'dismissed'${limitClause()}`
    );
    return rows.map((r) => {
      const ex = r.extraction ?? {};
      const field = (k) => (typeof ex[k] === 'string' ? ex[k] : null);
      return {
        record_id: r.id, title: r.title,
        text: j(r.abstract, field('headline_claim'), field('the_test'), field('effect_size'), field('limitations'), field('counterpoint'), field('econ_implication')),
      };
    });
  },
  // mirrors embeddableClaims
  async claim() {
    const { rows } = await client.query(
      `select code, statement, test from claims where code is not null and is_frame = false${limitClause()}`
    );
    return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
  },
  // mirrors embeddableBridges
  async bridge() {
    const { rows } = await client.query(
      `select code, statement, test from bridge_claims where code is not null${limitClause()}`
    );
    return rows.map((r) => ({ record_id: r.code, title: r.code, text: j(r.statement, r.test) }));
  },
  // mirrors embeddableStances
  async stance() {
    const { rows } = await client.query(
      `select code, title, summary, test from stances where code is not null${limitClause()}`
    );
    return rows.map((r) => ({ record_id: r.code, title: r.title, text: j(r.title, r.summary, r.test) }));
  },
  // mirrors embeddableConcepts
  async concept() {
    const { rows } = await client.query(
      `select slug, name, short_definition, explanation from concepts${limitClause()}`
    );
    return rows.map((r) => ({ record_id: r.slug, title: r.name, text: j(r.short_definition, r.explanation) }));
  },
  // mirrors embeddableThreads
  async thread() {
    const { rows } = await client.query(
      `select slug, title, question, synthesis from research_threads${limitClause()}`
    );
    return rows.map((r) => ({ record_id: r.slug, title: r.title, text: j(r.question, stripHtml(r.synthesis)) }));
  },
};

// -------------------------------------------------------------- embedding call
async function embedBatch(texts, retried = false) {
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
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`OpenRouter embeddings ${res.status}: ${body.slice(0, 200)}`);
    if (!body.trim()) throw new Error('OpenRouter embeddings: empty response body');
    const data = JSON.parse(body);
    if (data.error?.message) throw new Error(`OpenRouter embeddings: ${String(data.error.message).slice(0, 200)}`);
    const items = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
    if (items.length !== texts.length) throw new Error(`expected ${texts.length} vectors, got ${items.length}`);
    return { vectors: items.map((x) => x.embedding), usage: data.usage ?? {}, wallMs: Date.now() - t0 };
  } catch (e) {
    if (!retried) return embedBatch(texts, true);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function recordCost(usage, wallMs) {
  try {
    const input = Number(usage?.prompt_tokens ?? usage?.total_tokens) || 0;
    const { rows } = await client.query(
      `select id, input_per_mtok, context_window from ai_rate_cards
        where model = $1 and effective_date <= current_date
        order by effective_date desc limit 1`,
      [EMBED_MODEL]
    );
    const rate = rows[0] ?? null;
    const M = 1_000_000;
    const cost = rate ? (input / M) * Number(rate.input_per_mtok) : 0;
    const contextPct = rate && rate.context_window > 0 ? Math.min(100, Math.max(0, (input / rate.context_window) * 100)) : null;
    await client.query(
      `insert into ai_cost_log
         (feature, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
          wall_ms, context_pct, cost_usd, rate_card_id, pipeline_run_id, metadata)
       values ($1,$2,$3,0,0,0,$4,$5,$6,$7,null,$8::jsonb)`,
      [EMBED_FEATURE, EMBED_MODEL, input, Math.max(0, Math.round(wallMs)), contextPct, cost, rate?.id ?? null,
        JSON.stringify({ script: 'backfill-embeddings' })]
    );
    return cost;
  } catch (e) {
    console.warn(`  (cost log insert failed, continuing: ${e.message})`);
    return 0;
  }
}

// -------------------------------------------------------------- upsert
async function existingHashes(kind, recordId) {
  const { rows } = await client.query(
    `select chunk_no, text_hash from embeddings where kind = $1 and record_id = $2 and model = $3`,
    [kind, recordId, EMBED_MODEL]
  );
  return new Map(rows.map((r) => [r.chunk_no, r.text_hash]));
}

async function upsertChunk(kind, recordId, chunk, vec) {
  await client.query(
    `insert into embeddings (kind, record_id, chunk_no, model, text_hash, vec)
     values ($1,$2,$3,$4,$5,$6::vector)
     on conflict (kind, record_id, chunk_no, model)
     do update set text_hash = excluded.text_hash, vec = excluded.vec, created_at = now()`,
    [kind, recordId, chunk.chunk_no, EMBED_MODEL, chunk.text_hash, `[${vec.join(',')}]`]
  );
}

async function deleteStaleChunks(kind, recordId, maxChunkNo) {
  const { rowCount } = await client.query(
    `delete from embeddings where kind = $1 and record_id = $2 and model = $3 and chunk_no > $4`,
    [kind, recordId, EMBED_MODEL, maxChunkNo]
  );
  return rowCount ?? 0;
}

// -------------------------------------------------------------- pool + main
async function runPool(items, size, worker) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) || 1 }, () => next()));
}

const totals = { records: 0, chunks: 0, embedded: 0, skipped: 0, removed: 0, spendUsd: 0, errors: 0 };
const perKind = {};

for (const kind of kinds) {
  const records = await FETCHERS[kind]();
  totals.records += records.length;
  const stats = { records: records.length, chunks: 0, embedded: 0, skipped: 0, removed: 0 };
  perKind[kind] = stats;
  console.log(`${kind}: ${records.length} embeddable record(s)`);

  if (args.dryRun) {
    let dryChunks = 0;
    for (const rec of records) dryChunks += chunkRecord({ title: rec.title, text: rec.text }).length;
    stats.chunks = dryChunks;
    totals.chunks += dryChunks;
    console.log(`  would produce ${dryChunks} chunk(s)`);
    continue;
  }

  await runPool(records, args.concurrency, async (rec) => {
    const built = chunkRecord({ title: rec.title, text: rec.text });
    stats.chunks += built.length;
    if (!built.length) return;

    const existing = await existingHashes(kind, rec.record_id);
    const toEmbed = built.filter((c) => existing.get(c.chunk_no) !== c.text_hash);
    stats.skipped += built.length - toEmbed.length;

    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      try {
        const { vectors, usage, wallMs } = await embedBatch(batch.map((c) => c.text));
        totals.spendUsd += await recordCost(usage, wallMs);
        for (let k = 0; k < batch.length; k++) {
          await upsertChunk(kind, rec.record_id, batch[k], vectors[k]);
          stats.embedded += 1;
        }
      } catch (e) {
        totals.errors += 1;
        console.warn(`  embed failed (${kind} ${rec.record_id}): ${e.message}`);
      }
    }

    const maxChunkNo = built.length - 1;
    stats.removed += await deleteStaleChunks(kind, rec.record_id, maxChunkNo);
  });

  totals.chunks += stats.chunks;
  totals.embedded += stats.embedded;
  totals.skipped += stats.skipped;
  totals.removed += stats.removed;
  console.log(`  ${stats.chunks} chunk(s): ${stats.embedded} embedded, ${stats.skipped} unchanged (skipped), ${stats.removed} stale removed`);
}

console.log('\n=== Summary ===');
for (const [kind, s] of Object.entries(perKind)) {
  console.log(`  ${kind}: ${s.records} record(s), ${s.chunks} chunk(s)${args.dryRun ? '' : `, ${s.embedded} embedded, ${s.skipped} skipped, ${s.removed} removed`}`);
}
console.log(`total records: ${totals.records}`);
console.log(`total chunks: ${totals.chunks}`);
if (!args.dryRun) {
  console.log(`total embedded: ${totals.embedded}`);
  console.log(`total skipped (unchanged): ${totals.skipped}`);
  console.log(`total stale removed: ${totals.removed}`);
  console.log(`errors: ${totals.errors}`);
  console.log(`spend this run: $${totals.spendUsd.toFixed(4)}`);
}
console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();
process.exit(totals.errors > 0 ? 1 : 0);
