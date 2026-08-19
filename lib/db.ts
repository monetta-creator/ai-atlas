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
function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (url) {
    return new pg.Pool({ connectionString: url, ...POOL_OPTS });
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
  return new pg.Pool({
    host: SUPABASE_DB_HOST,
    port: Number(SUPABASE_DB_PORT),
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
