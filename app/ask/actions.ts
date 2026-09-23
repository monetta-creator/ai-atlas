'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { checkPortalKey, setPortalSession } from '@/lib/auth';
import { identityFromKey, legacyKeyLimiter, legacyLimiterKey, touchKey } from '@/lib/portal/identity';
import { parseKey } from '@/lib/portal/keys';
import { logPortalUsage } from '@/lib/mutations/portal';
import { safePath } from '@/lib/actions/shared';

// The one server action that deliberately does NOT call requireAdmin(): it IS
// the portal gate. Two kinds of key unlock it: the legacy shared PORTAL_KEY
// (checkPortalKey fails closed, no PORTAL_KEY set means that path is off) and
// a per-person access key (migration 0060, resolved through
// lib/portal/identity.ts so expiry and revocation are enforced). Success
// grants only the signed portal cookie, which carries no write authority and
// no personal-layer access.
//
// The legacy compare is throttled (legacyKeyLimiter, shared with the other
// two sessionless legacy-key entry points): a limited client's compare is
// skipped and it sees the same NO_MATCH as a wrong key, never a distinct
// "try again later" (that would confirm the throttle exists and become a
// second oracle). Per-person keys are never throttled: 160-bit and
// prefix-looked-up, not guessable at any realistic rate.

export interface UnlockState {
  error: string | null;
}

const NO_MATCH = 'That key did not match. Check with the maintainer and try again.';

export async function unlockPortalAction(_prev: UnlockState, formData: FormData): Promise<UnlockState> {
  const key = String(formData.get('key') ?? '').trim();
  if (!key) return { error: NO_MATCH };

  // Only a non-atlas_-shaped guess is a legacy-key attempt (an atlas_-shaped
  // string is always tried against identityFromKey below instead, whatever
  // the legacy limiter's state, so a per-person key is never blocked by
  // someone else's legacy-guessing burst from the same client key).
  const legacyShaped = !parseKey(key);
  const h = await headers();
  const clientKey = legacyLimiterKey((name) => h.get(name), 'form');
  const allowed = legacyShaped && legacyKeyLimiter.allow(clientKey);
  const legacyMatch = allowed && checkPortalKey(key);

  if (legacyMatch) {
    legacyKeyLimiter.reset(clientKey);
    await setPortalSession();
    after(() => logPortalUsage({ keyId: null, identity: 'legacy', kind: 'enter' }));
  } else {
    if (allowed) legacyKeyLimiter.fail(clientKey);
    const identity = await identityFromKey(key);
    if (identity.tier !== 'key' || !identity.keyId) return { error: NO_MATCH };
    if (identity.state === 'expired') {
      const day = identity.expiresAt ? identity.expiresAt.slice(0, 10) : 'recently';
      return { error: `This access key expired on ${day}. Ask the maintainer to renew it; your saved views are kept.` };
    }
    if (identity.state === 'revoked') {
      return { error: 'This access key was revoked. Ask the maintainer for a new one.' };
    }
    if (!identity.active || !identity.expiresAt) return { error: NO_MATCH };
    await setPortalSession({ keyId: identity.keyId, expiresAt: new Date(identity.expiresAt) });
    const keyId = identity.keyId;
    after(() => Promise.all([
      logPortalUsage({ keyId, identity: 'key', kind: 'enter' }),
      touchKey(keyId),
    ]));
  }

  // Optional return path (a hidden field on the unlock form): same-origin
  // paths only, so the portal gate can never become an open redirect.
  const next = String(formData.get('next') ?? '').trim();
  redirect(next ? safePath(next) : '/ask');
}
