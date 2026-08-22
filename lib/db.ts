import pg from 'pg';
import type { PoolClient } from 'pg';

// Parse numeric/decimal (OID 1700) as JS numbers, not strings — convictions are
// arithmetic (sliders, toFixed), and 0–1 values are well within float range.
pg.types.setTypeParser(1700, (v: string) => parseFloat(v));

// Server-only Postgres access. It connects as a role that bypasses RLS, so the
// SERVER decides public (the board) vs. personal (conviction, rationales, priors).
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
};

// One supported path: DATABASE_URL, any reachable Postgres 15+. TLS is on only
// when the URL asks for it (sslmode=require) or DB_SSL=1 — a corporate or local
// Postgres without TLS must not be forced through an SSL handshake.
function makePool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Database config missing: set DATABASE_URL, e.g. postgresql://user:pass@host:5432/strategy_atlas');
  }
  const wantSsl = /sslmode=require/.test(url) || process.env.DB_SSL === '1';
  return new pg.Pool({
    connectionString: url,
    ...POOL_OPTS,
    ...(wantSsl ? { ssl: { rejectUnauthorized: false } } : {}),
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
// human gate (a conviction move + its rationale + snapshot must be atomic).
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
