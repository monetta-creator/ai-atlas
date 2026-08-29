import { q, one } from '../db';
import type { ScanHealth, ScanRun, ScanTopic } from '../types';

// ---- External Scan (migration 0038) -----------------------------------------
// Reads for the scan engine and the admin console. The whole surface is
// admin-only (the /scan page gates; the cron route gates on CRON_SECRET); the
// ONLY public egress for scan data is the key-gated `external-scan` dataset
// (lib/datasets/builders.ts), which never selects run/lease internals.

// The runtime switch (migration 0039). Missing row = enabled: the singleton
// is created lazily by the first toggle.
export async function getScanPrefs(): Promise<{ enabled: boolean }> {
  const row = await one<{ enabled: boolean }>(`select enabled from scan_prefs where id = true`);
  return { enabled: row?.enabled ?? true };
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
