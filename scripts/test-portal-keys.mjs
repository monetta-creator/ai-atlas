// Tests for lib/portal/keys.ts (per-person access keys, the pure half).
// Pure, no DB. Run: node scripts/test-portal-keys.mjs
import assert from 'node:assert/strict';
import {
  generateKey, parseKey, hashKey, hashesEqual, cookieValue, parseCookieValue, magicLink,
  keyState, expiresInDays, renewalDate, parseDomainList, emailAllowed, portalCookieGrants, requestsOpen,
} from '../lib/portal/keys.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

check('generateKey: atlas_<8>_<32> over the base32 alphabet, prefix returned', () => {
  const { key, prefix } = generateKey();
  assert.match(key, /^atlas_[a-z2-7]{8}_[a-z2-7]{32}$/);
  assert.equal(key.slice(6, 14), prefix);
  const again = generateKey();
  assert.notEqual(key, again.key);
});

check('generateKey: deterministic under an injected random source', () => {
  const rand = (n) => Uint8Array.from({ length: n }, (_, i) => i);
  const a = generateKey(rand); const b = generateKey(rand);
  assert.equal(a.key, b.key);
  assert.equal(a.prefix, 'abcdefgh');
});

check('parseKey: accepts the format with surrounding whitespace, rejects everything else', () => {
  const { key, prefix } = generateKey();
  assert.deepEqual(parseKey(`  ${key} `), { prefix, key });
  for (const bad of ['', 'atlas_short', key.toUpperCase(), key.replace('atlas_', 'atlas-'), `${key}x`, 'portal']) {
    assert.equal(parseKey(bad), null, bad);
  }
});

check('hashKey: stable per secret, differs across secrets and keys, compared in constant time', () => {
  const { key } = generateKey();
  const h1 = hashKey('s'.repeat(32), key);
  assert.equal(h1, hashKey('s'.repeat(32), key));
  assert.notEqual(h1, hashKey('t'.repeat(32), key));
  assert.notEqual(h1, hashKey('s'.repeat(32), generateKey().key));
  assert.equal(hashesEqual(h1, h1), true);
  assert.equal(hashesEqual(h1, h1.slice(0, -1)), false);
});

check('cookie value: legacy and per-key forms round-trip', () => {
  assert.deepEqual(parseCookieValue('portal'), { legacy: true });
  const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const v = cookieValue(id, 1_800_000_000.9);
  assert.equal(v, `portal:${id}:1800000000`);
  assert.deepEqual(parseCookieValue(v), { legacy: false, keyId: id, exp: 1_800_000_000 });
  for (const bad of ['admin', 'portal:', `portal:${id}`, `portal:${id}:abc`, `portal:${id}:1:2`, 'portalx']) {
    assert.equal(parseCookieValue(bad), null, bad);
  }
});

check('magicLink: /datasets/enter with the key encoded, base slash-tolerant', () => {
  const { key } = generateKey();
  assert.equal(magicLink('https://x.example/', key), `https://x.example/datasets/enter?k=${key}`);
  assert.equal(magicLink('https://x.example', key), `https://x.example/datasets/enter?k=${key}`);
});

check('keyState / expiresInDays / renewalDate', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  assert.equal(keyState({ expires_at: '2026-12-22T12:00:00Z', revoked_at: null }, now), 'active');
  assert.equal(keyState({ expires_at: '2026-09-23T11:59:59Z', revoked_at: null }, now), 'expired');
  assert.equal(keyState({ expires_at: '2026-12-22T12:00:00Z', revoked_at: '2026-09-01T00:00:00Z' }, now), 'revoked');
  assert.equal(keyState({ expires_at: 'not a date', revoked_at: null }, now), 'expired');
  assert.equal(expiresInDays('2026-09-30T12:00:00Z', now), 7);
  // renewing an expired key restarts from now; renewing a live key extends it
  assert.equal(renewalDate('2026-09-01T00:00:00Z', 90, now).toISOString(), '2026-12-22T12:00:00.000Z');
  assert.equal(renewalDate('2026-12-22T12:00:00Z', 90, now).toISOString(), '2027-03-22T12:00:00.000Z');
});

check('emailAllowed: shape, allow-list, subdomains, empty list', () => {
  const domains = parseDomainList(' Example.com, @corp.example.org ,, ');
  assert.deepEqual(domains, ['example.com', 'corp.example.org']);
  assert.equal(emailAllowed('Ann@example.com', domains), true);
  assert.equal(emailAllowed('ann@mail.example.com', domains), true);
  assert.equal(emailAllowed('ann@corp.example.org', domains), true);
  assert.equal(emailAllowed('ann@notexample.com', domains), false);
  assert.equal(emailAllowed('ann@example.com.evil.net', domains), false);
  assert.equal(emailAllowed('not-an-email', []), false);
  assert.equal(emailAllowed('ann@anywhere.io', []), true);
});

// The decision lib/auth.ts isPortal() applies (and, through
// getPortalIdentity, requirePortal() and /api/ask/doc): a per-person cookie is
// only as good as its key ROW. A revoked key's cookie with a far-future
// embedded expiry is refused; so is an expired key's and a deleted key's.
check('portalCookieGrants: revoked, expired and deleted keys are refused whatever the cookie says', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const cookie = parseCookieValue(cookieValue(id, 1_800_000_000)); // exp in 2027
  assert.equal(cookie.legacy, false);
  const live = { expires_at: '2026-12-22T12:00:00Z', revoked_at: null };
  assert.equal(portalCookieGrants(cookie, live, now), true);
  assert.equal(portalCookieGrants(cookie, { ...live, revoked_at: '2026-09-23T11:00:00Z' }, now), false, 'revoked');
  assert.equal(portalCookieGrants(cookie, { expires_at: '2026-09-23T11:59:59Z', revoked_at: null }, now), false, 'expired row');
  assert.equal(portalCookieGrants(cookie, null, now), false, 'deleted key');
  assert.equal(portalCookieGrants(null, live, now), false, 'no cookie');
  assert.equal(portalCookieGrants({ legacy: true }, null, now), true, 'legacy team key needs no row');
});

check('requestsOpen: the request form is closed until an approved domain is configured', () => {
  assert.equal(requestsOpen(undefined), false);
  assert.equal(requestsOpen(''), false);
  assert.equal(requestsOpen(' , ,'), false);
  assert.equal(requestsOpen('example.com'), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
