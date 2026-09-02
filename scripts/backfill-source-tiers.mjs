// One-time backfill for source_tiers (migration 0052): stamps every existing
// scan_items/intel_items row's source_tier/source_kind from the rules +
// whatever is already in source_tiers, then rates whatever the rules
// genuinely don't cover through the utility model, so the long tail catches
// up without waiting for it to reappear in a live run.
//
// Loading constraint: lib/scan/llm.ts and lib/dossier.ts both import '../cost'
// / './cost' WITHOUT the explicit .ts extension Node's type stripping needs,
// so neither module's chain resolves under plain Node (verified: `node -e
// "import('./lib/scan/llm.ts')"` fails with "Cannot find module '.../cost'").
// This script therefore does NOT import lib/scan/source-rating.ts (which
// pulls in that chain via lib/dossier.ts/lib/scan/llm.ts) or
// lib/data/scan.ts / lib/mutations/scan.ts (which import '../db' the same
// extensionless way, per their own house rule: don't rewrite their import
// style to make a script loadable). Instead:
//   - the rule engine + pure validator come from lib/scan/source-tiers.ts and
//     lib/scan/source-rating-core.ts (both dependency-light, Node-loadable);
//   - the stamp/upsert SQL is the same two queries lib/mutations/scan.ts runs,
//     copied here against a raw pg client;
//   - the model call is a minimal local fetch to OpenRouter's chat
//     completions endpoint (same request shape as lib/scan/llm.ts's
//     chatJSONOpenRouter, JSON mode), with the SAME system/user prompt text
//     as lib/scan/source-rating.ts (kept in sync by hand: if you change one,
//     change the other) and the SAME acceptance function
//     (acceptDomainRatings) deciding what gets written;
//   - the cost row is a direct insert into ai_cost_log mirroring
//     lib/cost.ts's recordApiCall, priced from ai_rate_cards or $0 if the
//     model has no card.
//
// Flags:
//   --dry-run          read-only: stamps and rates NOTHING, only reports what
//                       would happen. Safe to run against the live DB.
//   --max-calls=N       model-rating batches of 25 domains per table (default 20)
//   --table=<name>      scan_items | intel_items (default: both)
//
// Run: node scripts/backfill-source-tiers.mjs --dry-run   (loads .env.local)

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import {
  rateDomainByRule, normalizeDomain, SOURCE_KINDS, isSourceTier, isSourceKind,
} from '../lib/scan/source-tiers.ts';
import { acceptDomainRatings } from '../lib/scan/source-rating-core.ts';
import { extractJsonObject } from '../lib/scan/core.ts';

const scriptStart = Date.now();
const RATING_FEATURE = 'scan_source_rating';
const MAX_DOMAINS_PER_CALL = 25; // 40 overran the qwen token cap (unterminated JSON)
const FALLBACK_RATING_MODEL = 'deepseek/deepseek-v4-flash'; // the 0047 cross-model retry
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_RATING_MODEL = 'qwen/qwen3.7-flash'; // mirrors lib/pipeline/config.ts DEFAULT_UTILITY_MODEL

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = { dryRun: false, maxCalls: 20, tables: ['scan_items', 'intel_items'] };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--max-calls=')) args.maxCalls = Number(arg.slice('--max-calls='.length));
    else if (arg.startsWith('--table=')) {
      const t = arg.slice('--table='.length);
      if (t !== 'scan_items' && t !== 'intel_items') {
        console.error(`--table must be scan_items or intel_items, got: ${t}`);
        process.exit(1);
      }
      args.tables = [t];
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(args.maxCalls) || args.maxCalls <= 0) {
    console.error('--max-calls must be a positive number.');
    process.exit(1);
  }
  return args;
}
const args = parseArgs(process.argv.slice(2));
console.log(`backfill-source-tiers: ${args.dryRun ? 'DRY RUN (read-only)' : 'LIVE'}, tables=${args.tables.join(',')}, maxCalls=${args.maxCalls}\n`);

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

// ---------------------------------------------------------- the same two queries
// as lib/data/scan.ts's getUnstampedDomains, run against the WHOLE table (no
// run scoping: this is a one-time catch-up, not a per-run pass).
async function getUnstampedDomains(table, limit = 100_000) {
  const { rows } = await client.query(
    `select source_domain as domain, max(headline) as sample_headline, count(*)::int as items
       from ${table}
      where source_tier is null and source_domain is not null and btrim(source_domain) <> ''
      group by source_domain
      order by items desc, source_domain
      limit $1`,
    [limit]
  );
  return rows;
}

async function getSourceTierRows(domains) {
  if (!domains.length) return [];
  const { rows } = await client.query(
    `select domain, tier, kind, rated_by from source_tiers where domain = any($1::text[])`,
    [domains]
  );
  return rows;
}

// Mirrors lib/mutations/scan.ts's stampSourceTiers: rules first, then the
// already-rated table. Returns the number of item rows stamped.
async function stampTable(table) {
  const domains = await getUnstampedDomains(table);
  if (!domains.length) return 0;
  const unknown = [];
  const groups = new Map(); // `${tier}:${kind}` -> domains
  for (const d of domains) {
    const rule = rateDomainByRule(d.domain);
    if (rule) {
      const key = `${rule.tier}:${rule.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), d.domain]);
    } else {
      unknown.push(d.domain);
    }
  }
  if (unknown.length) {
    const rated = await getSourceTierRows(unknown.map(normalizeDomain));
    const byDomain = new Map(rated.map((r) => [r.domain, r]));
    for (const raw of unknown) {
      const r = byDomain.get(normalizeDomain(raw));
      if (!r) continue;
      const key = `${r.tier}:${r.kind}`;
      groups.set(key, [...(groups.get(key) ?? []), raw]);
    }
  }
  let stamped = 0;
  for (const [key, list] of groups) {
    const [tier, kind] = key.split(':');
    const { rowCount } = await client.query(
      `update ${table} set source_tier = $1, source_kind = $2
        where source_tier is null and source_domain = any($3::text[])`,
      [Number(tier), kind, list]
    );
    stamped += rowCount;
  }
  return stamped;
}

// Mirrors lib/mutations/scan.ts's upsertSourceTiers.
async function upsertSourceTiers(rows) {
  let n = 0;
  for (const r of rows) {
    const domain = normalizeDomain(r.domain);
    if (!domain || !isSourceTier(r.tier) || !isSourceKind(r.kind)) continue;
    const { rowCount } = await client.query(
      `insert into source_tiers (domain, tier, kind, rated_by, reason, sample_headline)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (domain) do update
         set tier = excluded.tier, kind = excluded.kind, rated_by = excluded.rated_by,
             reason = excluded.reason, sample_headline = coalesce(excluded.sample_headline, source_tiers.sample_headline),
             updated_at = now()
       where source_tiers.rated_by <> 'human' or excluded.rated_by = 'human'`,
      [domain, r.tier, r.kind, r.rated_by, r.reason?.slice(0, 300) ?? null, r.sample_headline?.slice(0, 300) ?? null]
    );
    n += rowCount;
  }
  return n;
}

// -------------------------------------------------------------- the rating prompt
// Kept in sync BY HAND with lib/scan/source-rating.ts's SYSTEM/schema text
// (the module chain that owns them cannot load under plain Node: see the
// header comment above).
const KIND_DEFS = `regulator    government, central banks, supervisors, courts, statistics agencies
primary      the company or lab itself: newsrooms, IR pages, official blogs
research     research houses, pollsters, academic and policy institutes
wire         Reuters, AP, AFP and similar wire services
major        national and international news organizations
trade        sector trade press (banking, payments, fintech, legal)
tech_press   technology press
general      regional and general-interest outlets of unknown quality
aggregator   syndication and aggregation front ends
pr_wire      press-release distribution wires
blog         blogging platforms and personal sites
social       social networks and forums
promo        stock-tip, crypto-promo, SEO and content-farm sites
unknown      you genuinely cannot tell what this domain is`;

const SYSTEM = `You rate the RELIABILITY of news and content domains for a financial services and technology intelligence system. For each domain you receive, with one sample headline it produced, classify it into exactly one KIND and a reliability TIER from 1 (most reliable) to 4 (least reliable).

KINDS:
${KIND_DEFS}

Tier anchors by kind: regulator, primary, research, and wire default to tier 1. major, trade, and tech_press default to tier 2. general, aggregator, blog, pr_wire, and unknown default to tier 3. social and promo default to tier 4.

You may rate a domain one tier WORSE than its kind's default when you recognize a known-weak instance of that kind (a tabloid dressed as a major outlet, a content farm dressed as a trade magazine). Never rate a domain BETTER than its kind's default tier. When you genuinely cannot tell what a domain is, use kind "unknown" at tier 3 rather than guessing a stronger kind.

Give a one-sentence reason for the kind and tier you chose, grounded in what the domain and its sample headline suggest. Never use an em dash in any text you write.

Reply with ONLY a single JSON object, no prose and no code fence, with exactly one key:
  "ratings": array of objects {"domain": one of the exact domains listed, "kind": one of ${SOURCE_KINDS.join(', ')}, "tier": integer 1 to 4, "reason": one sentence}`;

function domainListText(candidates) {
  return candidates
    .map((c) => `${c.domain} :: ${(c.sample_headline ?? '(no sample headline)').slice(0, 200)}`)
    .join('\n');
}

// Minimal local fetch to OpenRouter, the same request shape as
// lib/scan/llm.ts's chatJSONOpenRouter (JSON mode, reasoning disabled first,
// one bounded retry with reasoning capped if the endpoint refuses to disable
// it). Returns { ratings, usage }.
async function rateDomainsOpenRouter(candidates, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
  const user = `DOMAINS TO RATE (one per line, "domain :: sample headline"):\n${domainListText(candidates)}`;

  const attempt = async (mode) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: mode === 'off' ? 4000 : 4500,
          response_format: { type: 'json_object' },
          reasoning: mode === 'off' ? { enabled: false } : { max_tokens: 400 },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: user },
          ],
        }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
      if (!body.trim()) throw new Error('OpenRouter: empty response body');
      const data = JSON.parse(body);
      if (data.error?.message) throw new Error(`OpenRouter: ${String(data.error.message).slice(0, 200)}`);
      const content = data.choices?.[0]?.message?.content ?? '';
      return { ratings: extractJsonObject(content), usage: data.usage ?? {} };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return { ...(await attempt('off')), model };
  } catch (e) {
    if (/reasoning is mandatory/i.test(String(e?.message))) return { ...(await attempt('bounded')), model };
    // A 429 or a truncated reply on the primary rarely repeats on the fallback
    // in the same minute (the 0047 cross-model retry pattern).
    if (model !== FALLBACK_RATING_MODEL) {
      const r = await rateDomainsOpenRouter(candidates, FALLBACK_RATING_MODEL);
      return { ...r, model: FALLBACK_RATING_MODEL };
    }
    throw e;
  }
}

// Mirrors lib/cost.ts's recordApiCall: price from the active rate card (or
// $0 with no card), insert one ai_cost_log row. Never throws (best-effort
// telemetry, same discipline as the app).
async function recordCost(model, usage, wallMs, table) {
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
      [RATING_FEATURE, model, input, output, Math.max(0, Math.round(wallMs)), contextPct, cost, rate?.id ?? null,
        JSON.stringify({ script: 'backfill-source-tiers', table })]
    );
  } catch (e) {
    console.warn(`  (cost log insert failed, continuing: ${e.message})`);
  }
}

// ---------------------------------------------------------------- per-table run
async function runTable(table) {
  console.log(`=== ${table} ===`);

  if (args.dryRun) {
    const domains = await getUnstampedDomains(table);
    const unknown = domains.filter((d) => rateDomainByRule(d.domain) === null);
    const knownByTable = await getSourceTierRows(unknown.map((d) => normalizeDomain(d.domain)));
    const stillUnrated = unknown.filter((d) => !knownByTable.some((r) => r.domain === normalizeDomain(d.domain)));
    console.log(`  unstamped items cover ${domains.length} distinct domain(s)`);
    console.log(`  ${domains.length - unknown.length} would rule-stamp; ${unknown.length - stillUnrated.length} already rated in source_tiers; ${stillUnrated.length} would need a model rating`);
    const calls = Math.min(args.maxCalls, Math.ceil(stillUnrated.length / MAX_DOMAINS_PER_CALL));
    const wouldRate = Math.min(stillUnrated.length, calls * MAX_DOMAINS_PER_CALL);
    console.log(`  would issue ${calls} model call(s) covering ${wouldRate} of ${stillUnrated.length} unrated domain(s)`);
    if (stillUnrated.length) {
      console.log(`  sample: ${stillUnrated.slice(0, 10).map((d) => d.domain).join(', ')}${stillUnrated.length > 10 ? ', …' : ''}`);
    }
    return { stamped: 0, rated: 0 };
  }

  const stamped1 = await stampTable(table);
  const unrated = (await getUnstampedDomains(table)).filter((d) => rateDomainByRule(d.domain) === null);
  console.log(`  rule/table stamp: ${stamped1} item rows`);
  console.log(`  ${unrated.length} domain(s) need a model rating`);

  let rated = 0;
  const model = process.env.OPENROUTER_API_KEY ? DEFAULT_RATING_MODEL : null;
  if (unrated.length && !model) {
    console.log('  OPENROUTER_API_KEY not set: skipping model rating (rule-based stamping only).');
  } else if (unrated.length) {
    for (let call = 0; call < args.maxCalls && call * MAX_DOMAINS_PER_CALL < unrated.length; call++) {
      const batch = unrated.slice(call * MAX_DOMAINS_PER_CALL, (call + 1) * MAX_DOMAINS_PER_CALL);
      const t0 = Date.now();
      try {
        const { ratings, usage, model: used } = await rateDomainsOpenRouter(batch, model);
        await recordCost(used ?? model, usage, Date.now() - t0, table);
        const rows = acceptDomainRatings(ratings, batch);
        const n = await upsertSourceTiers(rows);
        rated += n;
        console.log(`  call ${call + 1}: rated ${n} of ${batch.length} domains`);
      } catch (e) {
        console.warn(`  call ${call + 1} failed: ${e.message}`);
      }
    }
  }

  let stamped2 = 0;
  if (rated) stamped2 = await stampTable(table);
  const totalStamped = stamped1 + stamped2;
  console.log(`  total: ${totalStamped} item rows stamped, ${rated} domains model-rated`);
  return { stamped: totalStamped, rated };
}

const totals = { stamped: 0, rated: 0 };
for (const table of args.tables) {
  const r = await runTable(table);
  totals.stamped += r.stamped;
  totals.rated += r.rated;
  console.log('');
}

console.log('=== Summary ===');
console.log(`stamped: ${totals.stamped} item rows across ${args.tables.join(', ')}`);
console.log(`rated: ${totals.rated} domains`);

if (!args.dryRun) {
  const { rows } = await client.query(
    `select coalesce(sum(cost_usd), 0)::float as usd, count(*)::int as calls
       from ai_cost_log where feature = $1 and created_at >= $2`,
    [RATING_FEATURE, new Date(scriptStart).toISOString()]
  );
  console.log(`model spend this run: $${(rows[0]?.usd ?? 0).toFixed(4)} across ${rows[0]?.calls ?? 0} call(s)`);
}

console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);
await client.end();
