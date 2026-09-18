import { q, one } from '../db';
import { DEFAULT_UTILITY_MODEL } from '../pipeline/config';
import type {
  ToolingCategory, ToolingEvent, ToolingMaturity, ToolingPrefs, ToolingProduct, ToolingRun, ToolingRunKind, ToolingViewer,
} from '../types';

// ---- AI Tooling Monitor (migration 0054) ------------------------------------
// Reads for the discovery/catalog engine and the public/portal/admin surfaces.
// Column visibility mirrors the Intel Desk / Startup Scout convention: a
// guest getter's SELECT list simply omits the portal/admin-only columns, so
// they never leave the database for that request (not just hidden client-side).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRODUCT_PUBLIC_COLUMNS: string[] = [
  'id', 'name', 'slug', 'vendor', 'vendor_domain', 'url', 'category', 'secondary_categories',
  'one_liner', 'description', 'target_buyer', 'deployment', 'pricing_model', 'pricing_note',
  'maturity', 'founded_year', 'hq', 'funding_note', 'notable_customers', 'integrations',
  'compliance_claims', 'models_used', 'features', 'feed_url', 'changelog_url', 'github_repo',
  'dossier', 'status', 'pinned',
  "to_char(first_seen, 'YYYY-MM-DD') as first_seen", "to_char(last_seen, 'YYYY-MM-DD') as last_seen",
  'created_at', 'updated_at',
];

export const PRODUCT_PORTAL_COLUMNS: string[] = [
  ...PRODUCT_PUBLIC_COLUMNS, 'deep_dive', 'agent_fit', 'agent_scores', 'agent_reason',
];

export const PRODUCT_ADMIN_COLUMNS: string[] = [
  ...PRODUCT_PORTAL_COLUMNS,
  'review_note', 'reviewed_at', 'agent_model', 'agent_at',
  'raw_content', 'fetched_via', 'fetched_at', 'fetch_error',
  'enriched_at', 'enriched_by', 'deep_dived_at', 'feed_checked_at',
  'origin', 'found_url', 'found_title', 'run_id',
];

function columnsFor(viewer: ToolingViewer): string[] {
  return viewer.admin ? PRODUCT_ADMIN_COLUMNS : viewer.portal ? PRODUCT_PORTAL_COLUMNS : PRODUCT_PUBLIC_COLUMNS;
}

// guest: cataloged only; portal: cataloged/parked/candidate (the review
// queue is visible to a keyholder, dismissed stays hidden); admin: any.
function allowedStatuses(viewer: ToolingViewer): string[] {
  if (viewer.admin) return ['candidate', 'cataloged', 'parked', 'dismissed'];
  if (viewer.portal) return ['cataloged', 'parked', 'candidate'];
  return ['cataloged'];
}

export async function getProduct(slugOrId: string, viewer: ToolingViewer): Promise<ToolingProduct | null> {
  const columns = columnsFor(viewer);
  const byId = UUID_RE.test(slugOrId);
  const row = await one<ToolingProduct>(
    `select ${columns.join(', ')} from tooling_products where ${byId ? 'id = $1' : 'slug = $1'}`,
    [slugOrId]
  );
  if (!row) return null;
  return allowedStatuses(viewer).includes(row.status) ? row : null;
}

// Query columns (search_queries/pull_queries/hn_query/github_query) are
// admin-only at read time — guests get '{}' / null instead of the real
// discovery templates.
export async function getToolingCategories(personal: boolean): Promise<ToolingCategory[]> {
  return q<ToolingCategory>(
    `select slug, name, description,
            ${personal ? 'search_queries' : "'{}'::text[]"} as search_queries,
            ${personal ? 'pull_queries' : "'{}'::text[]"} as pull_queries,
            ${personal ? 'hn_query' : 'null'} as hn_query,
            ${personal ? 'github_query' : 'null'} as github_query,
            active, sort_order, created_at, updated_at
       from tooling_categories
      order by sort_order, slug`
  );
}

// The runtime switches. Missing row = the defaults below (the migration also
// seeds the singleton, so this is a defensive fallback, the intel_prefs
// pattern). Model fields resolve to a real default only when
// OPENROUTER_API_KEY is set; otherwise null (the router's Haiku fallback).
export async function getToolingPrefs(): Promise<ToolingPrefs> {
  const row = await one<{
    enabled: boolean; steering: string | null; rubric: string | null;
    utility_model: string | null; enrich_model: string | null;
    catalog_threshold: number; deep_dive_threshold: number; deep_dive_cap: number;
    auto_publish_entrants: boolean;
  }>(
    `select enabled, steering, rubric, utility_model, enrich_model,
            catalog_threshold, deep_dive_threshold, deep_dive_cap, auto_publish_entrants
       from tooling_prefs where id = true`
  );
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);
  return {
    enabled: row?.enabled ?? true,
    steering: row?.steering ?? null,
    rubric: row?.rubric ?? null,
    utility_model: row?.utility_model ?? (hasOpenRouter ? DEFAULT_UTILITY_MODEL : null),
    enrich_model: row?.enrich_model ?? (hasOpenRouter ? 'z-ai/glm-5.3-flash' : null),
    catalog_threshold: row?.catalog_threshold ?? 60,
    deep_dive_threshold: row?.deep_dive_threshold ?? 75,
    deep_dive_cap: row?.deep_dive_cap ?? 15,
    auto_publish_entrants: row?.auto_publish_entrants ?? true,
  };
}

// ---- Engine picks (the discover/hydrate/enrich/score/finish/deepdive steps) --

export async function getPendingHydrate(n = 8): Promise<{ id: string; url: string }[]> {
  return q<{ id: string; url: string }>(
    `select id::text as id, url from tooling_products
      where status = 'candidate' and url is not null and raw_content is null
        and (fetch_error is null or fetched_at < now() - interval '6 days')
      order by first_seen, id
      limit $1`,
    [n]
  );
}

export async function getPendingEnrich(
  n = 12
): Promise<{ id: string; name: string; category: string; raw_content: string }[]> {
  return q<{ id: string; name: string; category: string; raw_content: string }>(
    `select id::text as id, name, category, raw_content from tooling_products
      where status = 'candidate' and raw_content is not null and enriched_at is null
      order by first_seen, id
      limit $1`,
    [n]
  );
}

export async function getUnscoredIds(limit = 10): Promise<string[]> {
  const rows = await q<{ id: string }>(
    `select id::text as id from tooling_products
      where status = 'candidate' and agent_at is null and not pinned
        and (enriched_at is not null or fetch_error is not null)
      order by first_seen, id
      limit $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}

export async function getNewlyCataloged(n = 8): Promise<{ id: string; url: string | null }[]> {
  return q<{ id: string; url: string | null }>(
    `select id::text as id, url from tooling_products
      where status = 'cataloged' and feed_checked_at is null
      order by first_seen, id
      limit $1`,
    [n]
  );
}

export async function getFeedProducts(
  n = 12
): Promise<{ id: string; feed_url: string; last_seen: string }[]> {
  return q<{ id: string; feed_url: string; last_seen: string }>(
    `select id::text as id, feed_url, to_char(last_seen, 'YYYY-MM-DD') as last_seen
       from tooling_products
      where status = 'cataloged' and feed_url is not null
        and (feed_checked_at is null or feed_checked_at < now() - interval '6 days')
      order by pinned desc, feed_checked_at nulls first, id
      limit $1`,
    [n]
  );
}

export async function getDeepDiveCandidates(
  runId: string,
  threshold: number,
  cap: number
): Promise<{ id: string; name: string; agent_fit: number | null }[]> {
  return q<{ id: string; name: string; agent_fit: number | null }>(
    `select p.id::text as id, p.name, p.agent_fit from tooling_products p
      where p.status = 'cataloged' and p.deep_dived_at is null and p.agent_fit >= $2
        and p.agent_at >= (select created_at from tooling_runs where id = $1)
      order by p.agent_fit desc, p.id
      limit $3`,
    [runId, threshold, cap]
  );
}

export interface ProductForScoring {
  id: string;
  name: string;
  vendor: string | null;
  category: string;
  one_liner: string | null;
  description: string | null;
  features: string[];
  deployment: string[];
  pricing_model: string | null;
  maturity: ToolingMaturity;
  compliance_claims: string[];
  notable_customers: string[];
  fetch_error: string | null;
  dossier_summary: string | null;
}

// The scoring agent's per-chunk read (lib/tooling/score.ts scoreChunk): the
// descriptive facts a rubric read needs, never raw_content (heavy, and the
// rubric only needs the extracted shape). dossier_summary rides the same
// jsonb the enrichment/deep-dive writers merge into.
export async function getProductsForScoring(ids: string[]): Promise<ProductForScoring[]> {
  const clean = (ids ?? []).filter((id) => UUID_RE.test(id));
  if (!clean.length) return [];
  return q<ProductForScoring>(
    `select id::text as id, name, vendor, category, one_liner, description, features, deployment,
            pricing_model, maturity::text as maturity, compliance_claims, notable_customers, fetch_error,
            dossier->>'summary' as dossier_summary
       from tooling_products
      where id = any($1::uuid[])`,
    [clean]
  );
}

// The pull-cron's ?kind=pull leg: the most recent pull run still worth
// advancing (running or failed, so a stale-flagged pull can also resume).
// The console creates the pull run; there is no cron entry for it, so this
// is the only way the cron route finds one to work on.
export async function getLatestPullRun(): Promise<{ id: string } | null> {
  return one<{ id: string }>(
    `select id::text as id from tooling_runs
      where kind = 'pull' and status in ('running', 'failed')
      order by created_at desc
      limit 1`
  );
}

// ---- Taste digest, model A/B, health, reports, nav count ----------------------

export interface ToolingTasteDigest {
  liked: { name: string; note: string }[];
  dismissed: string[];
}

// The scoring agent's revealed-taste steering: what a human already pinned or
// cataloged (with their why), and what they dismissed, mirrors the queue
// agent's standing digest pattern (research_agent_prefs / scout_prefs).
export async function getToolingTasteDigest(): Promise<ToolingTasteDigest> {
  const [liked, dismissed] = await Promise.all([
    q<{ name: string; review_note: string }>(
      `select name, review_note from tooling_products
        where (pinned or status = 'cataloged') and review_note is not null and review_note <> ''
        order by reviewed_at desc nulls last, updated_at desc
        limit 25`
    ),
    q<{ name: string }>(
      `select name from tooling_products
        where status = 'dismissed'
        order by reviewed_at desc nulls last, updated_at desc
        limit 25`
    ),
  ]);
  return {
    liked: liked.map((r) => ({ name: r.name, note: r.review_note.slice(0, 140) })),
    dismissed: dismissed.map((r) => r.name),
  };
}

export interface ToolingModelStat {
  model: string;
  count: number;
  avgFit: number | null;
  avgFeatureCount: number | null;
  avgWallMs: number | null;
}

// The enrichment model A/B: quality proxies (avg fit, avg feature count)
// from tooling_products, joined with latency from ai_cost_log (feature
// 'tooling_enrich', grouped by model) — the getIntelModelStats precedent.
export async function getToolingModelStats(): Promise<ToolingModelStat[]> {
  const rows = await q<{
    model: string; count: number; avg_fit: number | null; avg_feature_count: number | null; avg_wall_ms: number | null;
  }>(
    `select p.enriched_by as model,
            count(*)::int as count,
            round(avg(p.agent_fit)::numeric, 1) as avg_fit,
            round(avg(cardinality(p.features))::numeric, 1) as avg_feature_count,
            l.avg_wall_ms
       from tooling_products p
       left join (
         select model, round(avg(wall_ms))::int as avg_wall_ms
           from ai_cost_log
          where feature = 'tooling_enrich'
          group by model
       ) l on l.model = p.enriched_by
      where p.enriched_by is not null
      group by p.enriched_by, l.avg_wall_ms
      order by count desc, p.enriched_by`
  );
  return rows.map((r) => ({
    model: r.model,
    count: r.count,
    avgFit: r.avg_fit,
    avgFeatureCount: r.avg_feature_count,
    avgWallMs: r.avg_wall_ms,
  }));
}

export interface ToolingHealth {
  weeks: number;
  runs: { completed: number; failed: number; running: number };
  products: { candidate: number; cataloged: number; parked: number; dismissed: number };
  catalogedInWindow: number;
  deepDivesInWindow: number;
  spendUsd: number;
  issues: { day: string; note: string }[];
}

export async function getToolingHealth(weeks = 8): Promise<ToolingHealth> {
  const interval = `${Math.max(1, Math.round(weeks))} weeks`;
  const [runAgg, productAgg, catalogedAgg, deepDiveAgg, spend, issueRows] = await Promise.all([
    one<{ completed: number; failed: number; running: number }>(
      `select count(*) filter (where status = 'completed')::int as completed,
              count(*) filter (where status = 'failed')::int as failed,
              count(*) filter (where status = 'running')::int as running
         from tooling_runs where day > current_date - $1::interval`,
      [interval]
    ),
    one<{ candidate: number; cataloged: number; parked: number; dismissed: number }>(
      `select count(*) filter (where status = 'candidate')::int as candidate,
              count(*) filter (where status = 'cataloged')::int as cataloged,
              count(*) filter (where status = 'parked')::int as parked,
              count(*) filter (where status = 'dismissed')::int as dismissed
         from tooling_products`
    ),
    one<{ n: number }>(
      `select count(*)::int as n from tooling_products
        where status = 'cataloged' and first_seen > current_date - $1::interval`,
      [interval]
    ),
    one<{ n: number }>(
      `select count(*)::int as n from tooling_products
        where deep_dived_at > now() - $1::interval`,
      [interval]
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
        where feature like 'tooling_%' and created_at > now() - $1::interval`,
      [interval]
    ),
    q<{ day: string; note: string }>(
      `select to_char(day, 'YYYY-MM-DD') as day, n as note
         from tooling_runs, unnest(notes) as n
        where day > current_date - $1::interval
        order by day desc
        limit 30`,
      [interval]
    ),
  ]);
  return {
    weeks,
    runs: {
      completed: runAgg?.completed ?? 0,
      failed: runAgg?.failed ?? 0,
      running: runAgg?.running ?? 0,
    },
    products: {
      candidate: productAgg?.candidate ?? 0,
      cataloged: productAgg?.cataloged ?? 0,
      parked: productAgg?.parked ?? 0,
      dismissed: productAgg?.dismissed ?? 0,
    },
    catalogedInWindow: catalogedAgg?.n ?? 0,
    deepDivesInWindow: deepDiveAgg?.n ?? 0,
    spendUsd: spend?.usd ?? 0,
    issues: issueRows,
  };
}

export interface ToolingReportMeta {
  id: string;
  kind: string;
  subject: string | null;
  title: string;
  scope_from: string | null;
  scope_to: string | null;
  is_published: boolean;
  generated_at: string;
}

// The entrants report's idempotency check (WP2's runWeeklyEntrantsReport):
// one row per (kind, scope_to week-ending date).
export async function getToolingReportForWeek(kind: string, scopeTo: string): Promise<{ id: string } | null> {
  return one<{ id: string }>(
    `select id::text as id from generated_reports where kind = $1::report_kind_t and scope_to = $2::date limit 1`,
    [kind, scopeTo]
  );
}

// The four tooling report kinds' shelf: no jsonb (pack/narrative), so this is
// safe to project even before a caller decides guest/portal/admin visibility.
export async function listToolingReports(viewer: ToolingViewer): Promise<ToolingReportMeta[]> {
  const publishedOnly = !viewer.admin && !viewer.portal;
  return q<ToolingReportMeta>(
    `select id::text as id, kind::text as kind, subject, title,
            to_char(scope_from, 'YYYY-MM-DD') as scope_from,
            to_char(scope_to, 'YYYY-MM-DD') as scope_to,
            is_published, generated_at
       from generated_reports
      where kind::text like 'tooling_%'
        ${publishedOnly ? 'and is_published = true' : ''}
      order by generated_at desc, id`
  );
}

// The nav badge count (a future getNavCounts wires this in): unreviewed
// entrants from the last week. Not itself wired into lib/data/desk.ts here
// (that barrel is a later work package's surface).
export async function getToolingNavCount(): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from tooling_products
      where status = 'cataloged' and first_seen >= current_date - 7 and reviewed_at is null`
  );
  return row?.n ?? 0;
}

// ---- Run reads (console + cron) ----------------------------------------------

const RUN_COLUMNS = `id::text as id, kind::text as kind, to_char(day, 'YYYY-MM-DD') as day,
  status::text as status, step::text as step, swept_units, found_count, inserted_count,
  hydrated_count, enriched_count, scored_count, cataloged_count, deep_dived_count, event_count,
  report_id::text as report_id, notes, error, created_at, updated_at`;

export async function getToolingRun(runId: string): Promise<ToolingRun | null> {
  if (!UUID_RE.test(runId)) return null;
  return one<ToolingRun>(`select ${RUN_COLUMNS} from tooling_runs where id = $1`, [runId]);
}

export async function getToolingRunByKey(kind: ToolingRunKind, day: string): Promise<ToolingRun | null> {
  return one<ToolingRun>(
    `select ${RUN_COLUMNS} from tooling_runs where kind = $1::tooling_run_kind_t and day = $2::date`,
    [kind, day]
  );
}

// Run history with the per-run spend joined in: every tooling model call
// (and the $0 search rows) carries metadata.tooling_run = the run id.
export async function getToolingRuns(limit = 12): Promise<ToolingRun[]> {
  return q<ToolingRun>(
    `select ${RUN_COLUMNS.replace(/\bid::text as id\b/, 'r.id::text as id')},
            coalesce((select sum(l.cost_usd) from ai_cost_log l
                       where l.metadata->>'tooling_run' = r.id::text), 0)::numeric as cost_usd
       from tooling_runs r
      order by r.created_at desc, r.id
      limit $1`,
    [Math.max(1, Math.min(200, limit))]
  );
}

// ---- Surface reads (hub, profile, packs) ------------------------------------

export interface ProductSearchOpts {
  q?: string | null;
  category?: string | null;
  deployment?: string | null;
  maturity?: string | null;
  pricing?: string | null;
  statuses?: string[];          // intersected with the viewer's allowed set
  viewer: ToolingViewer;
  limit?: number;
}

const MATURITIES = new Set(['startup_early', 'startup_growth', 'scaleup', 'incumbent', 'big_tech', 'open_source_project', 'unknown']);

// FTS + facet search over the catalog. Guests only ever see cataloged rows
// (allowedStatuses), whatever `statuses` asks for; the partial GIN index
// covers cataloged/parked, which is the hot path.
export async function searchProducts(opts: ProductSearchOpts): Promise<ToolingProduct[]> {
  const allowed = allowedStatuses(opts.viewer);
  const statuses = (opts.statuses?.length ? opts.statuses : allowed).filter((s) => allowed.includes(s));
  if (!statuses.length) return [];
  const params: unknown[] = [statuses];
  const where: string[] = ['status = any($1::tooling_status_t[])'];
  const text = (opts.q ?? '').trim().slice(0, 200);
  if (text) { params.push(text); where.push(`search_tsv @@ websearch_to_tsquery('english', $${params.length})`); }
  if (opts.category) { params.push(opts.category); where.push(`category = $${params.length}`); }
  if (opts.deployment) { params.push(opts.deployment); where.push(`$${params.length} = any(deployment)`); }
  if (opts.maturity && MATURITIES.has(opts.maturity)) { params.push(opts.maturity); where.push(`maturity = $${params.length}::tooling_maturity_t`); }
  if (opts.pricing) { params.push(opts.pricing); where.push(`pricing_model = $${params.length}`); }
  params.push(Math.max(1, Math.min(500, opts.limit ?? 200)));
  const order = text
    ? `ts_rank(search_tsv, websearch_to_tsquery('english', $2)) desc, pinned desc, name`
    : `pinned desc, first_seen desc, name`;
  return q<ToolingProduct>(
    `select ${columnsFor(opts.viewer).join(', ')} from tooling_products
      where ${where.join(' and ')}
      order by ${order}, id
      limit $${params.length}`,
    params
  );
}

// Cataloged products first seen in [sinceISO, untilISO]: the "New this week"
// strip, the entrants widget, and the entrants report pack.
export async function getNewEntrants(
  sinceISO: string,
  viewer: ToolingViewer,
  opts: { untilISO?: string | null; limit?: number } = {}
): Promise<ToolingProduct[]> {
  const params: unknown[] = [sinceISO];
  let until = '';
  if (opts.untilISO) { params.push(opts.untilISO); until = `and first_seen <= $${params.length}::date`; }
  params.push(Math.max(1, Math.min(200, opts.limit ?? 50)));
  return q<ToolingProduct>(
    `select ${columnsFor(viewer).join(', ')} from tooling_products
      where status = 'cataloged' and first_seen >= $1::date ${until}
      order by agent_fit desc nulls last, first_seen desc, name, id
      limit $${params.length}`,
    params
  );
}

// The admin curation queue: unreviewed entrants from the last week, then the
// parked bucket, then unprocessed candidates. raw_content is deliberately
// left out (heavy); the profile page carries it.
export async function getCurationQueue(limit = 300): Promise<ToolingProduct[]> {
  const cols = PRODUCT_ADMIN_COLUMNS.filter((c) => c !== 'raw_content');
  return q<ToolingProduct>(
    `select ${cols.join(', ')},
            case when status = 'cataloged' then 0 when status = 'parked' then 1 else 2 end as bucket
       from tooling_products
      where status in ('candidate', 'parked')
         or (status = 'cataloged' and reviewed_at is null and first_seen >= current_date - 7)
      order by bucket, agent_fit desc nulls last, first_seen desc, name, id
      limit $1`,
    [Math.max(1, Math.min(1000, limit))]
  );
}

export async function getProductEvents(productId: string, limit = 60): Promise<ToolingEvent[]> {
  if (!UUID_RE.test(productId)) return [];
  return q<ToolingEvent>(
    `select id::text as id, product_id::text as product_id, to_char(event_date, 'YYYY-MM-DD') as event_date,
            kind::text as kind, title, url, note, source, created_at
       from tooling_events where product_id = $1
      order by event_date desc, created_at desc, id
      limit $2`,
    [productId, Math.max(1, Math.min(500, limit))]
  );
}

export interface ProductSibling {
  id: string; slug: string; name: string; vendor: string | null; one_liner: string | null;
  maturity: ToolingMaturity; agent_fit?: number | null;
}

// Same-category neighbours for the profile page's compare strip.
export async function getSiblings(
  category: string,
  excludeId: string,
  viewer: ToolingViewer,
  limit = 8
): Promise<ProductSibling[]> {
  const fit = viewer.admin || viewer.portal ? ', agent_fit' : '';
  return q<ProductSibling>(
    `select id::text as id, slug, name, vendor, one_liner, maturity::text as maturity${fit}
       from tooling_products
      where category = $1 and id <> $2 and status = any($3::tooling_status_t[])
      order by pinned desc, agent_fit desc nulls last, name, id
      limit $4`,
    [category, excludeId, allowedStatuses(viewer), Math.max(1, Math.min(50, limit))]
  );
}

export interface FeatureMatrixRow { tag: string; count: number; products: string[] }
export interface FeatureMatrix {
  category: string;
  products: { id: string; slug: string; name: string; vendor: string | null; features: string[] }[];
  features: FeatureMatrixRow[];   // by frequency desc; products = slugs carrying the tag
}

// The feature-steal view: which normalized feature tags appear across the
// cataloged products of a category, and who carries each. Cataloged only
// (parked products are not in the reader's market picture).
export async function getFeatureMatrix(category: string): Promise<FeatureMatrix> {
  const [products, features] = await Promise.all([
    q<{ id: string; slug: string; name: string; vendor: string | null; features: string[] }>(
      `select id::text as id, slug, name, vendor, features from tooling_products
        where category = $1 and status = 'cataloged'
        order by pinned desc, agent_fit desc nulls last, name, id`,
      [category]
    ),
    q<FeatureMatrixRow>(
      `select f.tag, count(*)::int as count, array_agg(p.slug order by p.slug) as products
         from tooling_products p, unnest(p.features) as f(tag)
        where p.category = $1 and p.status = 'cataloged'
        group by f.tag
        order by count desc, f.tag`,
      [category]
    ),
  ]);
  return { category, products, features };
}
