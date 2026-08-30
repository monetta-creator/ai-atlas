import { q, one } from '../db';
import type { IntelCompany, IntelRun, IntelPrefs, IntelTier, IntelMetricSource } from '../types';

// ---- Intel Desk (migration 0043) --------------------------------------------
// Reads for the collection engine and the admin console. The whole surface is
// admin-only; nothing here is exported publicly (the datasets route is the
// only egress, and it reads its own projection separately).

// The runtime switches. Missing row = enabled with no models selected (the
// Haiku fallback): the singleton is created lazily by the first toggle or
// picker save (the migration also seeds it, so this is a defensive fallback).
export async function getIntelPrefs(): Promise<IntelPrefs> {
  const row = await one<{ enabled: boolean; enrich_models: string[]; utility_model: string | null }>(
    `select enabled, enrich_models, utility_model from intel_prefs where id = true`
  );
  return {
    enabled: row?.enabled ?? true,
    enrich_models: row?.enrich_models ?? [],
    utility_model: row?.utility_model ?? null,
  };
}

const COMPANY_COLUMNS = `
  slug, name, tier, niche, ticker, cik, rssd_id, fdic_cert, lei, domain,
  aliases, feed_urls, search_queries, active, dossier, notes, created_at, updated_at`;

export async function getIntelCompanies(): Promise<IntelCompany[]> {
  return q<IntelCompany>(`select ${COMPANY_COLUMNS} from intel_companies order by tier, slug`);
}

// Active only, ordered by slug (not tier): a stable order matters here since
// the search leg's every-Nth-day rotation (lib/intel/core.ts searchDueSlugs)
// indexes into this list by position.
export async function getActiveIntelCompanies(): Promise<IntelCompany[]> {
  return q<IntelCompany>(`select ${COMPANY_COLUMNS} from intel_companies where active order by slug`);
}

const RUN_COLUMNS = `
  id::text as id, to_char(day, 'YYYY-MM-DD') as day, status, step, swept_units,
  feed_item_count, search_item_count, filing_item_count, hydrated_count, enriched_count,
  skipped_count, fact_count, metric_count, notes, error, created_at, updated_at`;

export async function getIntelRun(runId: string): Promise<IntelRun | null> {
  return one<IntelRun>(`select ${RUN_COLUMNS} from intel_runs where id = $1`, [runId]);
}

export async function getIntelRunByDay(day: string): Promise<IntelRun | null> {
  return one<IntelRun>(`select ${RUN_COLUMNS} from intel_runs where day = $1::date`, [day]);
}

// Run history for the console, with the per-run model spend joined from the
// cost log via metadata.intel_run (intel calls never set pipeline_run_id:
// that column is FK'd to pipeline_runs).
export async function getIntelRuns(limit = 14): Promise<IntelRun[]> {
  return q<IntelRun>(
    `select ${RUN_COLUMNS},
            coalesce((select sum(l.cost_usd) from ai_cost_log l
                       where l.metadata->>'intel_run' = intel_runs.id::text
                         and l.feature in ('intel_enrich', 'intel_synthesis')), 0)::numeric as cost_usd
       from intel_runs order by day desc limit $1`,
    [limit]
  );
}

// Engine reads. List reads exclude raw_content (it can be tens of thousands of
// chars per row); only the enrichment batch pulls it.
export async function getPendingIntelFetchItems(
  runId: string,
  limit = 8
): Promise<{ id: string; url: string; source_domain: string | null }[]> {
  return q(
    `select id::text as id, url, source_domain from intel_items
      where run_id = $1 and fetch_status = 'pending'
      order by created_at, id limit $2`,
    [runId, limit]
  );
}

export async function getPendingIntelEnrichItems(
  runId: string,
  limit = 8
): Promise<{ id: string; url: string; headline: string | null; source_domain: string | null; raw_content: string }[]> {
  return q(
    `select id::text as id, url, headline, source_domain, coalesce(raw_content, '') as raw_content
       from intel_items
      where run_id = $1 and enrich_status = 'pending' and fetch_status = 'done'
      order by created_at, id limit $2`,
    [runId, limit]
  );
}

export async function getIntelStepCounts(runId: string): Promise<{
  pendingFetch: number;
  pendingEnrich: number;
}> {
  const row = await one<{ pf: number; pe: number }>(
    `select
       count(*) filter (where fetch_status = 'pending')::int as pf,
       count(*) filter (where enrich_status = 'pending')::int as pe
     from intel_items where run_id = $1`,
    [runId]
  );
  return { pendingFetch: row?.pf ?? 0, pendingEnrich: row?.pe ?? 0 };
}

// The /intel health panel's aggregate read (window = trailing N days), the
// getScanHealth shape carried over: fetch success and enrichment coverage stay
// raw counts (the panel computes rates), avgSignificance stands in for scan's
// avgRelevance, and factsWritten/metricsWritten are the two collection-yield
// counts scan has no equivalent of.
export interface IntelHealth {
  days: number;
  runs: { completed: number; failed: number; running: number; missedDays: number };
  items: {
    total: number;
    feed: number;
    search: number;
    filing: number;
    fetchDone: number;
    fetchFailed: number;
    enrichDone: number;
    enrichSkipped: number;
    enrichError: number;
    avgSignificance: number | null;
  };
  factsWritten: number;
  metricsWritten: number;
  spendUsd: number;
  issues: { day: string; note: string }[];
}

export async function getIntelHealth(days = 30): Promise<IntelHealth> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const [runAgg, itemAgg, factAgg, metricAgg, spend, issueRows, firstRun] = await Promise.all([
    one<{ completed: number; failed: number; running: number }>(
      `select count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status = 'running')::int as running
         from intel_runs where day > current_date - $1::interval`,
      [interval]
    ),
    one<{
      total: number; feed: number; search: number; filing: number;
      fetch_done: number; fetch_failed: number;
      enrich_done: number; enrich_skipped: number; enrich_error: number;
      avg_significance: number | null;
    }>(
      `select count(*)::int as total,
              count(*) filter (where i.discovered_via = 'feed')::int as feed,
              count(*) filter (where i.discovered_via = 'search')::int as search,
              count(*) filter (where i.discovered_via = 'edgar')::int as filing,
              count(*) filter (where i.fetch_status = 'done')::int as fetch_done,
              count(*) filter (where i.fetch_status = 'failed')::int as fetch_failed,
              count(*) filter (where i.enrich_status = 'done')::int as enrich_done,
              count(*) filter (where i.enrich_status = 'skipped')::int as enrich_skipped,
              count(*) filter (where i.enrich_status = 'error')::int as enrich_error,
              round(avg(i.significance)::numeric, 2) as avg_significance
         from intel_items i
         join intel_runs r on r.id = i.run_id
        where r.day > current_date - $1::interval`,
      [interval]
    ),
    one<{ n: number }>(
      `select count(*)::int as n from intel_facts where created_at > now() - $1::interval`,
      [interval]
    ),
    one<{ n: number }>(
      `select count(*)::int as n from intel_metrics where fetched_at > now() - $1::interval`,
      [interval]
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
        where feature in ('intel_enrich', 'intel_synthesis')
          and created_at > now() - $1::interval`,
      [interval]
    ),
    q<{ day: string; note: string }>(
      `select to_char(day, 'YYYY-MM-DD') as day, n as note
         from intel_runs, unnest(notes) as n
        where day > current_date - $1::interval
        order by day desc
        limit 30`,
      [interval]
    ),
    one<{ first: string | null }>(`select to_char(min(day), 'YYYY-MM-DD') as first from intel_runs`),
  ]);

  // Missed days: WEEKDAYS in [max(first run, window start), today] minus
  // weekdays that have a run row (the scan health precedent). Zero before the
  // first run ever.
  let missedDays = 0;
  if (firstRun?.first) {
    const dayRows = await q<{ n: number }>(
      `select count(*)::int as n from intel_runs
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
      filing: itemAgg?.filing ?? 0,
      fetchDone: itemAgg?.fetch_done ?? 0,
      fetchFailed: itemAgg?.fetch_failed ?? 0,
      enrichDone: itemAgg?.enrich_done ?? 0,
      enrichSkipped: itemAgg?.enrich_skipped ?? 0,
      enrichError: itemAgg?.enrich_error ?? 0,
      avgSignificance: itemAgg?.avg_significance ?? null,
    },
    factsWritten: factAgg?.n ?? 0,
    metricsWritten: metricAgg?.n ?? 0,
    spendUsd: spend?.usd ?? 0,
    issues: issueRows,
  };
}

// The metrics-coverage readout behind an /intel history panel: per source
// (edgar_xbrl, fdic, cfpb, y9c) how many rows, over what period range, and
// across how many companies. stale is derived in JS rather than SQL: true for
// the three quarterly sources when the newest period is older than 200 days
// (two missed quarters); cfpb is monthly and cron-owned, so it never flags.
const QUARTERLY_METRIC_SOURCES: ReadonlySet<IntelMetricSource> = new Set(['edgar_xbrl', 'fdic', 'y9c']);

export interface IntelMetricsCoverage {
  source: IntelMetricSource;
  rows: number;
  oldest: string | null;
  newest: string | null;
  companies: number;
  stale: boolean;
}

export async function getIntelMetricsCoverage(): Promise<IntelMetricsCoverage[]> {
  const rows = await q<{
    source: IntelMetricSource; rows: number; oldest: string | null; newest: string | null; companies: number;
  }>(
    `select source, count(*)::int as rows,
            to_char(min(period), 'YYYY-MM-DD') as oldest,
            to_char(max(period), 'YYYY-MM-DD') as newest,
            count(distinct company_slug)::int as companies
       from intel_metrics
      group by source
      order by source`
  );
  const now = Date.now();
  return rows.map((r) => {
    const ageDays = r.newest ? (now - new Date(`${r.newest}T00:00:00Z`).getTime()) / 86_400_000 : null;
    return {
      source: r.source,
      rows: r.rows,
      oldest: r.oldest,
      newest: r.newest,
      companies: r.companies,
      stale: QUARTERLY_METRIC_SOURCES.has(r.source) && ageDays !== null && ageDays > 200,
    };
  });
}

// The A/B comparison behind an /intel "Model A/B" table: per enriching model
// over the trailing window, quality proxy (avg significance) from intel_items
// joined with latency + spend from ai_cost_log (feature intel_enrich, grouped
// by model). Human judgment stays the real evaluator; these are the
// measurable halves (the getEnrichModelStats precedent).
export interface IntelModelStat {
  model: string;
  items: number;
  errors: number;
  avgSignificance: number | null;
  avgWallMs: number | null;
  costUsd: number;
  costPerItem: number | null;
}

export async function getIntelModelStats(days = 30): Promise<IntelModelStat[]> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const rows = await q<{
    model: string; items: number; errors: number;
    avg_significance: number | null; avg_wall_ms: number | null; cost_usd: number | null; calls: number | null;
  }>(
    `select i.enriched_by as model,
            count(*) filter (where i.enrich_status = 'done')::int as items,
            count(*) filter (where i.enrich_status = 'error')::int as errors,
            round(avg(i.significance) filter (where i.enrich_status = 'done')::numeric, 2) as avg_significance,
            l.avg_wall_ms, l.cost_usd, l.calls
       from intel_items i
       join intel_runs r on r.id = i.run_id and r.day > current_date - $1::interval
       left join (
         select model, round(avg(wall_ms))::int as avg_wall_ms,
                sum(cost_usd)::numeric as cost_usd, count(*)::int as calls
           from ai_cost_log
          where feature = 'intel_enrich' and created_at > now() - $1::interval
          group by model
       ) l on l.model = i.enriched_by
      where i.enriched_by is not null
      group by i.enriched_by, l.avg_wall_ms, l.cost_usd, l.calls
      order by items desc, i.enriched_by`,
    [interval]
  );
  return rows.map((r) => ({
    model: r.model,
    items: r.items,
    errors: r.errors,
    avgSignificance: r.avg_significance,
    avgWallMs: r.avg_wall_ms,
    costUsd: r.cost_usd ?? 0,
    costPerItem: r.calls ? Number(((r.cost_usd ?? 0) / r.calls).toFixed(4)) : null,
  }));
}

// Per-registry-company yield (the scan topicYield precedent): every company
// appears even with zero items in the window, so a dry registry row is
// visible, not just absent.
export interface IntelCompanyYield {
  slug: string;
  name: string;
  tier: IntelTier;
  active: boolean;
  items: number;
  itemsByFeed: number;
  itemsBySearch: number;
  itemsByFiling: number;
  facts: number;
  lastItem: string | null;
  dry: boolean;
}

export async function getIntelCompanyYield(days = 30): Promise<IntelCompanyYield[]> {
  const interval = `${Math.max(1, Math.round(days))} days`;
  const rows = await q<{
    slug: string; name: string; tier: IntelTier; active: boolean;
    items: number; items_feed: number; items_search: number; items_filing: number;
    facts: number; last_item: string | null;
  }>(
    `select c.slug, c.name, c.tier, c.active,
            count(i.id)::int as items,
            count(i.id) filter (where i.discovered_via = 'feed')::int as items_feed,
            count(i.id) filter (where i.discovered_via = 'search')::int as items_search,
            count(i.id) filter (where i.discovered_via = 'edgar')::int as items_filing,
            (select count(*)::int from intel_facts f
              where f.company_slug = c.slug and f.created_at > now() - $1::interval) as facts,
            to_char(max(i.created_at), 'YYYY-MM-DD') as last_item
       from intel_companies c
       left join (intel_items i
                  join intel_runs r on r.id = i.run_id and r.day > current_date - $1::interval)
              on i.company_slug = c.slug
      group by c.slug, c.name, c.tier, c.active
      order by c.tier, c.slug`,
    [interval]
  );
  return rows.map((r) => ({
    slug: r.slug, name: r.name, tier: r.tier, active: r.active,
    items: r.items, itemsByFeed: r.items_feed, itemsBySearch: r.items_search, itemsByFiling: r.items_filing,
    facts: r.facts, lastItem: r.last_item,
    dry: r.items === 0,
  }));
}

// The Tavily free-tier monthly budget (shared with the scan's search leg):
// used = this calendar month's tavily-search rows; projected straight-lines
// today's pace to month end; capHit reads both scan's and intel's persisted
// run notes for a quota/432 mention, since either engine can trip the shared cap.
export interface TavilyQuota {
  used: number;
  cap: number;
  projected: number;
  pctUsed: number;
  capHit: boolean;
}

export async function getTavilyQuota(): Promise<TavilyQuota> {
  const quotaRe = /quota|432/i;
  const [usedRow, scanNotes, intelNotes] = await Promise.all([
    // One cost-log row = one BATCH of Tavily calls; the true per-row call
    // count rides in metadata.queries (all three callers log it), so sum
    // that instead of counting rows. Rows without it count as one.
    one<{ n: number }>(
      `select coalesce(sum(coalesce((metadata->>'queries')::int, 1)), 0)::int as n
         from ai_cost_log
        where model = 'tavily-search' and created_at >= date_trunc('month', now())`
    ),
    q<{ note: string }>(
      `select n as note from scan_runs, unnest(notes) as n
        where day >= date_trunc('month', now())::date`
    ),
    q<{ note: string }>(
      `select n as note from intel_runs, unnest(notes) as n
        where day >= date_trunc('month', now())::date`
    ),
  ]);
  const used = usedRow?.n ?? 0;
  const cap = Number(process.env.TAVILY_MONTHLY_CAP || 1000);
  const now = new Date();
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const projected = dayOfMonth > 0 ? Math.round((used / dayOfMonth) * daysInMonth) : used;
  return {
    used,
    cap,
    projected,
    pctUsed: cap > 0 ? used / cap : 0,
    capHit: scanNotes.some((r) => quotaRe.test(r.note)) || intelNotes.some((r) => quotaRe.test(r.note)),
  };
}
