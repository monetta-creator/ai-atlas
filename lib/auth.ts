import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import { cache } from 'react';
import { one } from './db';
import {
  cookieValue, legacyCookieGrants, legacyCookieValue, parseCookieValue, portalCookieGrants,
  verifySigned, type PortalCookie,
} from './portal/keys';

// The Admin/Guest gate. Admin sessions are a signed HMAC cookie; the guest
// cookie is a non-privileged UX flag. The security boundary (can a guest see
// the personal layer or mutate?) is enforced by isAdmin() in every server
// component and server action — never by the client.

const ADMIN_COOKIE = 'atlas_admin';
const GUEST_COOKIE = 'atlas_guest';
const EDIT_COOKIE = 'atlas_edit';
const PREVIEW_COOKIE = 'atlas_preview';
const PORTAL_COOKIE = 'atlas_portal';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Fail CLOSED: no usable default. A missing/short secret throws rather than
// silently falling back to a public constant (which would let anyone who read
// the source forge an admin cookie).
function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_SECRET is required and must be at least 32 characters.');
  }
  return s;
}

function hmac(value: string): string {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function sign(value: string): string {
  return `${value}.${hmac(value)}`;
}

// The signed value, or null when the signature does not verify. The split
// and constant-time compare live in lib/portal/keys.ts (verifySigned) so
// they are pure and testable under plain Node; this just supplies the secret.
function signedValue(token: string | undefined): string | null {
  return verifySigned(token, secret());
}

function verify(token: string | undefined, expected: 'admin' | 'portal'): boolean {
  return signedValue(token) === expected;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verify(store.get(ADMIN_COOKIE)?.value, 'admin');
}

// The admin PAGE gate: call first in every admin-only page. Centralizing the
// redirect makes "forgot the gate line" impossible on new pages (the failure
// mode behind the one real guest leak this app has had). Returns true so pages
// can keep an `admin` flag for props: `const admin = await requireAdminPage()`.
export async function requireAdminPage(): Promise<true> {
  if (!(await isAdmin())) redirect('/login');
  return true;
}

// The portal tier: a signed cookie unlocked by an access key. Two cookie
// values verify: the legacy `portal` (the shared PORTAL_KEY team key) and the
// per-person `portal:<keyId>:<expEpochSeconds>` (migration 0060). It grants the
// billable portal features (/api/portal/ask, key-gated datasets, tooling
// reports, Scout research tools), no write authority, no personal layer;
// admins pass implicitly.
//
// isPortal() is AUTHORITATIVE: for a per-person cookie it resolves the key
// row (one primary-key lookup, cached per request) and grants only while the
// key is active, so Revoke in the /access console stops every gated surface
// at once, whatever expiry the cookie carries. isPortalCookie() is the cheap
// cookie-only read for the site chrome (lib/chrome-viewer.ts), where the only
// consequence of a stale cookie is a portal-tier nav leaf that then 401s.
// lib/portal/identity.ts builds on the same cookie read and adds header keys.
export async function readPortalCookie(): Promise<PortalCookie | null> {
  const store = await cookies();
  const value = signedValue(store.get(PORTAL_COOKIE)?.value);
  return value ? parseCookieValue(value) : null;
}

interface PortalKeyStateRow { expires_at: string; revoked_at: string | null }

const portalKeyStateRow = cache(async (keyId: string): Promise<PortalKeyStateRow | null> =>
  one<PortalKeyStateRow>(
    `select expires_at::text as expires_at, revoked_at::text as revoked_at from portal_keys where id = $1::uuid`,
    [keyId]
  )
);

export async function isPortalCookie(): Promise<boolean> {
  const store = await cookies();
  if (verify(store.get(ADMIN_COOKIE)?.value, 'admin')) return true;
  const c = parseCookieValue(signedValue(store.get(PORTAL_COOKIE)?.value) ?? '');
  if (!c) return false;
  return c.legacy || c.exp * 1000 > Date.now();
}

export async function isPortal(): Promise<boolean> {
  const store = await cookies();
  if (verify(store.get(ADMIN_COOKIE)?.value, 'admin')) return true;
  const c = parseCookieValue(signedValue(store.get(PORTAL_COOKIE)?.value) ?? '');
  if (!c) return false;
  if (c.legacy) return legacyCookieGrants(c.fp, secret(), process.env.PORTAL_KEY);
  return portalCookieGrants(c, await portalKeyStateRow(c.keyId));
}

// No arguments = the legacy team-key session, whose cookie value is minted
// bound to the CURRENT PORTAL_KEY (legacyCookieValue in lib/portal/keys.ts;
// see the kill-switch note on checkPortalKey below). With a key id and
// expiry, the per-person session; the cookie itself still lives MAX_AGE, the
// embedded expiry is what the cheap isPortalCookie() checks (isPortal() reads
// the row).
export async function setPortalSession(key?: { keyId: string; expiresAt: Date }): Promise<void> {
  const store = await cookies();
  const value = key
    ? cookieValue(key.keyId, Math.floor(key.expiresAt.getTime() / 1000))
    : legacyCookieValue(secret(), process.env.PORTAL_KEY ?? '');
  store.set(PORTAL_COOKIE, sign(value), baseCookie);
}

export async function clearPortalSession(): Promise<void> {
  const store = await cookies();
  store.delete(PORTAL_COOKIE);
}

// Same shape as checkPassword: fail closed when PORTAL_KEY is unset (the portal
// features are simply off), fixed-length HMAC digests so neither timing nor
// length leaks.
//
// Kill switch (the legacy cookie is fingerprinted to the key it was minted
// under, legacyCookieGrants in lib/portal/keys.ts): unsetting PORTAL_KEY logs
// every legacy holder out AT ONCE, not just new unlocks, because
// legacyCookieGrants refuses every legacy cookie once there is no current key
// to fingerprint against. Rotating PORTAL_KEY logs out every legacy cookie
// minted after this change immediately (its fingerprint no longer matches
// the new key); a bare cookie minted BEFORE this change carries no
// fingerprint and keeps working until it ages out on its own within its
// 30-day maxAge, since there is nothing on it to invalidate. AUTH_SECRET
// rotation still kills every cookie outright (the signature itself stops
// verifying, admin included).
export function checkPortalKey(input: string): boolean {
  const expected = process.env.PORTAL_KEY;
  if (!expected) return false;
  const a = Buffer.from(hmac(input));
  const b = Buffer.from(hmac(expected));
  return crypto.timingSafeEqual(a, b);
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // fail closed
  // Compare fixed-length HMAC digests so neither the comparison time nor the
  // buffer length leaks anything about the real password.
  const a = Buffer.from(hmac(input));
  const b = Buffer.from(hmac(expected));
  return crypto.timingSafeEqual(a, b);
}

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: MAX_AGE,
};

export async function setAdminSession(): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_COOKIE, sign('admin'), baseCookie);
  // Admin sessions set ONLY the signed admin cookie — deliberately NOT atlas_guest. The
  // proxy's presence gate already admits any request bearing atlas_admin, so the guest
  // cookie is redundant here; setting it made an admin session indistinguishable from a
  // guest's by cookie alone (an admin "testing as a guest" still held atlas_admin and could
  // publish — the source of a false "guest could publish" report). Now atlas_guest present
  // ⟺ genuinely a guest. Role is always decided by isAdmin(), never by atlas_guest's presence.
}

export async function setGuestSession(): Promise<void> {
  const store = await cookies();
  store.set(GUEST_COOKIE, '1', baseCookie);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.delete(GUEST_COOKIE);
  store.delete(EDIT_COOKIE);
  store.delete(PREVIEW_COOKIE);
  store.delete(PORTAL_COOKIE);
}

// Preview-as-guest (admin-only). When on, the admin sees the public share view
// exactly as a guest would — personal layer stripped, admin affordances hidden —
// without signing out. It is purely a rendering flag: isAdmin() stays true (so the
// admin can still exit preview and act), and pages compute personal = admin && !preview.
export async function isPreview(): Promise<boolean> {
  const store = await cookies();
  return store.get(PREVIEW_COOKIE)?.value === '1';
}

export async function setPreview(on: boolean): Promise<void> {
  const store = await cookies();
  if (on) store.set(PREVIEW_COOKIE, '1', baseCookie);
  else store.delete(PREVIEW_COOKIE);
}

// A public share link drops a recipient into guest mode without a login. The token
// is derived from AUTH_SECRET (not a secret — it grants only the already-public map),
// so it is stable and unguessable, and can be rotated by rotating AUTH_SECRET.
export function shareToken(): string {
  return hmac('share');
}

export function verifyShareToken(token: string | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(shareToken());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Edit-mode flag (admin-only). Unsigned — it carries no authority on its own:
// getEditContext() ANDs it with isAdmin(), and every write re-checks requireAdmin().
export async function isEditMode(): Promise<boolean> {
  const store = await cookies();
  return store.get(EDIT_COOKIE)?.value === '1';
}

export async function setEditMode(on: boolean): Promise<void> {
  const store = await cookies();
  if (on) store.set(EDIT_COOKIE, '1', baseCookie);
  else store.delete(EDIT_COOKIE);
}
