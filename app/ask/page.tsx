import { getPortalIdentity } from '@/lib/portal/identity';
import { getAskClientData } from '@/lib/ask/retrieve';
import { DATASETS } from '@/lib/datasets/registry';
import AskWorkspace from '@/components/ask/AskWorkspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask the Atlas' };

// The unified Ask workspace: one page for everyone, depth by auth. Admins get
// the personal-layer mode against /api/ask; portal-key holders get guest-safe
// mode against /api/portal/ask; locked visitors get the full shell with the
// inline unlock panel where the composer sits (never a /login redirect, which
// corporate networks flag). Model calls live in the API routes, which own
// their maxDuration; conversations live in the visitor's browser only.
// ?q= seeds a first turn (the lobby's chat launcher); the workspace fires it
// once on mount and strips the param from the URL.
export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [identity, sp] = await Promise.all([getPortalIdentity(), searchParams]);
  const mode = identity.tier === 'admin' ? 'admin' : identity.active ? 'portal' : 'locked';
  // A lapsed key (expired or revoked) lands in locked mode; the unlock panel
  // renders the renewal notice from these two fields.
  const keyState = identity.state === 'expired' || identity.state === 'revoked'
    ? { state: identity.state, expiresAt: identity.expiresAt }
    : null;
  const validIds = await getAskClientData();
  const datasets = DATASETS.map((d) => ({ slug: d.slug, title: d.title, description: d.description }));
  const rawQ = typeof sp.q === 'string' ? sp.q : undefined;
  const initialQuestion = rawQ?.trim().slice(0, 2000) || undefined;

  return (
    <div className="ask-page">
      <AskWorkspace mode={mode} validIds={validIds} datasets={datasets} initialQuestion={initialQuestion} keyState={keyState} />
    </div>
  );
}
