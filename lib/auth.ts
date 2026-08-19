import { cookies } from 'next/headers';
import crypto from 'node:crypto';

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

function verify(token: string | undefined, expected: 'admin' | 'portal'): boolean {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const value = token.slice(0, i);
  const sig = token.slice(i + 1);
  const want = hmac(value);
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b) && value === expected;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verify(store.get(ADMIN_COOKIE)?.value, 'admin');
}

// The portal tier: a signed cookie unlocked by the shared team key (PORTAL_KEY).
// It grants exactly one thing beyond the public surface: the billable portal
// features (/api/portal/ask and key-gated dataset downloads). It carries no
// write authority and no personal-layer access; admins pass implicitly.
export async function isPortal(): Promise<boolean> {
  const store = await cookies();
  if (verify(store.get(ADMIN_COOKIE)?.value, 'admin')) return true;
  return verify(store.get(PORTAL_COOKIE)?.value, 'portal');
}

export async function setPortalSession(): Promise<void> {
  const store = await cookies();
  store.set(PORTAL_COOKIE, sign('portal'), baseCookie);
}

// Same shape as checkPassword: fail closed when PORTAL_KEY is unset (the portal
// features are simply off), fixed-length HMAC digests so neither timing nor
// length leaks. Rotating PORTAL_KEY stops NEW unlocks only; already-issued
// portal cookies are signed by AUTH_SECRET and live out their 30 days unless
// AUTH_SECRET itself is rotated (which also logs the admin out).
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
