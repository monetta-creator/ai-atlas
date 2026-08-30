import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getTargets, getSources } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createSignalAction } from '@/lib/actions';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SignalForm from '@/components/SignalForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New signal · The AI Atlas' };

export default async function NewSignalPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const { claims, bridges } = await getTargets();
  const sources = (await getSources()).map((s) => ({ id: s.id, title: s.title }));

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/signals">Signal Board</Link> / New signal
        </div>
        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <Editable
            as="h1"
            k="signals-new.title"
            value={txt('signals-new.title', 'New signal')}
            editing={editing}
            style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}
          />
          {/* lede embeds a styled <span>; Editable's value is plain text, so converting
              it would drop that in-line styling. Left static. */}
          <p className="lede" style={{ fontSize: 14, marginTop: 8 }}>
            Note a development directly, or use a source and the{' '}
            <span style={{ color: 'var(--dim)' }}>Propose signal</span> button on its page to draft it with AI.
          </p>
        </header>

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
