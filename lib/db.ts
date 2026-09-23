import pg from 'pg';
import type { PoolClient } from 'pg';

// Parse numeric/decimal (OID 1700) as JS numbers, not strings — confidences are
// arithmetic (sliders, toFixed), and 0–1 values are well within float range.
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));

// Server-only Postgres access. It connects as a role that bypasses RLS, so the
// SERVER decides public (the map) vs. personal (confidence, rationales, priors).
// Never import this into a client component.
if (typeof window !== 'undefined') {
  throw new Error('lib/db must only be used on the server');
}

declare global {
  var __atlasPool: pg.Pool | undefined;
}

const POOL_OPTS = {
  max: Number(process.env.DB_POOL_MAX || 3),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: { rejectUnauthorized: false },
};

// Production (Vercel serverless) MUST use the Supabase pooler via DATABASE_URL —
// the direct db.<ref>.supabase.co host is IPv6-only and unreachable from
// serverless. Local dev falls back to the discrete SUPABASE_DB_* (direct) vars,
// which is also what the migrate/seed scripts use (DDL needs a session, not the
// transaction pooler).
// Supabase's pooler serves session mode on :5432 and transaction mode on :6543,
// and session mode caps CLIENTS at the pool size (15): every open pg client
// pins one. On Vercel each warm instance keeps up to DB_POOL_MAX clients, so
// session mode fills after a handful of instances and every further connect
// fails with EMAXCONNSESSION (2026-09-23: admin pages, which open several
// connections for the nav counts, 500'd while guest pages still rendered).
// On Vercel, always use transaction mode; nothing in lib/ or app/ relies on
// session state (no SET, LISTEN, advisory locks, temp tables, named
// statements), and withTx keeps BEGIN..COMMIT on one client, which transaction
// mode pins for the transaction. DB_POOL_MODE=session opts out.
const POOLER_HOST_RE = /\.pooler\.supabase\.com$/i;
const onVercel = Boolean(process.env.VERCEL) && process.env.DB_POOL_MODE !== 'session';

export function toTransactionPoolerUrl(url: string): string {
  try {
    const u = new URL(url);
    if (POOLER_HOST_RE.test(u.hostname) && (u.port === '' || u.port === '5432')) {
      u.port = '6543';
      return u.toString();
    }
  } catch {
    // Not a parseable URL: leave it to pg to report.
  }
  return url;
}

function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new pg.Pool({ connectionString: onVercel ? toTransactionPoolerUrl(url) : url, ...POOL_OPTS });
  }
  const {
    SUPABASE_DB_HOST,
    SUPABASE_DB_PORT,
    SUPABASE_DB_USER,
    SUPABASE_DB_PASSWORD,
    SUPABASE_DB_NAME,
  } = process.env;
  if (!SUPABASE_DB_HOST || !SUPABASE_DB_PORT || !SUPABASE_DB_USER || !SUPABASE_DB_PASSWORD || !SUPABASE_DB_NAME) {
    throw new Error(
      'Database config missing: set DATABASE_URL (Supabase pooler, for production) or all SUPABASE_DB_* vars (direct, for local).'
    );
  }
  const port = onVercel && POOLER_HOST_RE.test(SUPABASE_DB_HOST) && SUPABASE_DB_PORT === '5432' ? 6543 : Number(SUPABASE_DB_PORT);
  return new pg.Pool({
    host: SUPABASE_DB_HOST,
    port,
    user: SUPABASE_DB_USER,
    password: SUPABASE_DB_PASSWORD,
    database: SUPABASE_DB_NAME,
    ...POOL_OPTS,
  });
}

function getPool(): pg.Pool {
  if (!global.__atlasPool) {
    global.__atlasPool = makePool();
  }
  return global.__atlasPool;
}

export async function q<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await getPool().query(text, params as unknown[]);
  return res.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function exec(text: string, params?: unknown[]): Promise<number> {
  const res = await getPool().query(text, params as unknown[]);
  return res.rowCount ?? 0;
}

// Run a function inside a single transaction on one pooled client. Used for the
// human gate (a confidence move + its rationale + snapshot must be atomic).
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
