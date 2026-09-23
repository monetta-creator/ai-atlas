// Tests for lib/cron/shared.ts (the Bearer CRON_SECRET gate and the dead-man
// ping every /api/cron/* route shares). Pure and DB-free: no dotenv, no pg.
// Run: node scripts/test-cron-gate.mjs
import assert from 'node:assert/strict';
import { cronGate, pingDeadman } from '../lib/cron/shared.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const savedSecret = process.env.CRON_SECRET;
const savedFetch = globalThis.fetch;
const req = (headers) => new Request('http://x', { headers });

check('cronGate: fails closed when CRON_SECRET is unset, even with a matching header', () => {
  delete process.env.CRON_SECRET;
  const res = cronGate(req({ authorization: 'Bearer anything' }));
  assert.ok(res instanceof Response);
  assert.equal(res.status, 401);
  // The discriminating inputs: without the `!secret` guard these would pass the
  // plain string comparison ('Bearer undefined' === `Bearer ${undefined}`).
  assert.equal(cronGate(req({ authorization: 'Bearer undefined' }))?.status, 401);
  process.env.CRON_SECRET = '';
  assert.equal(cronGate(req({ authorization: 'Bearer ' }))?.status, 401);
});

check('cronGate: missing header -> 401', () => {
  process.env.CRON_SECRET = 's3cret';
  const res = cronGate(req({}));
  assert.equal(res?.status, 401);
});

check('cronGate: wrong token -> 401', () => {
  process.env.CRON_SECRET = 's3cret';
  const res = cronGate(req({ authorization: 'Bearer nope' }));
  assert.equal(res?.status, 401);
});

check('cronGate: the right Bearer token -> null (proceed)', () => {
  process.env.CRON_SECRET = 's3cret';
  assert.equal(cronGate(req({ authorization: 'Bearer s3cret' })), null);
});

check('pingDeadman: undefined url never calls fetch', () => {
  let calls = 0;
  globalThis.fetch = () => { calls += 1; return Promise.resolve(new Response('ok')); };
  pingDeadman(undefined);
  assert.equal(calls, 0);
});

check('pingDeadman: a url calls fetch once, and a rejecting fetch does not throw', () => {
  let calls = 0;
  globalThis.fetch = () => { calls += 1; return Promise.reject(new Error('down')); };
  assert.doesNotThrow(() => pingDeadman('https://hc-ping.example/abc'));
  assert.equal(calls, 1);
});

globalThis.fetch = savedFetch;
if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
