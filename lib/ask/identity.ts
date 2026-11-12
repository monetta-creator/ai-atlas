// Who is calling a chat route: admin (the signed cookie) or an access-key
// holder (lib/portal/identity.ts, cookie or Bearer key). Guests get null.
// Shared by /api/ask/v2 and /api/conversations/*.
import { isAdmin } from '../auth';
import { identityFromRequest } from '../portal/identity';
import type { Identity } from '../tools/types';

export async function chatIdentity(req: Request): Promise<{ identity: Identity; keyId: string | null } | null> {
  if (await isAdmin()) return { identity: { kind: 'admin' }, keyId: null };
  const pid = await identityFromRequest(req);
  if (!pid.active || pid.tier === 'none') return null;
  const keyId = pid.tier === 'key' ? pid.keyId : null;
  return { identity: { kind: 'keyholder', keyId: keyId ?? 'legacy' }, keyId };
}
