// Who is calling the MCP door (redo Phase 2). Two bearer forms:
//   Authorization: Bearer mcpadm_<hmac>   the admin token, derived from
//     AUTH_SECRET like the admin cookie (lib/auth.ts), so it rotates with it
//     and differs between local and production;
//   Authorization: Bearer atlas_<key>     a portal access key, resolved by
//     identityFromRequest (revocation and expiry enforced there).
// Anything else is refused. Print the admin token locally with
//   npx -y tsx scripts/mcp-token.mts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { identityFromRequest } from '../portal/identity';
import type { Identity } from '../tools/types';

const PREFIX = 'mcpadm_';

function secret(): string {
  const s = process.env.AUTH_SECRET ?? '';
  if (s.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
  return s;
}

export function mcpAdminToken(): string {
  return PREFIX + createHmac('sha256', secret()).update('mcp-admin').digest('hex');
}

export function isMcpAdminToken(token: string): boolean {
  if (!token.startsWith(PREFIX)) return false;
  let expected: string;
  try {
    expected = mcpAdminToken();
  } catch {
    return false;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export async function mcpIdentity(req: Request): Promise<Identity | null> {
  const token = bearer(req);
  if (!token) return null;
  if (isMcpAdminToken(token)) return { kind: 'admin' };
  if (token.startsWith(PREFIX)) return null;
  const pid = await identityFromRequest(req);
  if (!pid.active || pid.tier !== 'key' || !pid.keyId) return null;
  return { kind: 'keyholder', keyId: pid.keyId };
}
