import { requireAdminPage } from '@/lib/auth';
import { getTargets } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ThesisForm from '@/components/ThesisForm';

export const dynamic = 'force-dynamic';
// Hosts the AI mapping server action (mapThesisAction).
export const maxDuration = 60;
export const metadata = { title: 'New thesis · The AI Atlas' };

export default async function NewThesisPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();
  const targets = await getTargets();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
        <header className="pagehead">
          <Editable
            as="h1"
            k="theses-new.title"
            value={txt('theses-new.title', 'New thesis')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            k="theses-new.lede"
            value={txt(
              'theses-new.lede',
              'State the hypothesis in plain language, let the mapper propose the Atlas claims it bears on, and confirm the mapping. You commit; the model only recommends.'
            )}
            editing={editing}
          />
        </header>
        <ThesisForm targets={targets} />
      </section>
    </>
  );
}
