import { cache } from 'react';
import { headers } from 'next/headers';
import crypto from 'node:crypto';
import { one, exec } from '../db';
import { checkPortalKey, isAdmin, readPortalCookie } from '../auth';
import { hashKey, hashesEqual, keyState, parseKey, type KeyState } from './keys';

// Who is calling a portal surface (migration 0060). isPortal() in lib/auth.ts
// answers the yes/no question (and, like this module, resolves the per-person
// key row so revocation and expiry are enforced); this is the richer identity
// the gated routes, the billable routes and the portal pages use when they
// need the key id (per-key budget, usage rows) or the lapsed-key message. It
// also accepts a key sent as a header (Authorization: Bearer atlas_... or
// X-Atlas-Key) so intake scripts on the far side of a firewall need no cookie.
// Cached per request with React cache().

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

const NONE: PortalIdentity = { tier: 'none', keyId: null, name: null, state: 'none', expiresAt: null, active: false };
const ADMIN: PortalIdentity = { tier: 'admin', keyId: null, name: null, state: 'active', expiresAt: null, active: true };
const LEGACY: PortalIdentity = { tier: 'legacy', keyId: null, name: null, state: 'active', expiresAt: null, active: true };

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

async function fromCookies(): Promise<PortalIdentity> {
  if (await isAdmin()) return ADMIN;
  const c = await readPortalCookie();
  if (!c) return NONE;
  if (c.legacy) return LEGACY;
  return byId(c.keyId);
}

// Either header carries a per-person key (atlas_...) or the legacy shared
// PORTAL_KEY, so an intake script written against the team key keeps working
// once it moves from the enter link to a header.
function headerKey(h: Headers): string | null {
  const auth = h.get('authorization');
  if (auth && /^bearer\s+\S/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  const x = h.get('x-atlas-key');
  return x && x.trim() ? x.trim() : null;
}

// A header key wins when it is active. When it is invalid, expired or revoked
// the admin cookie still passes (admin passes everywhere, so a stale key in a
// script or extension header never locks the admin out); otherwise the lapsed
// key's identity is returned so the 401 can say why, ahead of an anonymous
// cookie's plain "key required".
async function resolve(key: string | null): Promise<PortalIdentity> {
  if (!key) return fromCookies();
  const id = parseKey(key) ? await identityFromKey(key) : checkPortalKey(key) ? LEGACY : NONE;
  if (id.active) return id;
  if (await isAdmin()) return ADMIN;
  return id;
}

// Cookie identity for pages and server actions (the request headers are
// consulted too, so a script's header key works on API routes that call this).
export const getPortalIdentity = cache(async (): Promise<PortalIdentity> => {
  const h = await headers();
  return resolve(headerKey(h));
});

// Route-handler variant taking the Request (avoids next/headers in tests).
export async function identityFromRequest(req: Request): Promise<PortalIdentity> {
  return resolve(headerKey(req.headers));
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
