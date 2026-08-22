import { isAdmin, isPortal } from '@/lib/auth';
import { getAskClientData } from '@/lib/ask/retrieve';
import { DATASETS } from '@/lib/datasets/registry';
import Header from '@/components/Header';
import AskWorkspace from '@/components/ask/AskWorkspace';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask the Atlas' };

// The unified Ask workspace: one page for everyone, depth by auth. Admins get
// the personal-layer mode against /api/ask; portal-key holders get guest-safe
// mode against /api/portal/ask; locked visitors get the full shell with the
// inline unlock panel where the composer sits (never a /login redirect, which
// corporate networks flag). Model calls live in the API routes, which own
// conversations live in the visitor's browser only.
// ?q= seeds a first turn (the lobby's chat launcher); the workspace fires it
// once on mount and strips the param from the URL.
export default async function AskPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [admin, portal, sp] = await Promise.all([isAdmin(), isPortal(), searchParams]);
  const mode = admin ? 'admin' : portal ? 'portal' : 'locked';
  const validIds = await getAskClientData();
  const datasets = DATASETS.map((d) => ({ slug: d.slug, title: d.title, description: d.description }));
  const rawQ = typeof sp.q === 'string' ? sp.q : undefined;
  const initialQuestion = rawQ?.trim().slice(0, 2000) || undefined;

  return (
    <div className="ask-page">
      <Header admin={admin} />
      <AskWorkspace mode={mode} validIds={validIds} datasets={datasets} initialQuestion={initialQuestion} />
    </div>
  );
}
