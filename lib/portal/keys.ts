import crypto from 'node:crypto';

// Per-person access keys (migration 0060), the pure half. Format
// atlas_<prefix8>_<secret32> over a lowercase base32 alphabet: the prefix is
// stored in clear (unique, the lookup key), the whole key only as an
// HMAC-SHA256 under AUTH_SECRET. The signed portal cookie carries
// `portal:<keyId>:<expEpochSeconds>`; the legacy shared team key signs
// `portal:legacy:<fp>` (a fingerprint of the CURRENT PORTAL_KEY, so rotating
// or unsetting it invalidates already-issued legacy cookies — see
// legacyCookieGrants below). Also holds the pure identity-decision helpers
// (headerKey, decideIdentity, verifySigned) and the PortalIdentity shape so
// lib/portal/identity.ts (which needs next/headers) can stay a thin,
// DB-touching wrapper around logic scripts/test-portal-keys.mjs can run under
// plain Node. Dependency-free apart from node:crypto.

export const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const KEY_PREFIX_LEN = 8;
export const KEY_SECRET_LEN = 32;
const KEY_RE = /^atlas_([a-z2-7]{8})_([a-z2-7]{32})$/;
const COOKIE_RE = /^portal:([0-9a-f-]{36}):(\d{1,12})$/;
const LEGACY_COOKIE_RE = /^portal:legacy:([0-9a-f]{16})$/;
const LEGACY_FP_LEN = 16;

export type RandomBytes = (n: number) => Uint8Array;

function encode(bytes: Uint8Array, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) out += KEY_ALPHABET[bytes[i] % 32];
  return out;
}

export function generateKey(rand: RandomBytes = (n) => crypto.randomBytes(n)): { key: string; prefix: string } {
  const prefix = encode(rand(KEY_PREFIX_LEN), KEY_PREFIX_LEN);
  const secret = encode(rand(KEY_SECRET_LEN), KEY_SECRET_LEN);
  return { key: `atlas_${prefix}_${secret}`, prefix };
}

export function parseKey(input: string): { prefix: string; key: string } | null {
  const m = KEY_RE.exec(input.trim());
  return m ? { prefix: m[1], key: m[0] } : null;
}

export function hashKey(secret: string, key: string): string {
  return crypto.createHmac('sha256', secret).update(key).digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// `fp: null` is a cookie minted before the legacy-fingerprint change (the
// bare `portal` value) — legacyCookieGrants ages those out within 30 days
// (the cookie's own maxAge) rather than refusing them outright, so a live
// session is not killed mid-flight by this change alone.
export type PortalCookie =
  | { legacy: true; fp: string | null }
  | { legacy: false; keyId: string; exp: number };

// First 16 hex chars of HMAC-SHA256(secret, 'legacy:' + portalKey): binds the
// legacy cookie to the PORTAL_KEY value active when it was minted, without
// putting the key itself in a cookie. Same secret + same key -> same
// fingerprint; either one changing (PORTAL_KEY rotated, or AUTH_SECRET
// rotated, which invalidates the whole cookie's signature anyway) changes it.
export function legacyFingerprint(secret: string, portalKey: string): string {
  return crypto.createHmac('sha256', secret).update(`legacy:${portalKey}`).digest('hex').slice(0, LEGACY_FP_LEN);
}

export function legacyCookieValue(secret: string, portalKey: string): string {
  return `portal:legacy:${legacyFingerprint(secret, portalKey)}`;
}

export function cookieValue(keyId: string, expEpochSeconds: number): string {
  return `portal:${keyId}:${Math.floor(expEpochSeconds)}`;
}

// The signed value with its signature already stripped (lib/auth.ts verifies).
export function parseCookieValue(value: string): PortalCookie | null {
  if (value === 'portal') return { legacy: true, fp: null };
  const legacy = LEGACY_COOKIE_RE.exec(value);
  if (legacy) return { legacy: true, fp: legacy[1] };
  const m = COOKIE_RE.exec(value);
  if (!m) return null;
  return { legacy: false, keyId: m[1], exp: Number(m[2]) };
}

// The legacy-tier decision, pure. Unsetting PORTAL_KEY logs every legacy
// holder out at once (the surface this class of cookie can even grant goes
// dark, so there is nothing left to fingerprint against). A cookie with no fp
// (minted before this change) is honored until it ages out on its own 30-day
// maxAge. A cookie WITH an fp is honored only while it still matches the
// CURRENT PORTAL_KEY, so rotating the key logs out every legacy holder minted
// after this change immediately (a fresh unlock re-mints against the new
// key). AUTH_SECRET rotation invalidates the cookie's signature before this
// function is ever reached, so it is not a case this function needs to know.
export function legacyCookieGrants(fp: string | null, secret: string, portalKey: string | undefined | null): boolean {
  if (!portalKey) return false;
  if (fp === null) return true;
  return fp === legacyFingerprint(secret, portalKey);
}

export function magicLink(base: string, key: string): string {
  return `${base.replace(/\/+$/, '')}/datasets/enter?k=${encodeURIComponent(key)}`;
}

export type KeyState = 'active' | 'expired' | 'revoked';

export function keyState(row: { expires_at: string | Date; revoked_at: string | Date | null }, now: Date = new Date()): KeyState {
  if (row.revoked_at) return 'revoked';
  const exp = new Date(row.expires_at).getTime();
  if (!Number.isFinite(exp) || exp <= now.getTime()) return 'expired';
  return 'active';
}

// The portal-cookie decision, pure: a legacy team-key cookie grants only
// while its fingerprint still matches the CURRENT PORTAL_KEY (legacyCookieGrants,
// above); a per-person cookie grants only while its key ROW is active (so a
// revoked or expired key is refused at once, whatever expiry the cookie
// carries). `row` is the portal_keys row for the cookie's key id, null when
// the key no longer exists. `env` carries the AUTH_SECRET/PORTAL_KEY inputs
// the legacy branch needs; callers that only ever pass a per-person cookie
// (the common case) can omit it. lib/auth.ts isPortal() applies this after
// the signature check and the row lookup.
export function portalCookieGrants(
  cookie: PortalCookie | null,
  row: { expires_at: string | Date; revoked_at: string | Date | null } | null,
  now: Date = new Date(),
  env?: { secret: string; portalKey: string | undefined | null }
): boolean {
  if (!cookie) return false;
  if (cookie.legacy) return legacyCookieGrants(cookie.fp, env?.secret ?? '', env?.portalKey);
  if (!row) return false;
  return keyState(row, now) === 'active';
}

// ---- Portal identity: type, constants, and pure decision helpers ----------
// Moved here (from lib/portal/identity.ts, which needs next/headers and a DB
// row lookup) so the decision logic is testable under plain Node. identity.ts
// re-exports PortalIdentity/PortalTier so existing importers are unaffected.

export type PortalTier = 'admin' | 'key' | 'legacy' | 'none';

export interface PortalIdentity {
  tier: PortalTier;
  keyId: string | null;
  name: string | null;
  state: KeyState | 'none';
  expiresAt: string | null;
  // True when the caller may use the portal features right now.
  active: boolean;
}

export const NONE: PortalIdentity = { tier: 'none', keyId: null, name: null, state: 'none', expiresAt: null, active: false };
export const ADMIN: PortalIdentity = { tier: 'admin', keyId: null, name: null, state: 'active', expiresAt: null, active: true };
export const LEGACY: PortalIdentity = { tier: 'legacy', keyId: null, name: null, state: 'active', expiresAt: null, active: true };

// Pull the caller's key out of either header a script or extension might send
// (Authorization: Bearer <key>, or X-Atlas-Key: <key>), so an intake script
// written against one keeps working if it switches to the other. `get` is a
// case-insensitive header getter (Headers#get already is); passed as a plain
// function so this stays free of the DOM Headers type.
export function headerKey(get: (name: string) => string | null): string | null {
  const auth = get('authorization');
  if (auth && /^bearer\s+\S/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const x = get('x-atlas-key');
  return x && x.trim() ? x.trim() : null;
}

// The identity-precedence decision, pure: no header -> admin wins over the
// cookie; an ACTIVE header always wins (even over an admin cookie, so a
// script's stale or revoked header key never silently upgrades to admin
// because the same browser also holds an admin cookie); an INACTIVE header
// falls back to admin, never to the cookie (a lapsed header key should not
// resurrect a DIFFERENT identity than the one the caller explicitly sent).
export function decideIdentity({
  header, admin, cookie,
}: { header: PortalIdentity | null; admin: boolean; cookie: PortalIdentity }): PortalIdentity {
  if (!header) return admin ? ADMIN : cookie;
  if (header.active) return header;
  return admin ? ADMIN : header;
}

// The HMAC split/verify lib/auth.ts's signed cookies share: `token` is
// `value.hexsig`, split on the LAST dot (a value may itself contain dots).
// Returns the value when the signature verifies against `secret`, else null.
// Fixed-length HMAC digests compared via timingSafeEqual so neither the
// comparison time nor a length mismatch leaks anything about the secret.
export function verifySigned(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const value = token.slice(0, i);
  const sig = token.slice(i + 1);
  const want = crypto.createHmac('sha256', secret).update(value).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? value : null;
}

export function expiresInDays(expiresAt: string | Date, now: Date = new Date()): number {
  return Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
}

export function renewalDate(expiresAt: string | Date, days: number, now: Date = new Date()): Date {
  const base = Math.max(new Date(expiresAt).getTime(), now.getTime());
  return new Date(base + days * 86_400_000);
}

// The request form's work-email allow-list (PORTAL_REQUEST_EMAIL_DOMAINS, a
// comma list). Empty list = any well-formed address here; the request route
// and page fail closed on an empty list instead (requestsOpen()). Subdomains
// of a listed domain are allowed.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseDomainList(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

// Whether the public request form is open: it needs at least one approved
// domain, or the route refuses with 503 and the page shows a notice.
export function requestsOpen(value: string | undefined | null): boolean {
  return parseDomainList(value).length > 0;
}

export function emailAllowed(email: string, domains: string[]): boolean {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  if (!domains.length) return true;
  const host = e.slice(e.lastIndexOf('@') + 1);
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
