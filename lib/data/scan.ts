import { q, one } from '../db';
import type { ScanHealth, ScanRun, ScanTopic } from '../types';
import type { RelevanceVotes } from '../scan/ensemble';

// ---- External Scan (migration 0038) -----------------------------------------
// Reads for the scan engine and the admin console. The whole surface is
// admin-only (the /scan page gates; the cron route gates on CRON_SECRET); the
// ONLY public egress for scan data is the key-gated `external-scan` dataset
// (lib/datasets/builders.ts), which never selects run/lease internals.

// The runtime switches (migrations 0039 + 0041). Missing row = enabled with
// no models selected (the Haiku fallback): the singleton is created lazily by
// the first toggle or picker save.
export async function getScanPrefs(): Promise<{ enabled: boolean; enrich_models: string[] }> {
  const row = await one<{ enabled: boolean; enrich_models: string[] }>(
    `select enabled, enrich_models from scan_prefs where id = true`
  );
  return { enabled: row?.enabled ?? true, enrich_models: row?.enrich_models ?? [] };
}

// The A/B comparison behind the /scan "Model A/B" table: per enriching model
// over the trailing window, quality proxies from scan_items joined with
// latency + spend from ai_cost_log (feature scan_enrich, grouped by model).
// Human judgment stays the real evaluator; these are the measurable halves.
export interface EnrichModelStat {
  model: string;
  items: number;
  errors: number;
  avgRelevance: number | null;
  avgTags: number | null;
  avgSummaryChars: number | null;
  avgWallMs: number | null;
  costUsd: number;
  costPerItem: number | null;
  avgVote: number | null;   // this model's average relevance-ensemble vote, over every item it voted on
  avgBias: number | null;   // that vote average minus the item's median (relevance), same window
}

export async function getEnrichModelStats(days = 30): Promise<EnrichModelStat[]> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const rows = await q<{
    model: string; items: number; errors: number;
    avg_relevance: number | null; avg_tags: number | null; avg_summary_chars: number | null;
    avg_wall_ms: number | null; cost_usd: number | null; calls: number | null;
    avg_vote: number | null; avg_bias: number | null;
  }>(
    `select i.enriched_by as model,
            count(*) filter (where i.enrich_status = 'done')::int as items,
            count(*) filter (where i.enrich_status = 'error')::int as errors,
            round(avg(i.relevance) filter (where i.enrich_status = 'done')::numeric, 2) as avg_relevance,
            round(avg(cardinality(i.tags)) filter (where i.enrich_status = 'done')::numeric, 1) as avg_tags,
            round(avg(length(i.summary)) filter (where i.enrich_status = 'done')::numeric, 0) as avg_summary_chars,
            l.avg_wall_ms, l.cost_usd, l.calls,
            mv.avg_vote, mv.avg_bias
       from scan_items i
       join scan_runs r on r.id = i.run_id and r.day > current_date - $1::interval
       left join (
         select model, round(avg(wall_ms))::int as avg_wall_ms,
                sum(cost_usd)::numeric as cost_usd, count(*)::int as calls
           from ai_cost_log
          where feature = 'scan_enrich' and created_at > now() - $1::interval
          group by model
       ) l on l.model = i.enriched_by
       -- Every panel model's vote across ALL items it voted on in the window,
       -- not just the ones it happened to enrich, so a model that voted a lot
       -- but enriched little still shows its bias against the median.
       left join (
         select vp.key as model,
                round(avg(vp.value::numeric), 2) as avg_vote,
                round(avg(vp.value::numeric - si.relevance), 2) as avg_bias
           from scan_items si
           join scan_runs sr on sr.id = si.run_id and sr.day > current_date - $1::interval,
                jsonb_each_text(si.relevance_votes) as vp
          where si.relevance_votes is not null and si.relevance is not null
          group by vp.key
       ) mv on mv.model = i.enriched_by
      where i.enriched_by is not null
      group by i.enriched_by, l.avg_wall_ms, l.cost_usd, l.calls, mv.avg_vote, mv.avg_bias
      order by items desc, i.enriched_by`,
    [interval]
  );
  return rows.map((r) => ({
    model: r.model,
    items: r.items,
    errors: r.errors,
    avgRelevance: r.avg_relevance,
    avgTags: r.avg_tags === null ? null : Number(r.avg_tags),
    avgSummaryChars: r.avg_summary_chars === null ? null : Number(r.avg_summary_chars),
    avgWallMs: r.avg_wall_ms,
    costUsd: r.cost_usd ?? 0,
    costPerItem: r.calls ? Number(((r.cost_usd ?? 0) / r.calls).toFixed(4)) : null,
    avgVote: r.avg_vote,
    avgBias: r.avg_bias,
  }));
}

// For the /scan Firewall exports panel: how many rows the signals-export
// dataset will carry (its floor is is_published, same as every dataset).
export async function getPublishedSignalCount(): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from signals where is_published = true`
  );
  return row?.n ?? 0;
}

export async function getScanTopics(): Promise<ScanTopic[]> {
  return q<ScanTopic>(
    `select slug, name, description, taxonomy_code, search_queries, feed_urls, active, created_at
       from scan_topics order by taxonomy_code, slug`
  );
}

export async function getActiveScanTopics(): Promise<ScanTopic[]> {
  return q<ScanTopic>(
    `select slug, name, description, taxonomy_code, search_queries, feed_urls, active, created_at
       from scan_topics where active order by taxonomy_code, slug`
  );
}

const RUN_COLUMNS = `
  id::text as id, to_char(day, 'YYYY-MM-DD') as day, status, step, searched_topics,
  feed_item_count, search_item_count, hydrated_count, enriched_count, skipped_count,
  notes, error, created_at, updated_at`;

export async function getScanRun(runId: string): Promise<ScanRun | null> {
  return one<ScanRun>(`select ${RUN_COLUMNS} from scan_runs where id = $1`, [runId]);
}

// Run history for the console, with the per-run model spend joined from the
// cost log via metadata.scan_run (scan calls never set pipeline_run_id: that
// column is FK'd to pipeline_runs).
export async function getScanRuns(limit = 14): Promise<ScanRun[]> {
  return q<ScanRun>(
    `select ${RUN_COLUMNS},
            coalesce((select sum(l.cost_usd) from ai_cost_log l
                       where l.metadata->>'scan_run' = scan_runs.id::text), 0)::numeric as cost_usd
       from scan_runs order by day desc limit $1`,
    [limit]
  );
}

// Engine reads. List reads exclude raw_content (it can be 24k chars per row);
// only the enrichment batch pulls it.
export async function getPendingFetchItems(
  runId: string,
  limit = 8
): Promise<{ id: string; url: string; source_domain: string | null }[]> {
  return q(
    `select id::text as id, url, source_domain from scan_items
      where run_id = $1 and fetch_status = 'pending'
      order by created_at, id limit $2`,
    [runId, limit]
  );
}

export async function getPendingEnrichItems(
  runId: string,
  limit = 8
): Promise<{ id: string; url: string; headline: string | null; source_domain: string | null; raw_content: string }[]> {
  return q(
    `select id::text as id, url, headline, source_domain, coalesce(raw_content, '') as raw_content
       from scan_items
      where run_id = $1 and enrich_status = 'pending' and fetch_status = 'done'
      order by created_at, id limit $2`,
    [runId, limit]
  );
}

// The /scan health panel: one aggregate pass over the trailing window.
// Spend sums ai_cost_log by feature over the same window (created_at based,
// matching the budget guard's semantics). missedDays counts calendar days
// with no run row, measured from the first run ever (or the window start,
// whichever is later) so pre-launch days never count as misses.
export async function getScanHealth(days = 30): Promise<ScanHealth> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const [runAgg, itemAgg, spend, yieldRows, issueRows, firstRun] = await Promise.all([
    one<{ completed: number; failed: number; running: number }>(
      `select count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status = 'running')::int as running
         from scan_runs where day > current_date - $1::interval`,
      [interval]
    ),
    one<{
      total: number; feed: number; search: number; fetch_done: number; fetch_failed: number;
      enrich_done: number; enrich_skipped: number; enrich_error: number;
      avg_relevance: number | null; high_relevance: number; domains: number;
    }>(
      `select count(*)::int as total,
              count(*) filter (where i.discovered_via <> 'web_search')::int as feed,
              count(*) filter (where i.discovered_via = 'web_search')::int as search,
              count(*) filter (where i.fetch_status = 'done')::int as fetch_done,
              count(*) filter (where i.fetch_status = 'failed')::int as fetch_failed,
              count(*) filter (where i.enrich_status = 'done')::int as enrich_done,
              count(*) filter (where i.enrich_status = 'skipped')::int as enrich_skipped,
              count(*) filter (where i.enrich_status = 'error')::int as enrich_error,
              round(avg(i.relevance)::numeric, 2) as avg_relevance,
              count(*) filter (where i.relevance >= 0.7)::int as high_relevance,
              count(distinct i.source_domain)::int as domains
         from scan_items i
         join scan_runs r on r.id = i.run_id
        where r.day > current_date - $1::interval`,
      [interval]
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
        where feature in ('scan_search', 'scan_enrich')
          and created_at > now() - $1::interval`,
      [interval]
    ),
    q<{ slug: string; taxonomy_code: string; name: string; active: boolean; searchable: boolean; has_feeds: boolean; items: number; last_item: string | null }>(
      `select t.slug, t.taxonomy_code, t.name, t.active,
              (t.active and cardinality(t.search_queries) > 0) as searchable,
              cardinality(t.feed_urls) > 0 as has_feeds,
              count(i.id)::int as items,
              to_char(max(r.day), 'YYYY-MM-DD') as last_item
         from scan_topics t
         left join (scan_items i
                    join scan_runs r on r.id = i.run_id
                                    and r.day > current_date - $1::interval)
                on i.topic_slug = t.slug
        group by t.slug, t.taxonomy_code, t.name, t.active, t.search_queries, t.feed_urls
        order by t.taxonomy_code, t.slug`,
      [interval]
    ),
    q<{ day: string; note: string }>(
      `select to_char(day, 'YYYY-MM-DD') as day, n as note
         from scan_runs, unnest(notes) as n
        where day > current_date - $1::interval
        order by day desc
        limit 30`,
      [interval]
    ),
    one<{ first: string | null }>(`select to_char(min(day), 'YYYY-MM-DD') as first from scan_runs`),
  ]);

  // Missed days: WEEKDAYS in [max(first run, window start), today] minus
  // weekdays that have a run row. Weekends are scheduled off (the crons run
  // Mon to Fri), so a quiet Saturday is never a miss; a manual weekend run
  // still counts toward runs/items above. Zero before the first run ever.
  let missedDays = 0;
  if (firstRun?.first) {
    const dayRows = await q<{ n: number }>(
      `select count(*)::int as n from scan_runs
        where day > current_date - $1::interval and extract(isodow from day) < 6`,
      [interval]
    );
    const start = new Date(`${firstRun.first}T00:00:00Z`);
    const windowStart = new Date(Date.now() - days * 86_400_000);
    const from = start > windowStart ? start : windowStart;
    let elapsedWeekdays = 0;
    for (let t = from.getTime(); t <= Date.now(); t += 86_400_000) {
      const dow = new Date(t).getUTCDay();
      if (dow !== 0 && dow !== 6) elapsedWeekdays += 1;
    }
    missedDays = Math.max(0, elapsedWeekdays - (dayRows[0]?.n ?? 0));
  }

  return {
    days,
    runs: {
      completed: runAgg?.completed ?? 0,
      failed: runAgg?.failed ?? 0,
      running: runAgg?.running ?? 0,
      missedDays,
    },
    items: {
      total: itemAgg?.total ?? 0,
      feed: itemAgg?.feed ?? 0,
      search: itemAgg?.search ?? 0,
      fetchDone: itemAgg?.fetch_done ?? 0,
      fetchFailed: itemAgg?.fetch_failed ?? 0,
      enrichDone: itemAgg?.enrich_done ?? 0,
      enrichSkipped: itemAgg?.enrich_skipped ?? 0,
      enrichError: itemAgg?.enrich_error ?? 0,
      avgRelevance: itemAgg?.avg_relevance ?? null,
      highRelevance: itemAgg?.high_relevance ?? 0,
      domains: itemAgg?.domains ?? 0,
    },
    spendUsd: spend?.usd ?? 0,
    topicYield: yieldRows.map((r) => ({
      slug: r.slug, taxonomy_code: r.taxonomy_code, name: r.name,
      searchable: r.searchable, hasFeeds: r.has_feeds, active: r.active,
      items: r.items, lastItem: r.last_item,
    })),
    issues: issueRows,
  };
}

export async function getScanStepCounts(runId: string): Promise<{
  pendingFetch: number;
  pendingEnrich: number;
}> {
  const row = await one<{ pf: number; pe: number }>(
    `select
       count(*) filter (where fetch_status = 'pending')::int as pf,
       count(*) filter (where enrich_status = 'pending')::int as pe
     from scan_items where run_id = $1`,
    [runId]
  );
  return { pendingFetch: row?.pf ?? 0, pendingEnrich: row?.pe ?? 0 };
}

// ---- Source tiers (migration 0052) ------------------------------------------
// Reads shared by the scan and intel engines (stamping + the once-per-domain
// model rating) and the consoles' read-only "Source tiers" panels.

export type SourceTierTable = 'scan_items' | 'intel_items';
const SOURCE_TIER_TABLES: readonly SourceTierTable[] = ['scan_items', 'intel_items'];
export function assertSourceTierTable(t: string): SourceTierTable {
  if (!(SOURCE_TIER_TABLES as readonly string[]).includes(t)) throw new Error('Bad source-tier table.');
  return t as SourceTierTable;
}

export interface SourceTierRow {
  domain: string;
  tier: number;
  kind: string;
  rated_by: string;
  reason: string | null;
  sample_headline: string | null;
  created_at: string;
}

export async function getSourceTierRows(domains: string[]): Promise<SourceTierRow[]> {
  if (!domains.length) return [];
  return q<SourceTierRow>(
    `select domain, tier, kind, rated_by, reason, sample_headline, to_char(created_at, 'YYYY-MM-DD') as created_at
       from source_tiers where domain = any($1::text[])`,
    [domains]
  );
}

// Distinct domains of not-yet-stamped items (one run, or the whole table when
// runId is null), with a sample headline for the model rater and the item
// count so the biggest unknowns rate first. The caller filters out domains
// the rules already cover (lib/scan/source-tiers.ts rateDomainByRule) and
// domains already in source_tiers.
export async function getUnstampedDomains(
  table: SourceTierTable, runId: string | null, limit = 200
): Promise<{ domain: string; sample_headline: string | null; items: number }[]> {
  const t = assertSourceTierTable(table);
  return q(
    `select source_domain as domain, max(headline) as sample_headline, count(*)::int as items
       from ${t}
      where source_tier is null and source_domain is not null and btrim(source_domain) <> ''
        ${runId ? 'and run_id = $2' : ''}
      group by source_domain
      order by items desc, source_domain
      limit $1`,
    runId ? [limit, runId] : [limit]
  );
}

export interface SourceTierStats {
  byTier: { tier: number | null; items: number }[]; // null = unstamped
  byKind: { kind: string | null; items: number }[];
  modelRated: number;
  ruleRated: number;
}

// The console panel: tier and kind distribution over the trailing window plus
// how many stamped items came from the model-rated table vs the rules.
export async function getSourceTierStats(table: SourceTierTable, days = 30): Promise<SourceTierStats> {
  const t = assertSourceTierTable(table);
  const interval = `${Math.max(1, Math.round(days))} days`;
  const [byTier, byKind, split] = await Promise.all([
    q<{ tier: number | null; items: number }>(
      `select source_tier as tier, count(*)::int as items from ${t}
        where created_at > now() - $1::interval group by 1 order by 1 nulls last`,
      [interval]
    ),
    q<{ kind: string | null; items: number }>(
      `select source_kind as kind, count(*)::int as items from ${t}
        where created_at > now() - $1::interval group by 1 order by 2 desc`,
      [interval]
    ),
    one<{ model_rated: number; rule_rated: number }>(
      `select count(*) filter (where st.domain is not null)::int as model_rated,
              count(*) filter (where st.domain is null)::int as rule_rated
         from ${t} i left join source_tiers st on st.domain = i.source_domain
        where i.created_at > now() - $1::interval and i.source_tier is not null`,
      [interval]
    ),
  ]);
  return { byTier, byKind, modelRated: split?.model_rated ?? 0, ruleRated: split?.rule_rated ?? 0 };
}

export async function getRecentSourceTiers(limit = 40): Promise<SourceTierRow[]> {
  return q<SourceTierRow>(
    `select domain, tier, kind, rated_by, reason, sample_headline, to_char(created_at, 'YYYY-MM-DD') as created_at
       from source_tiers order by created_at desc, domain limit $1`,
    [limit]
  );
}

// ---- Relevance ensemble (migration 0053) ------------------------------------

// Enriched items that still owe votes from some panel model: the engine's
// per-run top-up and the backfill both read this. The caller decides which
// panel models are missing (lib/scan/ensemble.ts missingVoters).
export async function getItemsMissingVotes(
  runId: string | null, panelSize: number, limit = 8
): Promise<{
  id: string; url: string; headline: string | null; source_domain: string | null;
  raw_content: string; enriched_by: string | null; relevance: number | null; relevance_votes: RelevanceVotes | null;
}[]> {
  return q(
    `select id::text as id, url, headline, source_domain, coalesce(raw_content, '') as raw_content,
            enriched_by, relevance, relevance_votes
       from scan_items
      where enrich_status = 'done' and raw_content is not null
        and (relevance_votes is null or (select count(*) from jsonb_object_keys(relevance_votes)) < $1)
        ${runId ? 'and run_id = $3' : ''}
      order by created_at desc, id limit $2`,
    runId ? [panelSize, limit, runId] : [panelSize, limit]
  );
}

export interface RelevanceEnsembleStats {
  days: number;
  enriched: number;          // enriched items in the window
  fullyVoted: number;        // items with every panel model's vote
  anyVotes: number;          // items with at least two votes
  avgSpread: number | null;
  perModel: { model: string; votes: number; avgVote: number | null; avgBias: number | null }[]; // bias = vote - median
  topDisagreements: { id: string; url: string; headline: string | null; source_domain: string | null; votes: RelevanceVotes; spread: number }[];
}

export async function getRelevanceEnsembleStats(days = 30, panelSize = 3): Promise<RelevanceEnsembleStats> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const [totals, perModel, top] = await Promise.all([
    one<{ enriched: number; fully: number; any: number; avg_spread: number | null }>(
      `select count(*)::int as enriched,
              count(*) filter (where relevance_votes is not null and (select count(*) from jsonb_object_keys(relevance_votes)) >= $2)::int as fully,
              count(*) filter (where relevance_votes is not null and (select count(*) from jsonb_object_keys(relevance_votes)) >= 2)::int as any,
              round(avg(relevance_spread)::numeric, 2) as avg_spread
         from scan_items i join scan_runs r on r.id = i.run_id
        where i.enrich_status = 'done' and r.day > current_date - $1::interval`,
      [interval, panelSize]
    ),
    q<{ model: string; votes: number; avg_vote: number | null; avg_bias: number | null }>(
      `select v.key as model, count(*)::int as votes,
              round(avg(v.value::numeric), 2) as avg_vote,
              round(avg(v.value::numeric - i.relevance), 2) as avg_bias
         from scan_items i join scan_runs r on r.id = i.run_id,
              jsonb_each_text(i.relevance_votes) as v
        where i.relevance_votes is not null and i.relevance is not null
          and r.day > current_date - $1::interval
        group by v.key order by votes desc, v.key`,
      [interval]
    ),
    q<{ id: string; url: string; headline: string | null; source_domain: string | null; votes: RelevanceVotes; spread: number }>(
      `select i.id::text as id, i.url, i.headline, i.source_domain, i.relevance_votes as votes, i.relevance_spread as spread
         from scan_items i join scan_runs r on r.id = i.run_id
        where i.relevance_spread is not null and r.day > current_date - $1::interval
        order by i.relevance_spread desc, i.created_at desc limit 10`,
      [interval]
    ),
  ]);
  return {
    days,
    enriched: totals?.enriched ?? 0,
    fullyVoted: totals?.fully ?? 0,
    anyVotes: totals?.any ?? 0,
    avgSpread: totals?.avg_spread ?? null,
    perModel: perModel.map((r) => ({ model: r.model, votes: r.votes, avgVote: r.avg_vote, avgBias: r.avg_bias })),
    topDisagreements: top,
  };
}
