// Tests for lib/portal/keys.ts (per-person access keys, the pure half).
// Pure, no DB. Run: node scripts/test-portal-keys.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateKey, parseKey, hashKey, hashesEqual, cookieValue, parseCookieValue, magicLink,
  keyState, expiresInDays, renewalDate, parseDomainList, emailAllowed, portalCookieGrants, requestsOpen,
  legacyFingerprint, legacyCookieValue, legacyCookieGrants, headerKey, decideIdentity, verifySigned,
  NONE, ADMIN, LEGACY,
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

check('cookie value: legacy (bare and fingerprinted) and per-key forms round-trip', () => {
  assert.deepEqual(parseCookieValue('portal'), { legacy: true, fp: null });
  const secret = 's'.repeat(32);
  const fp = legacyFingerprint(secret, 'team-key');
  assert.match(fp, /^[0-9a-f]{16}$/);
  const legacyValue = legacyCookieValue(secret, 'team-key');
  assert.equal(legacyValue, `portal:legacy:${fp}`);
  assert.deepEqual(parseCookieValue(legacyValue), { legacy: true, fp });
  const id = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
  const v = cookieValue(id, 1_800_000_000.9);
  assert.equal(v, `portal:${id}:1800000000`);
  assert.deepEqual(parseCookieValue(v), { legacy: false, keyId: id, exp: 1_800_000_000 });
  for (const bad of ['admin', 'portal:', `portal:${id}`, `portal:${id}:abc`, `portal:${id}:1:2`, 'portalx', 'portal:legacy:', 'portal:legacy:zz', `portal:legacy:${fp}x`]) {
    assert.equal(parseCookieValue(bad), null, bad);
  }
});

check('legacyFingerprint: stable per secret+key, differs across either', () => {
  const secret = 's'.repeat(32);
  const a = legacyFingerprint(secret, 'key-one');
  assert.equal(a, legacyFingerprint(secret, 'key-one'));
  assert.notEqual(a, legacyFingerprint('t'.repeat(32), 'key-one'), 'secret rotation changes it');
  assert.notEqual(a, legacyFingerprint(secret, 'key-two'), 'key rotation changes it');
});

check('legacyCookieGrants: unset key refuses everything, bare cookie ages in, matching/rotated fp', () => {
  const secret = 's'.repeat(32);
  const fp = legacyFingerprint(secret, 'team-key');
  // Unsetting PORTAL_KEY logs every legacy holder out at once, fp or not.
  assert.equal(legacyCookieGrants(null, secret, undefined), false, 'unset key, bare cookie');
  assert.equal(legacyCookieGrants(fp, secret, undefined), false, 'unset key, fingerprinted cookie');
  assert.equal(legacyCookieGrants(null, secret, ''), false, 'empty-string key, bare cookie');
  // A cookie minted before the fingerprint change (fp === null) is honored
  // regardless of the current key, until its own 30-day maxAge ages it out.
  assert.equal(legacyCookieGrants(null, secret, 'team-key'), true, 'bare cookie, key set');
  assert.equal(legacyCookieGrants(null, secret, 'a-different-key'), true, 'bare cookie survives rotation too');
  // A fingerprinted cookie is honored only while its fp matches the CURRENT key.
  assert.equal(legacyCookieGrants(fp, secret, 'team-key'), true, 'matching fp');
  assert.equal(legacyCookieGrants(fp, secret, 'rotated-key'), false, 'rotated key invalidates the old fp');
  assert.equal(legacyCookieGrants(fp, 't'.repeat(32), 'team-key'), false, 'rotated secret invalidates the old fp');
});

check('headerKey: Bearer atlas_, Bearer legacy-shaped, X-Atlas-Key, empty, missing', () => {
  const get = (map) => (name) => map[name.toLowerCase()] ?? null;
  assert.equal(headerKey(get({ authorization: 'Bearer atlas_abcdefgh_' + 'a'.repeat(32) })), 'atlas_abcdefgh_' + 'a'.repeat(32));
  assert.equal(headerKey(get({ authorization: 'Bearer some-legacy-key' })), 'some-legacy-key');
  assert.equal(headerKey(get({ authorization: 'bearer   spaced-out  ' })), 'spaced-out');
  assert.equal(headerKey(get({ 'x-atlas-key': 'atlas_abcdefgh_' + 'a'.repeat(32) })), 'atlas_abcdefgh_' + 'a'.repeat(32));
  assert.equal(headerKey(get({ 'x-atlas-key': '  ' })), null, 'blank header value');
  assert.equal(headerKey(get({ authorization: 'Bearer' })), null, 'no token after Bearer');
  assert.equal(headerKey(get({ authorization: 'Basic dXNlcjpwYXNz' })), null, 'wrong scheme');
  assert.equal(headerKey(get({})), null, 'no headers at all');
});

check('decideIdentity: all six branches', () => {
  const activeHeader = { ...LEGACY };
  const lapsedHeader = { ...NONE, tier: 'key', state: 'expired' };
  const cookie = { ...LEGACY, name: 'cookie-identity' };

  // no header
  assert.deepEqual(decideIdentity({ header: null, admin: true, cookie }), ADMIN, 'no header, admin -> ADMIN');
  assert.deepEqual(decideIdentity({ header: null, admin: false, cookie }), cookie, 'no header, not admin -> cookie');
  // header active always wins, admin or not
  assert.deepEqual(decideIdentity({ header: activeHeader, admin: true, cookie }), activeHeader, 'active header, admin -> header');
  assert.deepEqual(decideIdentity({ header: activeHeader, admin: false, cookie }), activeHeader, 'active header, not admin -> header');
  // header inactive falls back to admin, never the cookie
  assert.deepEqual(decideIdentity({ header: lapsedHeader, admin: true, cookie }), ADMIN, 'lapsed header, admin -> ADMIN');
  assert.deepEqual(decideIdentity({ header: lapsedHeader, admin: false, cookie }), lapsedHeader, 'lapsed header, not admin -> the lapsed header, never cookie');
});

check('verifySigned: round-trips, rejects tampering, wrong secret, and malformed tokens', () => {
  const secret = 's'.repeat(32);
  const sign = (v, s) => `${v}.${crypto.createHmac('sha256', s).update(v).digest('hex')}`;
  const token = sign('admin', secret);
  assert.equal(verifySigned(token, secret), 'admin');
  assert.equal(verifySigned(token.slice(0, -1) + (token.at(-1) === '0' ? '1' : '0'), secret), null, 'tampered signature');
  assert.equal(verifySigned(sign('admin', 't'.repeat(32)), secret), null, 'wrong secret');
  assert.equal(verifySigned('admin', secret), null, 'no dot');
  assert.equal(verifySigned('', secret), null, 'empty');
  assert.equal(verifySigned(undefined, secret), null, 'missing');
  // A value that itself contains a dot: split on the LAST dot.
  const dotted = sign('portal:legacy:abc', secret);
  assert.equal(verifySigned(dotted, secret), 'portal:legacy:abc');
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
});

check('portalCookieGrants: the legacy branch defers to legacyCookieGrants (needs no row, but does need env)', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const secret = 's'.repeat(32);
  const fp = legacyFingerprint(secret, 'team-key');
  assert.equal(portalCookieGrants({ legacy: true, fp: null }, null, now, { secret, portalKey: 'team-key' }), true, 'bare legacy cookie, key set');
  assert.equal(portalCookieGrants({ legacy: true, fp }, null, now, { secret, portalKey: 'team-key' }), true, 'fingerprinted, matching key');
  assert.equal(portalCookieGrants({ legacy: true, fp }, null, now, { secret, portalKey: 'rotated' }), false, 'fingerprinted, rotated key');
  // No env passed = no portalKey to check against = fail closed, even for the
  // once-unconditional bare-cookie branch.
  assert.equal(portalCookieGrants({ legacy: true, fp: null }, null, now), false, 'no env supplied');
});

check('requestsOpen: the request form is closed until an approved domain is configured', () => {
  assert.equal(requestsOpen(undefined), false);
  assert.equal(requestsOpen(''), false);
  assert.equal(requestsOpen(' , ,'), false);
  assert.equal(requestsOpen('example.com'), true);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
