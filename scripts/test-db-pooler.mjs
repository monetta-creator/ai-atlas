// Tests for lib/db-pooler.ts (the Supabase pooler port rule lib/db.ts applies
// on Vercel). Pure, no DB, no env. Run: node scripts/test-db-pooler.mjs
import assert from 'node:assert/strict';
import { transactionPoolerPort, toTransactionPoolerUrl } from '../lib/db-pooler.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const POOLER = 'aws-0-us-east-1.pooler.supabase.com';

check('transactionPoolerPort: pooler host on 5432, empty, or 6543 -> 6543', () => {
  assert.equal(transactionPoolerPort(POOLER, '5432'), 6543);
  assert.equal(transactionPoolerPort(POOLER, ''), 6543);
  assert.equal(transactionPoolerPort(POOLER, '6543'), 6543);
});

check('transactionPoolerPort: non-pooler hosts keep their port', () => {
  assert.equal(transactionPoolerPort('db.abc.supabase.co', '5432'), 5432);
  assert.equal(transactionPoolerPort('localhost', '5433'), 5433);
});

check('transactionPoolerPort: host match is case-insensitive', () => {
  assert.equal(transactionPoolerPort('AWS-0-x.POOLER.SUPABASE.COM', '5432'), 6543);
});

check('toTransactionPoolerUrl: pooler :5432 and portless move to :6543', () => {
  assert.equal(
    toTransactionPoolerUrl(`postgresql://postgres.ref:pw@${POOLER}:5432/postgres`),
    `postgresql://postgres.ref:pw@${POOLER}:6543/postgres`
  );
  assert.equal(
    toTransactionPoolerUrl(`postgresql://postgres.ref:pw@${POOLER}/postgres`),
    `postgresql://postgres.ref:pw@${POOLER}:6543/postgres`
  );
});

check('toTransactionPoolerUrl: no-match inputs come back strictly equal (no re-serialization)', () => {
  const already = `postgresql://postgres.ref:pw@${POOLER}:6543/postgres`;
  assert.equal(toTransactionPoolerUrl(already), already);
  const direct = 'postgresql://postgres:pw@db.abc.supabase.co:5432/postgres';
  assert.equal(toTransactionPoolerUrl(direct), direct);
  assert.equal(toTransactionPoolerUrl('not a url'), 'not a url');
});

check('toTransactionPoolerUrl: an encoded password survives, only the port changes', () => {
  const input = `postgresql://postgres.ref:p%40ss@${POOLER}:5432/postgres`;
  assert.equal(toTransactionPoolerUrl(input), input.replace(':5432/', ':6543/'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
