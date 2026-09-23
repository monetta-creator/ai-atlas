import { notFound } from 'next/navigation';
import { adminGate } from '@/lib/admin-gate';
import { getSignal, getTargets, getSources, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { updateSignalAction } from '@/lib/actions';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import SignalForm from '@/components/SignalForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit signal · The AI Atlas' };

export default async function EditSignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await adminGate(`/signals/${id}/edit`, 'Edit signal');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  // `admin` is guaranteed true here (the redirect above gates non-admins); derive the
  // personal flag from it rather than hardcoding, so the edit view never out-lives its gate.
  const data = await getSignal(id, admin);
  if (!data) notFound();
  const { signal } = data;

  const { claims, bridges } = await getTargets();
  const sources = (await getSources()).map((s) => ({ id: s.id, title: s.title }));
  const counts = await countsP;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <PageTop
          pathname={`/signals/${signal.id}/edit`}
          label="Edit signal"
          viewer={{ admin, portal: admin }}
          counts={counts}
          infoKey="/signals/[id]/edit"
          title={
            <Editable
              as="h1"
              k="signals-edit.title"
              value={txt('signals-edit.title', 'Edit signal')}
              editing={editing}
            />
          }
        />

        <SignalForm
          mode="edit"
          signalId={signal.id}
          action={updateSignalAction}
          claims={claims}
          bridges={bridges}
          sources={sources}
          initial={{
            title: signal.title,
            summary: signal.summary ?? '',
            significance: signal.significance,
            lenses: signal.lenses,
            claim_touches: signal.claim_touches,
            touch_details: signal.touch_details,
            source_id: signal.source_id,
            published_at: signal.published_at,
          }}
        />
      </section>
    </>
  );
}
