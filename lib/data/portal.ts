import { q, one } from '../db';
import { keyState, type KeyState } from '../portal/keys';

// ---- Access keys, requests and usage (migration 0060) -----------------------
// Admin-only readers for the /access console. Email addresses, ip hashes and
// user agents never leave an admin surface; nothing in this module renders to
// guests or keyholders. The full key is never stored, so nothing here can
// return it: key_prefix is the only clear-text handle.

export interface PortalKeyRow {
  id: string;
  name: string;
  email: string | null;
  key_prefix: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  daily_ask_budget_usd: number;
  daily_ask_max_calls: number;
  notes: string | null;
  request_id: string | null;
  state: KeyState;
  usage_count: number;
  spend_today_usd: number;
}

export interface AccessRequestRow {
  id: string;
  name: string;
  email: string;
  reason: string | null;
  status: 'pending' | 'approved' | 'declined';
  key_id: string | null;
  user_agent: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface PortalUsageRow {
  id: string;
  key_id: string | null;
  key_name: string | null;
  identity: 'key' | 'legacy' | 'admin';
  kind: 'enter' | 'dataset' | 'schema' | 'nl_query' | 'ask' | 'deck' | 'view_save';
  dataset_slug: string | null;
  rows: number | null;
  bytes: number | null;
  status: number | null;
  created_at: string;
}

type RawKeyRow = Omit<PortalKeyRow, 'state'>;

// Today's spend per key comes from ai_cost_log grouped by the
// metadata.portal_key_id stamp (indexed by 0060); usage_count from portal_usage.
const KEY_SELECT = `
  select k.id::text as id, k.name, k.email, k.key_prefix,
         k.created_at::text as created_at, k.expires_at::text as expires_at,
         k.revoked_at::text as revoked_at, k.last_used_at::text as last_used_at,
         k.daily_ask_budget_usd, k.daily_ask_max_calls, k.notes, k.request_id::text as request_id,
         coalesce(u.n, 0)::int as usage_count,
         coalesce(s.usd, 0)::numeric as spend_today_usd
    from portal_keys k
    left join (select key_id, count(*) as n from portal_usage group by key_id) u on u.key_id = k.id
    left join (
      select metadata->>'portal_key_id' as key_id, sum(cost_usd) as usd
        from ai_cost_log
       where metadata ? 'portal_key_id'
         and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
       group by 1
    ) s on s.key_id = k.id::text`;

function withState(row: RawKeyRow): PortalKeyRow {
  return { ...row, state: keyState(row) };
}

export async function listPortalKeys(): Promise<PortalKeyRow[]> {
  const rows = await q<RawKeyRow>(
    `${KEY_SELECT}
      order by (k.revoked_at is null and k.expires_at > now()) desc, k.expires_at asc, k.created_at desc`
  );
  return rows.map(withState);
}

export async function getKeyById(id: string): Promise<PortalKeyRow | null> {
  const row = await one<RawKeyRow>(`${KEY_SELECT} where k.id = $1::uuid`, [id]);
  return row ? withState(row) : null;
}

export async function listAccessRequests(status?: 'pending' | 'approved' | 'declined'): Promise<AccessRequestRow[]> {
  return q<AccessRequestRow>(
    `select id::text as id, name, email, reason, status, key_id::text as key_id, user_agent,
            created_at::text as created_at, decided_at::text as decided_at
       from portal_access_requests
      where ($1::text is null or status = $1)
      order by (status = 'pending') desc, created_at desc
      limit 500`,
    [status ?? null]
  );
}

export async function getPendingAccessCount(): Promise<number> {
  const row = await one<{ n: number }>(
    `select count(*)::int as n from portal_access_requests where status = 'pending'`
  );
  return row?.n ?? 0;
}

export async function listPortalUsage(opts: { keyId?: string; limit?: number } = {}): Promise<PortalUsageRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  return q<PortalUsageRow>(
    `select u.id::text as id, u.key_id::text as key_id, k.name as key_name, u.identity, u.kind,
            u.dataset_slug, u.rows, u.bytes, u.status, u.created_at::text as created_at
       from portal_usage u
       left join portal_keys k on k.id = u.key_id
      where ($1::uuid is null or u.key_id = $1::uuid)
      order by u.created_at desc
      limit $2`,
    [opts.keyId ?? null, limit]
  );
}

// The per-key daily meter: every portal-triggered recordApiCall stamps
// metadata.portal_key_id (the Ask route, and the scout/tooling actions via
// portalKeyMetadata in lib/actions/shared.ts), so this is one indexed sum
// over today (UTC).
export async function getKeySpendToday(keyId: string): Promise<{ usd: number; calls: number }> {
  const row = await one<{ usd: number; n: number }>(
    `select coalesce(sum(cost_usd), 0)::numeric as usd, count(*)::int as n
       from ai_cost_log
      where metadata->>'portal_key_id' = $1::text
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    [keyId]
  );
  return { usd: row?.usd ?? 0, calls: row?.n ?? 0 };
}

// ---- Per-key usage analytics (/access, /costs; P5-B) -----------------------
// One row per key (plus a synthetic 'legacy' row for the shared team key)
// over a trailing window: usage counts by kind, spend (the same
// metadata.portal_key_id sum getKeySpendToday uses, just not clamped to
// today), and the key's top 3 pulled datasets. Two statements total, no
// N+1: the main aggregate joins portal_keys against one grouped read of
// portal_usage and one grouped read of ai_cost_log; the dataset breakdown
// is a second grouped read, folded into per-key top-3 lists in JS (rows
// arrive ordered by key then count desc, so the first three per key are
// the top three). Admin-only, like the rest of this module.
export interface KeyUsageSummaryRow {
  keyId: string; // a portal_keys uuid, or the literal 'legacy'
  name: string;
  pulls: number;
  schemaReads: number;
  askTurns: number;
  nlQueries: number;
  viewsSaved: number;
  deckViews: number;
  lastUsedAt: string | null;
  spendUsd: number;
  topDatasets: { slug: string; n: number }[];
}

export interface KeyUsageTotals {
  pulls: number;
  schemaReads: number;
  askTurns: number;
  nlQueries: number;
  viewsSaved: number;
  deckViews: number;
  spendUsd: number;
}

export interface KeyUsageSummary {
  keys: KeyUsageSummaryRow[];
  totals: KeyUsageTotals;
}

interface RawUsageSummaryRow {
  key_id: string;
  name: string;
  pulls: number;
  schemaReads: number;
  askTurns: number;
  nlQueries: number;
  viewsSaved: number;
  deckViews: number;
  lastUsedAt: string | null;
  spendUsd: number;
}

interface RawTopDatasetRow {
  key_id: string;
  dataset_slug: string;
  n: number;
}

export async function getKeyUsageSummary(days = 30): Promise<KeyUsageSummary> {
  const [rows, datasetRows] = await Promise.all([
    q<RawUsageSummaryRow>(
      `select coalesce(k.id::text, 'legacy') as key_id,
              coalesce(k.name, 'Legacy shared key') as name,
              coalesce(u.pulls, 0)::int as "pulls",
              coalesce(u.schema_reads, 0)::int as "schemaReads",
              coalesce(u.ask_turns, 0)::int as "askTurns",
              coalesce(u.nl_queries, 0)::int as "nlQueries",
              coalesce(u.views_saved, 0)::int as "viewsSaved",
              coalesce(u.deck_views, 0)::int as "deckViews",
              u.last_used_at::text as "lastUsedAt",
              coalesce(s.usd, 0)::numeric as "spendUsd"
         from (
           select id, name from portal_keys
           union all
           select null::uuid as id, 'Legacy shared key' as name
         ) k
         left join (
           select key_id,
                  count(*) filter (where kind = 'dataset')   as pulls,
                  count(*) filter (where kind = 'schema')    as schema_reads,
                  count(*) filter (where kind = 'ask')       as ask_turns,
                  count(*) filter (where kind = 'nl_query')  as nl_queries,
                  count(*) filter (where kind = 'view_save') as views_saved,
                  count(*) filter (where kind = 'deck')      as deck_views,
                  max(created_at) as last_used_at
             from portal_usage
            where created_at >= current_date - ($1::int - 1) * interval '1 day'
              and (key_id is not null or identity = 'legacy')
            group by key_id
         ) u on u.key_id is not distinct from k.id
         left join (
           select metadata->>'portal_key_id' as key_id, sum(cost_usd) as usd
             from ai_cost_log
            where metadata ? 'portal_key_id'
              and created_at >= current_date - ($1::int - 1) * interval '1 day'
            group by 1
         ) s on s.key_id = k.id::text
        order by "spendUsd" desc, "pulls" desc, name asc`,
      [days]
    ),
    q<RawTopDatasetRow>(
      `select coalesce(key_id::text, 'legacy') as key_id, dataset_slug, count(*)::int as n
         from portal_usage
        where kind = 'dataset'
          and dataset_slug is not null
          and created_at >= current_date - ($1::int - 1) * interval '1 day'
          and (key_id is not null or identity = 'legacy')
        group by coalesce(key_id::text, 'legacy'), dataset_slug
        order by coalesce(key_id::text, 'legacy'), n desc`,
      [days]
    ),
  ]);

  const topByKey = new Map<string, { slug: string; n: number }[]>();
  for (const r of datasetRows) {
    const list = topByKey.get(r.key_id) ?? [];
    if (list.length < 3) list.push({ slug: r.dataset_slug, n: r.n });
    topByKey.set(r.key_id, list);
  }

  const keys: KeyUsageSummaryRow[] = rows.map((r) => ({
    keyId: r.key_id,
    name: r.name,
    pulls: r.pulls,
    schemaReads: r.schemaReads,
    askTurns: r.askTurns,
    nlQueries: r.nlQueries,
    viewsSaved: r.viewsSaved,
    deckViews: r.deckViews,
    lastUsedAt: r.lastUsedAt,
    spendUsd: r.spendUsd,
    topDatasets: topByKey.get(r.key_id) ?? [],
  }));

  const totals = keys.reduce<KeyUsageTotals>(
    (acc, k) => ({
      pulls: acc.pulls + k.pulls,
      schemaReads: acc.schemaReads + k.schemaReads,
      askTurns: acc.askTurns + k.askTurns,
      nlQueries: acc.nlQueries + k.nlQueries,
      viewsSaved: acc.viewsSaved + k.viewsSaved,
      deckViews: acc.deckViews + k.deckViews,
      spendUsd: acc.spendUsd + k.spendUsd,
    }),
    { pulls: 0, schemaReads: 0, askTurns: 0, nlQueries: 0, viewsSaved: 0, deckViews: 0, spendUsd: 0 }
  );

  return { keys, totals };
}

export interface PortalUsageDayRow {
  day: string;
  pulls: number;
  askTurns: number;
  spendUsd: number;
}

// Per-day totals across every key (a small table, not a chart) over a
// trailing window: dataset pulls, Ask turns, and per-key-metered spend,
// zero-filled so a quiet day still gets a row.
export async function getPortalUsageByDay(days = 30): Promise<PortalUsageDayRow[]> {
  return q<PortalUsageDayRow>(
    `with days as (
       select generate_series(current_date - ($1::int - 1) * interval '1 day', current_date, interval '1 day')::date as day
     ),
     usage_agg as (
       select created_at::date as day,
              count(*) filter (where kind = 'dataset') as pulls,
              count(*) filter (where kind = 'ask')      as ask_turns
         from portal_usage
        where created_at >= current_date - ($1::int - 1) * interval '1 day'
          and (key_id is not null or identity = 'legacy')
        group by created_at::date
     ),
     spend_agg as (
       select created_at::date as day, sum(cost_usd) as usd
         from ai_cost_log
        where metadata ? 'portal_key_id'
          and created_at >= current_date - ($1::int - 1) * interval '1 day'
        group by created_at::date
     )
     select to_char(d.day, 'YYYY-MM-DD') as day,
            coalesce(u.pulls, 0)::int as "pulls",
            coalesce(u.ask_turns, 0)::int as "askTurns",
            coalesce(s.usd, 0)::numeric as "spendUsd"
       from days d
       left join usage_agg u on u.day = d.day
       left join spend_agg s on s.day = d.day
      order by d.day`,
    [days]
  );
}

// Keys expiring within `days` (active only), for the agent's info check.
export async function listKeysExpiringWithin(days: number): Promise<Pick<PortalKeyRow, 'id' | 'name' | 'expires_at'>[]> {
  return q<Pick<PortalKeyRow, 'id' | 'name' | 'expires_at'>>(
    `select id::text as id, name, expires_at::text as expires_at
       from portal_keys
      where revoked_at is null
        and expires_at > now()
        and expires_at <= now() + ($1::int * interval '1 day')
      order by expires_at asc`,
    [days]
  );
}

// The oldest pending request's age in days (null when none are pending).
export async function getOldestPendingAccessDays(): Promise<number | null> {
  const row = await one<{ d: number | null }>(
    `select extract(epoch from (now() - min(created_at))) / 86400 as d
       from portal_access_requests where status = 'pending'`
  );
  return row?.d ?? null;
}
