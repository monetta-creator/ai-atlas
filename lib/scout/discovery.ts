import { one } from '../db';
import { searchCompanies } from './web';
import { scoutBatches } from './core';
import { resolveDateTokens, LOW_QUALITY_DOMAINS } from '../pipeline/config';
import * as m from '../mutations';

// One unit of scout discovery: a single vertical's query batch (<=2 searches,
// ~45s, under the 60s cap). Idempotent: insertCompanies dedupes GLOBALLY by
// domain and normalized name (and never re-queues a dismissed company), so the
// console can drive batch by batch and safely retry. The pure plan/parse half
// lives in lib/scout/core.ts (Node-testable).

export async function discoverScoutBatch(
  runId: string,
  verticalSlug: string,
  batchIndex: number
): Promise<{ found: number; inserted: number }> {
  // Date tokens resolve from the run's trigger date (deterministic per run: a
  // batch retried days later gets the same query text as its siblings).
  const run = await one<{ d: string }>(
    `select to_char(triggered_at, 'YYYY-MM-DD') as d from scout_runs where id = $1`,
    [runId]
  );
  if (!run) throw new Error('Unknown scout run.');
  const v = await one<{ slug: string; name: string; description: string | null; search_queries: string[] }>(
    `select slug, name, description, search_queries from scout_verticals where slug = $1`,
    [verticalSlug]
  );
  if (!v) throw new Error('Unknown vertical.');

  const queries = scoutBatches(resolveDateTokens(v.search_queries, run.d))[batchIndex];
  if (!queries || !queries.length) return { found: 0, inserted: 0 };

  const companies = await searchCompanies({
    verticalName: v.name,
    verticalDescription: v.description,
    queries,
    maxUses: 2,
    scoutRunId: runId,
    blockedDomains: LOW_QUALITY_DOMAINS,
  });
  const res = await m.insertCompanies(runId, v.slug, companies);
  await m.bumpScoutRunCounts(runId, res.found, res.inserted);
  return res;
}
