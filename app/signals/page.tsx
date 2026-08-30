import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getSignalsPage } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SignalFeed from '@/components/SignalFeed';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signal Board · The AI Atlas' };

// The PUBLISHED feed — what the world sees. Guests, logged-out visitors, and the admin all
// see the same published signals here; the admin's unpublished drafts live on the separate
// /signals/drafts page (linked below, admin-only). Filtering/search/pagination run
// client-side through getSignalsFeedAction (the draft-visibility gate is in that action).
export default async function SignalsPage() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();

  const published = await getSignalsPage({ admin: personal, status: 'published' });

  return (
    <>
      <Header admin={admin} />
      <section className="wrap">
        <header className="pagehead">
          <Editable
            as="h1"
            k="signals.title"
            value={txt('signals.title', 'Signal Board')}
            editing={editing}
          />
          {/* lede embeds a <Link> to /map; Editable's value is plain text, so
              converting it would drop the in-line link. Left static. */}
          <p className="lede">
            Tracked developments in AI, organized by lens, each linked to the claims it touches on the{' '}
            <Link href="/map">Argument Map</Link>.
          </p>
          {personal && (
            <p style={{ fontSize: 13, marginTop: 6 }}>
              <Link href="/signals/drafts" style={{ color: 'var(--accent)' }}>
                Draft queue →
              </Link>{' '}
              <span style={{ color: 'var(--faint-ink)' }}>your unpublished working queue</span>
            </p>
          )}
        </header>

        <SignalFeed initial={published} status="published" admin={personal} />
      </section>
    </>
  );
}
