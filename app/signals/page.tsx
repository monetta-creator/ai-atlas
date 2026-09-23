import { isAdmin, isPreview } from '@/lib/auth';
import { getSignalsPage } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
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
      <section className="wrap">
        <PageTop
          pathname="/signals"
          label="Signal Board"
          viewer={{ admin: personal, portal: personal }}
          title={
            <Editable
              as="h1"
              k="signals.title"
              value={txt('signals.title', 'Signal Board')}
              editing={editing}
            />
          }
        />

        <SignalFeed initial={published} status="published" admin={personal} />
      </section>
    </>
  );
}
