// Tests for lib/nav-counts-store.ts (the chrome's live badge-count store) and
// lib/chrome-session-client.ts (the once-per-path chrome refresh guard).
// Pure, no DB, no React. Run: node scripts/test-nav-counts-store.mjs
import assert from 'node:assert/strict';
import { createNavCountsStore } from '../lib/nav-counts-store.ts';
import { claimChromeRefresh, refreshChromeOnce, sessionLost } from '../lib/chrome-session-client.ts';

let pass = 0; let fail = 0;
async function check(name, fn) {
  try { await fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// A fetch whose responses the test releases on demand: each call records its
// arguments and returns a promise settled by resolve()/reject() on its entry.
function fakeFetch() {
  const calls = [];
  const impl = (url, opts) => new Promise((resolve, reject) => {
    calls.push({ url, opts, resolve, reject });
  });
  const response = (body, extra = {}) => ({
    status: 200, redirected: false, ok: true, json: async () => body, ...extra,
  });
  return { impl, calls, response };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const f = fakeFetch();
  const store = createNavCountsStore(f.impl);
  let emits = 0;
  const unsub = store.subscribe(() => { emits += 1; });
  let lost = 0;
  const onLost = () => { lost += 1; };
  return { f, store, get emits() { return emits; }, get lost() { return lost; }, unsub, onLost };
}

const A = { tickets: 1, drafts: 2 };
const B = { tickets: 5, drafts: 6 };

await check('a late response never overwrites counts the server delivered after it started', async () => {
  const h = harness();
  h.store.refresh('/a', h.onLost);
  assert.equal(h.f.calls.length, 1);
  assert.equal(h.f.calls[0].url, '/api/nav/counts');
  assert.deepEqual(h.f.calls[0].opts, { cache: 'no-store' });
  h.store.acceptInitial(A, '/a');
  assert.equal(h.store.getSnapshot(), A);
  assert.equal(h.emits, 1);
  h.f.calls[0].resolve(h.f.response(B));
  await tick(); await tick();
  assert.equal(h.store.getSnapshot(), A, 'the stale fetch was dropped');
  assert.equal(h.emits, 1);
  h.store.refresh('/a', h.onLost);
  assert.equal(h.f.calls.length, 1, 'acceptInitial marked /a as fetched, so no second request');
});

await check('two refreshes for one path before the response share one request', async () => {
  const h = harness();
  h.store.refresh('/a', h.onLost);
  h.store.refresh('/a', h.onLost);
  assert.equal(h.f.calls.length, 1);
  h.f.calls[0].resolve(h.f.response(B));
  await tick(); await tick();
  assert.equal(h.store.getSnapshot(), B);
  assert.equal(h.emits, 1);
});

await check('a 401 or a redirect reports the lost session and leaves the counts alone', async () => {
  for (const extra of [{ status: 401, ok: false }, { redirected: true }]) {
    const h = harness();
    h.store.acceptInitial(A, '/x');
    h.store.refresh('/a', h.onLost);
    h.f.calls[0].resolve(h.f.response(B, extra));
    await tick(); await tick();
    assert.equal(h.lost, 1, JSON.stringify(extra));
    assert.equal(h.store.getSnapshot(), A);
    assert.equal(h.emits, 1, 'only the acceptInitial emit');
  }
});

await check('the chrome refresh is claimed once per pathname', () => {
  assert.equal(claimChromeRefresh('/guard-a'), true);
  assert.equal(claimChromeRefresh('/guard-a'), false);
  assert.equal(claimChromeRefresh('/guard-b'), true);
  assert.equal(claimChromeRefresh('/guard-a'), true, 'a path change resets the guard');
  let refreshes = 0;
  const router = { refresh() { refreshes += 1; } };
  refreshChromeOnce(router, '/guard-c');
  refreshChromeOnce(router, '/guard-c');
  assert.equal(refreshes, 1);
  assert.equal(sessionLost({ status: 401, redirected: false }), true);
  assert.equal(sessionLost({ status: 200, redirected: true }), true);
  assert.equal(sessionLost({ status: 200, redirected: false }), false);
  assert.equal(sessionLost({ status: 500, redirected: false }), false);
});

await check('acceptInitial ignores a repeated reference and a null', async () => {
  const h = harness();
  h.store.acceptInitial(A, '/a');
  h.store.acceptInitial(A, '/a');
  assert.equal(h.emits, 1);
  // The second call did not bump the generation: a fetch started after it lands.
  h.store.refresh('/b', h.onLost);
  h.f.calls[0].resolve(h.f.response(B));
  await tick(); await tick();
  assert.equal(h.store.getSnapshot(), B);
  assert.equal(h.emits, 2);
  h.store.acceptInitial(null, '/b');
  assert.equal(h.store.getSnapshot(), B);
  assert.equal(h.emits, 2);
});

await check('a rejected fetch or a non-ok status keeps the counts and frees the slot', async () => {
  const h = harness();
  h.store.acceptInitial(A, '/x');
  h.store.refresh('/a', h.onLost);
  h.f.calls[0].reject(new Error('offline'));
  await tick(); await tick(); await tick();
  assert.equal(h.store.getSnapshot(), A);
  assert.equal(h.lost, 0);
  h.store.refresh('/a', h.onLost);
  assert.equal(h.f.calls.length, 2, 'the slot was freed, so the path fetches again');
  h.f.calls[1].resolve(h.f.response(B, { status: 500, ok: false }));
  await tick(); await tick(); await tick();
  assert.equal(h.store.getSnapshot(), A);
  assert.equal(h.lost, 0);
  h.store.refresh('/a', h.onLost);
  assert.equal(h.f.calls.length, 3);
  assert.equal(h.emits, 1);
});

await check('unsubscribe stops listener calls', () => {
  const h = harness();
  h.store.acceptInitial(A, '/a');
  assert.equal(h.emits, 1);
  h.unsub();
  h.store.acceptInitial(B, '/a');
  assert.equal(h.emits, 1);
  assert.equal(h.store.getSnapshot(), B);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// The once-per-pathname refresh guard must reopen after a successful poll,
// or the second sign-out on a revisited path would never refresh the chrome.
{
  const { claimChromeRefresh, chromeSessionAlive } = await import('../lib/chrome-session-client.ts');
  const p = '/guard-test-path';
  let ok = 0;
  try {
    assert.equal(claimChromeRefresh(p), true);
    assert.equal(claimChromeRefresh(p), false);
    chromeSessionAlive();
    assert.equal(claimChromeRefresh(p), true);
    ok = 1;
  } catch (e) {
    console.error(`FAIL  chromeSessionAlive reopens the refresh guard\n      ${e.message}`);
    process.exitCode = 1;
  }
  if (ok) console.log('  ok  chromeSessionAlive reopens the refresh guard');
}
