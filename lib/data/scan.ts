import { q, one } from '../db';
import type { ScanRun, ScanTopic } from '../types';

// ---- External Scan (migration 0038) -----------------------------------------
// Reads for the scan engine and the admin console. The whole surface is
// admin-only (the /scan page gates; the cron route gates on CRON_SECRET); the
// ONLY public egress for scan data is the key-gated `external-scan` dataset
// (lib/datasets/builders.ts), which never selects run/lease internals.

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
  error, created_at, updated_at`;

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
