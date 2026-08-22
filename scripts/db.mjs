import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Shared connection for the db:* scripts. DATABASE_URL is the supported path
// (any reachable Postgres 15+); the discrete SUPABASE_DB_* variables remain as
// a legacy fallback. TLS is on only when the URL asks for it (sslmode=require)
// or DB_SSL=1 — a local/on-prem Postgres usually runs without TLS.
export function makeClient() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const wantSsl = /sslmode=require/.test(url) || process.env.DB_SSL === '1';
    return new pg.Client({
      connectionString: url,
      ...(wantSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  if (process.env.SUPABASE_DB_HOST) {
    return new pg.Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
  }
  throw new Error('Set DATABASE_URL in .env.local (see transition/RUNBOOK.md).');
}
