import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth';
import { getSignal, getTargets, getSources } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { updateSignalAction } from '@/lib/actions';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SignalForm from '@/components/SignalForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit signal · The AI Atlas' };

export default async function EditSignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  // `admin` is guaranteed true here (the redirect above gates non-admins); derive the
  // personal flag from it rather than hardcoding, so the edit view never out-lives its gate.
  const data = await getSignal(id, admin);
  if (!data) notFound();
  const { signal } = data;

  const { claims, bridges } = await getTargets();
  const sources = (await getSources()).map((s) => ({ id: s.id, title: s.title }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/signals">Signal Board</Link> /{' '}
          <Link href={`/signals/${signal.id}`}>{signal.title}</Link> / Edit
        </div>
        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <Editable
            as="h1"
            k="signals-edit.title"
            value={txt('signals-edit.title', 'Edit signal')}
            editing={editing}
            style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}
          />
        </header>

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
