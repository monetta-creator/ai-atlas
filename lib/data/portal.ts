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
