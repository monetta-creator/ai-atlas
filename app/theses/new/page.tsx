import { adminGate } from '@/lib/admin-gate';
import { getTargets, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import ThesisForm from '@/components/ThesisForm';

export const dynamic = 'force-dynamic';
// Hosts the AI mapping server action (mapThesisAction).
export const maxDuration = 60;
export const metadata = { title: 'New thesis · The AI Atlas' };

export default async function NewThesisPage() {
  const gate = await adminGate('/theses/new', 'New thesis');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();
  const targets = await getTargets();
  const counts = await getNavCounts().catch(() => null);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
        <PageTop
          pathname="/theses/new"
          label="New thesis"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="theses-new.title"
              value={txt('theses-new.title', 'New thesis')}
              editing={editing}
            />
          }
        />
        <ThesisForm targets={targets} />
      </section>
    </>
  );
}
