import { requireAdminPage } from '@/lib/auth';
import { getTargets } from '@/lib/data';
import Header from '@/components/Header';
import ThesisForm from '@/components/ThesisForm';

export const dynamic = 'force-dynamic';
// Hosts the AI mapping server action (mapThesisAction).
export const maxDuration = 60;
export const metadata = { title: 'New thesis · The AI Atlas' };

export default async function NewThesisPage() {
  const admin = await requireAdminPage();
  const targets = await getTargets();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
        <header className="pagehead">
          <h1>New thesis</h1>
          <p className="lede">
            State the hypothesis in plain language, let the mapper propose the Atlas claims it
            bears on, and confirm the mapping. You commit; the model only recommends.
          </p>
        </header>
        <ThesisForm targets={targets} />
      </section>
    </>
  );
}
