import { cache } from 'react';
import { headers } from 'next/headers';
import crypto from 'node:crypto';
import { one, exec } from '../db';
import { checkPortalKey, isAdmin, readPortalCookie } from '../auth';
import { createLimiter } from '../rate-limit';
import {
  decideIdentity, hashKey, hashesEqual, headerKey as pureHeaderKey, keyState, LEGACY, legacyCookieGrants,
  NONE, parseKey, type PortalIdentity, type PortalTier,
} from './keys';

// Who is calling a portal surface (migration 0060). isPortal() in lib/auth.ts
// answers the yes/no question (and, like this module, resolves the per-person
// key row so revocation and expiry are enforced); this is the richer identity
// the gated routes, the billable routes and the portal pages use when they
// need the key id (per-key budget, usage rows) or the lapsed-key message. It
// also accepts a key sent as a header (Authorization: Bearer atlas_... or
// X-Atlas-Key) so intake scripts on the far side of a firewall need no cookie.
// Cached per request with React cache().
//
// PortalIdentity/PortalTier and the NONE/ADMIN/LEGACY identities, plus the
// pure decision helpers (headerKey, decideIdentity, legacyCookieGrants), now
// live in ./keys.ts so scripts/test-portal-keys.mjs can run them under plain
// Node; re-exported here so existing importers of this module are unaffected.
export type { PortalIdentity, PortalTier };

interface KeyRow { id: string; name: string; key_hash: string; expires_at: string; revoked_at: string | null }

function fromRow(row: KeyRow): PortalIdentity {
  const state = keyState(row);
  return { tier: 'key', keyId: row.id, name: row.name, state, expiresAt: new Date(row.expires_at).toISOString(), active: state === 'active' };
}

async function byId(keyId: string): Promise<PortalIdentity> {
  const row = await one<KeyRow>(
    `select id::text as id, name, key_hash, expires_at::text as expires_at, revoked_at::text as revoked_at
       from portal_keys where id = $1::uuid`,
    [keyId]
  );
  return row ? fromRow(row) : NONE;
}

// A full key from a header or the enter link: look the prefix up, compare the
// HMAC in constant time. Unknown prefix and wrong secret are indistinguishable
// in the body AND in timing: the HMAC is always computed and always compared
// (against a same-length dummy when no row matched the prefix).
export async function identityFromKey(input: string): Promise<PortalIdentity> {
  const parsed = parseKey(input);
  if (!parsed) return NONE;
  const secret = process.env.AUTH_SECRET;
  if (!secret) return NONE;
  const row = await one<KeyRow>(
    `select id::text as id, name, key_hash, expires_at::text as expires_at, revoked_at::text as revoked_at
       from portal_keys where key_prefix = $1`,
    [parsed.prefix]
  );
  const got = hashKey(secret, parsed.key);
  const want = row?.key_hash ?? got.replace(/./, (c) => (c === '0' ? '1' : '0'));
  const match = hashesEqual(want, got);
  if (!row || !match) return NONE;
  return fromRow(row);
}

// The cookie-only identity (no header involved, no admin check — resolve()
// below supplies admin separately so it is checked exactly once per call).
async function cookieIdentity(): Promise<PortalIdentity> {
  const c = await readPortalCookie();
  if (!c) return NONE;
  if (c.legacy) return legacyCookieGrants(c.fp, process.env.AUTH_SECRET ?? '', process.env.PORTAL_KEY) ? LEGACY : NONE;
  return byId(c.keyId);
}

// Either header carries a per-person key (atlas_...) or the legacy shared
// PORTAL_KEY, so an intake script written against the team key keeps working
// once it moves from the enter link to a header.
function headerKey(h: Headers): string | null {
  return pureHeaderKey((name) => h.get(name));
}

// Shared with the two other sessionless legacy-key entry points
// (app/ask/actions.ts unlockPortalAction, app/datasets/enter/route.ts): counts
// FAILURES of the legacy PORTAL_KEY compare per client. Per-person atlas_
// keys are never throttled here (160-bit, prefix-looked-up; brute-forcing is
// not a realistic threat the way a short admin-chosen team key is).
export const legacyKeyLimiter = createLimiter({ max: 10, windowMs: 10 * 60_000 });

// The client key the limiter buckets on: a hash of the caller's first
// forwarded-for hop (hashIp below), never the address itself, namespaced by
// entry point ('hdr' for the Authorization/X-Atlas-Key header path below,
// 'form' for the two interactive unlock forms). Without the namespace all
// three shared one bucket per IP: a stale intake script retrying a dead
// legacy key from a corporate NAT's header would burn the same 10-per-10min
// budget as a colleague typing the current key into the unlock form on that
// same NAT, locking them out with no visible signal (NO_MATCH is
// indistinguishable from a wrong key by design). `get` is a case-insensitive
// header getter, so callers pass Headers#get directly (route handlers, this
// module) or a closure over next/headers' headers() (server actions, which
// have no Request to read).
export function legacyLimiterKey(get: (name: string) => string | null, scope: 'hdr' | 'form'): string {
  const ip = get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return hashIp(`${scope}:${ip}`);
}

// A raw key from a header: a per-person atlas_ key resolves by row lookup
// (identityFromKey, not throttled). Anything else is a legacy PORTAL_KEY
// guess, throttled by legacyKeyLimiter: a limited client skips the compare
// entirely and gets NONE, the same outcome as a wrong key, so the limiter is
// never itself observable from the response (never a distinct "rate
// limited" signal, which would turn the throttle into a second oracle).
async function headerIdentity(key: string, h: Headers): Promise<PortalIdentity> {
  if (parseKey(key)) return identityFromKey(key);
  const clientKey = legacyLimiterKey((name) => h.get(name), 'hdr');
  const allowed = legacyKeyLimiter.allow(clientKey);
  const match = allowed && checkPortalKey(key);
  if (match) legacyKeyLimiter.reset(clientKey);
  else if (allowed) legacyKeyLimiter.fail(clientKey);
  return match ? LEGACY : NONE;
}

// The identity-precedence decision (decideIdentity, lib/portal/keys.ts) applied
// to a real request: an active header always wins; an inactive one still beats
// the cookie but falls back to admin first (so a stale key in a script or
// extension header never locks the admin out); no header at all defers to the
// cookie. The cookie identity is resolved (a possible DB row lookup) only when
// there is no header to prefer, same as the pre-decideIdentity code.
async function resolve(h: Headers): Promise<PortalIdentity> {
  const key = headerKey(h);
  const header = key ? await headerIdentity(key, h) : null;
  const admin = await isAdmin();
  const cookie = header ? NONE : await cookieIdentity();
  return decideIdentity({ header, admin, cookie });
}

// Cookie identity for pages and server actions (the request headers are
// consulted too, so a script's header key works on API routes that call this).
export const getPortalIdentity = cache(async (): Promise<PortalIdentity> => {
  const h = await headers();
  return resolve(h);
});

// Route-handler variant taking the Request (avoids next/headers in tests).
export async function identityFromRequest(req: Request): Promise<PortalIdentity> {
  return resolve(req.headers);
}

// Bookkeeping: last_used_at on the key. Never rejects; callers that must
// outlive the response await it inside next/server's after().
export function touchKey(keyId: string | null): Promise<void> {
  if (!keyId) return Promise.resolve();
  return exec(`update portal_keys set last_used_at = now() where id = $1::uuid`, [keyId]).then(() => undefined, () => undefined);
}

// For the request form: an HMAC of the caller's address, never the address.
// Fails closed like secret() in lib/auth.ts: no empty-key HMAC.
export function hashIp(ip: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET is missing or too short');
  return crypto.createHmac('sha256', secret).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

// Copy for the 401 bodies and the renewal notice, one place.
export function unauthorizedMessage(identity: PortalIdentity): { status: 401; body: { error: string; message: string }; headers: Record<string, string> } {
  const base = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (identity.state === 'expired') {
    const day = identity.expiresAt ? identity.expiresAt.slice(0, 10) : 'recently';
    return { status: 401, body: { error: 'key_expired', message: `This access key expired on ${day}. Ask the maintainer to renew it; your saved views are kept.` }, headers: { ...base, 'X-Atlas-Key-State': 'expired' } };
  }
  if (identity.state === 'revoked') {
    return { status: 401, body: { error: 'key_revoked', message: 'This access key was revoked. Ask the maintainer for a new one.' }, headers: { ...base, 'X-Atlas-Key-State': 'revoked' } };
  }
  return { status: 401, body: { error: 'key_required', message: 'This surface needs an access key. Unlock it at /ask or request one at /datasets/request.' }, headers: { ...base, 'X-Atlas-Key-State': 'none' } };
}
