// The Supabase pooler port rule, pure and dependency-free so
// scripts/test-db-pooler.mjs can load it. lib/db.ts decides WHEN to apply it
// (on Vercel unless DB_POOL_MODE=session); this module only says how.
//
// Supabase's pooler serves session mode on :5432 and transaction mode on
// :6543, and session mode caps CLIENTS at the pool size (15): every open pg
// client pins one. On Vercel each warm instance keeps up to DB_POOL_MAX
// clients, so session mode fills after a handful of instances and every
// further connect fails with EMAXCONNSESSION (2026-09-23: admin pages, which
// open several connections for the nav counts, 500'd while guest pages still
// rendered). On Vercel, always use transaction mode; nothing in lib/ or app/
// relies on session state (no SET, LISTEN, advisory locks, temp tables,
// named statements), and withTx keeps BEGIN..COMMIT on one client, which
// transaction mode pins for the transaction.
export const POOLER_HOST_RE = /\.pooler\.supabase\.com$/i;

// A pooler host on the session port (or no port) moves to the transaction
// port; anything else keeps its port as given.
export function transactionPoolerPort(host: string, port: string): number {
  if (POOLER_HOST_RE.test(host) && (port === '' || port === '5432')) return 6543;
  return Number(port);
}

// Same rule over a connection string. Returns the ORIGINAL string, not a
// re-serialization, when nothing changes or the string does not parse (pg
// reports the latter).
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
