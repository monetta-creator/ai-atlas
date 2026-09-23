import { adminGate } from '@/lib/admin-gate';
import { getTargets, getSources, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createSignalAction } from '@/lib/actions';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import SignalForm from '@/components/SignalForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New signal · The AI Atlas' };

export default async function NewSignalPage() {
  const gate = await adminGate('/signals/new', 'New signal');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const { claims, bridges } = await getTargets();
  const sources = (await getSources()).map((s) => ({ id: s.id, title: s.title }));
  const counts = await getNavCounts().catch(() => null);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <PageTop
          pathname="/signals/new"
          label="New signal"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="signals-new.title"
              value={txt('signals-new.title', 'New signal')}
              editing={editing}
            />
          }
        />

        <SignalForm
          mode="create"
          action={createSignalAction}
          claims={claims}
          bridges={bridges}
          sources={sources}
        />
      </section>
    </>
  );
}
