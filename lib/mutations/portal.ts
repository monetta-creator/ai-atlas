import { exec, one, withTx } from '../db';
import { generateKey, hashKey, renewalDate } from '../portal/keys';

// ---- Access keys, requests and usage (migration 0060) -----------------------
// The full key exists in memory once, in issuePortalKey's return value, and is
// stored only as an HMAC under AUTH_SECRET (the prefix in clear for lookup).
// createAccessRequest and logPortalUsage are the two non-admin writers: the
// first is called by the public request route after validation, the second
// fire-and-forget by the portal surfaces after a response.

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET is missing or too short; cannot issue access keys.');
  return s;
}

export async function issuePortalKey(input: {
  name: string;
  email?: string | null;
  notes?: string | null;
  days?: number;
  requestId?: string | null;
  dailyBudgetUsd?: number;
  dailyMaxCalls?: number;
}): Promise<{ id: string; key: string; prefix: string; expiresAt: string }> {
  const secret = authSecret();
  const days = input.days && input.days > 0 ? Math.floor(input.days) : envInt('PORTAL_KEY_DEFAULT_DAYS', 90);
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const { key, prefix } = generateKey();
  const hash = hashKey(secret, key);
  const id = await withTx(async (c) => {
    const row = await c.query(
      `insert into portal_keys (name, email, key_prefix, key_hash, expires_at, notes, request_id, daily_ask_budget_usd, daily_ask_max_calls)
       values ($1, $2, $3, $4, $5, $6, $7::uuid,
               coalesce($8::numeric, 0.25), coalesce($9::int, 60))
       returning id::text as id`,
      [
        input.name.trim(), input.email?.trim() || null, prefix, hash, expiresAt.toISOString(),
        input.notes?.trim() || null, input.requestId ?? null,
        input.dailyBudgetUsd ?? null, input.dailyMaxCalls ?? null,
      ]
    );
    const newId = row.rows[0].id as string;
    if (input.requestId) {
      await c.query(
        `update portal_access_requests set status = 'approved', key_id = $2::uuid, decided_at = now()
          where id = $1::uuid`,
        [input.requestId, newId]
      );
    }
    return newId;
  });
  return { id, key, prefix, expiresAt: expiresAt.toISOString() };
}

// Renewal only extends expires_at. A revoked key is never revived: Revoke is
// the incident response for a leaked key (the full key is already out in an
// email or link), so the person gets a fresh key through issuePortalKey.
export async function renewPortalKey(id: string, days?: number): Promise<{ expiresAt: string }> {
  const n = days && days > 0 ? Math.floor(days) : envInt('PORTAL_KEY_DEFAULT_DAYS', 90);
  const row = await one<{ expires_at: string; revoked_at: string | null }>(
    `select expires_at::text as expires_at, revoked_at::text as revoked_at from portal_keys where id = $1::uuid`,
    [id]
  );
  if (!row) throw new Error('Access key not found.');
  if (row.revoked_at) throw new Error('Revoked keys cannot be renewed; issue a new one.');
  const next = renewalDate(row.expires_at, n);
  const updated = await exec(
    `update portal_keys set expires_at = $2 where id = $1::uuid and revoked_at is null`,
    [id, next.toISOString()]
  );
  if (!updated) throw new Error('Revoked keys cannot be renewed; issue a new one.');
  return { expiresAt: next.toISOString() };
}

export async function revokePortalKey(id: string): Promise<void> {
  await exec(`update portal_keys set revoked_at = now() where id = $1::uuid and revoked_at is null`, [id]);
}

export async function setPortalKeyBudget(id: string, budget: { dailyBudgetUsd: number; dailyMaxCalls: number }): Promise<void> {
  await exec(
    `update portal_keys set daily_ask_budget_usd = $2, daily_ask_max_calls = $3 where id = $1::uuid`,
    [id, budget.dailyBudgetUsd, budget.dailyMaxCalls]
  );
}

// The public request form's write (POST /api/access/request validates first).
export async function createAccessRequest(input: {
  name: string;
  email: string;
  reason: string | null;
  userAgent: string | null;
  ipHash: string | null;
}): Promise<string> {
  const row = await one<{ id: string }>(
    `insert into portal_access_requests (name, email, reason, user_agent, ip_hash)
     values ($1, $2, $3, $4, $5) returning id::text as id`,
    [input.name.trim(), input.email.trim().toLowerCase(), input.reason?.trim() || null, input.userAgent, input.ipHash]
  );
  if (!row) throw new Error('Could not record the access request.');
  return row.id;
}

export async function declineAccessRequest(id: string): Promise<void> {
  await exec(
    `update portal_access_requests set status = 'declined', decided_at = now()
      where id = $1::uuid and status = 'pending'`,
    [id]
  );
}

// Never rejects. Callers on a response path do not block on it, but they
// call it inside next/server's after() so the runtime keeps the invocation
// alive until the insert lands (a plain fire-and-forget can be frozen with
// the function once the response is flushed).
export function logPortalUsage(input: {
  keyId: string | null;
  identity: 'key' | 'legacy' | 'admin';
  kind: 'enter' | 'dataset' | 'schema' | 'nl_query' | 'ask' | 'deck' | 'view_save' | 'view_use' | 'view_delete';
  datasetSlug?: string | null;
  spec?: unknown;
  rows?: number | null;
  bytes?: number | null;
  status?: number | null;
  ua?: string | null;
}): Promise<void> {
  return exec(
    `insert into portal_usage (key_id, identity, kind, dataset_slug, spec, rows, bytes, status, ua)
     values ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      input.keyId, input.identity, input.kind, input.datasetSlug ?? null,
      input.spec === undefined ? null : JSON.stringify(input.spec),
      input.rows ?? null, input.bytes ?? null, input.status ?? null,
      input.ua ? input.ua.slice(0, 500) : null,
    ]
  ).then(() => undefined, () => undefined);
}
