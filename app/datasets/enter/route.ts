import { NextResponse, after } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkPortalKey, setPortalSession } from '@/lib/auth';
import { identityFromKey, legacyKeyLimiter, legacyLimiterKey, touchKey } from '@/lib/portal/identity';
import { parseKey } from '@/lib/portal/keys';
import { logPortalUsage } from '@/lib/mutations/portal';

export const dynamic = 'force-dynamic';

// One-link onboarding: /datasets/enter?k=<key>. Two kinds of key verify: the
// legacy shared PORTAL_KEY (cookie value 'portal') and a per-person access
// key (migration 0060; cookie carries the key id + expiry). An active key
// sets the signed portal cookie and lands on the unified Ask workspace; an
// expired or revoked one lands on the datasets hub with a ?key= flag so the
// page can say why; a wrong or missing key fails quietly onto Ask's unlock
// panel (never a /login redirect, which corporate networks flag). Mirrors
// app/share/route.ts. The key rides in the query string exactly as the share
// token does; same accepted tradeoff, per-person keys are revocable.
//
// This GET is already a yes/no oracle by shape (success redirects to /ask,
// failure does too, but only success sets the cookie), so the legacy compare
// is throttled the same way as the other two sessionless legacy-key entry
// points (legacyKeyLimiter): a limited client's compare is skipped, with no
// separate response for "limited" (that would add a second, more precise
// oracle on top of the one that already exists). Only a non-atlas_-shaped
// guess counts as a legacy attempt; a per-person key always tries
// identityFromKey below regardless of the legacy limiter's state.
export async function GET(req: NextRequest) {
  const k = req.nextUrl.searchParams.get('k')?.trim() ?? '';
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;

  if (k && !parseKey(k)) {
    const clientKey = legacyLimiterKey((name) => req.headers.get(name), 'form');
    const allowed = legacyKeyLimiter.allow(clientKey);
    if (allowed && checkPortalKey(k)) {
      legacyKeyLimiter.reset(clientKey);
      await setPortalSession();
      after(() => logPortalUsage({ keyId: null, identity: 'legacy', kind: 'enter', ua }));
      return NextResponse.redirect(new URL('/ask', req.url));
    }
    if (allowed) legacyKeyLimiter.fail(clientKey);
  }

  if (k.startsWith('atlas_')) {
    const identity = await identityFromKey(k);
    if (identity.tier === 'key' && identity.keyId) {
      if (identity.active && identity.expiresAt) {
        await setPortalSession({ keyId: identity.keyId, expiresAt: new Date(identity.expiresAt) });
        const keyId = identity.keyId;
        after(() => Promise.all([
          logPortalUsage({ keyId, identity: 'key', kind: 'enter', ua }),
          touchKey(keyId),
        ]));
        return NextResponse.redirect(new URL('/ask', req.url));
      }
      if (identity.state === 'expired') return NextResponse.redirect(new URL('/datasets?key=expired', req.url));
      if (identity.state === 'revoked') return NextResponse.redirect(new URL('/datasets?key=revoked', req.url));
    }
  }

  return NextResponse.redirect(new URL('/ask', req.url));
}
