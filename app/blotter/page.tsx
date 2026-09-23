import { isAdmin, isPreview } from '@/lib/auth';
import { getLatestEdition, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import EditionView from '@/components/edition/EditionView';
import RunEditionButton from '@/components/edition/RunEditionButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Daily edition · The AI Atlas' };

// The News Blotter is now the daily edition (2026-09-23): the public read
// view of the latest SavedEdition, built by the cron-driven two-model-leg
// engine in lib/edition/*. The map-health dashboard that used to live here
// moved to /blotter/desk, admin-only. Guests see the latest PUBLISHED
// edition; admins (out of preview) also see an unpublished one, so a run can
// be checked before it goes live.
export default async function Blotter() {
  const admin = (await isAdmin()) && !(await isPreview());
  const { editing, txt } = await getEditContext();

  const edition = await getLatestEdition(!admin);
  const counts = admin ? await getNavCounts().catch(() => null) : null;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <PageTop
          pathname="/blotter"
          label="News Blotter"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="blotter.title"
              value={txt('blotter.title', 'News Blotter')}
              editing={editing}
            />
          }
          action={admin ? <RunEditionButton /> : undefined}
        >
          {edition ? `Edition No. ${edition.pack.issueNumber} · ${dateLabel(edition.day)}` : 'No edition yet'}
        </PageTop>

        {edition ? (
          <EditionView edition={edition} admin={admin} />
        ) : (
          <div className="ed-empty">
            <p>
              The first edition writes itself at 16:45 UTC on the next weekday.
              {admin && ' You can run it now.'}
            </p>
            {admin && (
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
                <RunEditionButton />
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
