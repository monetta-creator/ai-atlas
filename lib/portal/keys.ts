import crypto from 'node:crypto';

// Per-person access keys (migration 0060), the pure half. Format
// atlas_<prefix8>_<secret32> over a lowercase base32 alphabet: the prefix is
// stored in clear (unique, the lookup key), the whole key only as an
// HMAC-SHA256 under AUTH_SECRET. The signed portal cookie carries
// `portal:<keyId>:<expEpochSeconds>`; the legacy shared team key still signs
// the bare value `portal`. Dependency-free apart from node:crypto so
// scripts/test-portal-keys.mjs loads it under plain Node.

export const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const KEY_PREFIX_LEN = 8;
export const KEY_SECRET_LEN = 32;
const KEY_RE = /^atlas_([a-z2-7]{8})_([a-z2-7]{32})$/;
const COOKIE_RE = /^portal:([0-9a-f-]{36}):(\d{1,12})$/;

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

export type PortalCookie = { legacy: true } | { legacy: false; keyId: string; exp: number };

export function cookieValue(keyId: string, expEpochSeconds: number): string {
  return `portal:${keyId}:${Math.floor(expEpochSeconds)}`;
}

// The signed value with its signature already stripped (lib/auth.ts verifies).
export function parseCookieValue(value: string): PortalCookie | null {
  if (value === 'portal') return { legacy: true };
  const m = COOKIE_RE.exec(value);
  if (!m) return null;
  return { legacy: false, keyId: m[1], exp: Number(m[2]) };
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

// The portal-cookie decision, pure: a legacy team-key cookie grants on its
// own; a per-person cookie grants only while its key ROW is active (so a
// revoked or expired key is refused at once, whatever expiry the cookie
// carries). `row` is the portal_keys row for the cookie's key id, null when
// the key no longer exists. lib/auth.ts isPortal() applies this after the
// signature check and the row lookup.
export function portalCookieGrants(
  cookie: PortalCookie | null,
  row: { expires_at: string | Date; revoked_at: string | Date | null } | null,
  now: Date = new Date()
): boolean {
  if (!cookie) return false;
  if (cookie.legacy) return true;
  if (!row) return false;
  return keyState(row, now) === 'active';
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
