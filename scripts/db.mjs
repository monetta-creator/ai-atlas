import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Shared connection for the db:* scripts. One supported path: DATABASE_URL,
// any reachable Postgres 15+. TLS is on only when the URL asks for it
// (sslmode=require) or DB_SSL=1 — a local/on-prem Postgres usually runs
// without TLS.
export function makeClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Set DATABASE_URL in .env.local (see transition/RUNBOOK.md).');
  }
  const wantSsl = /sslmode=require/.test(url) || process.env.DB_SSL === '1';
  return new pg.Client({
    connectionString: url,
    ...(wantSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}
