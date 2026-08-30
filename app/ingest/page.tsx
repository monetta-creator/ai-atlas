import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SourceForm from '@/components/SourceForm';
import WorkspaceTabs, { SOURCES_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';
// The PDF auto-fill calls extractSourceMetadataAction (a Server Action on this
// page) — give it headroom, same as the source page.
export const maxDuration = 60;

export default async function IngestPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/sources">Sources</Link> / Add
        </div>

        <header className="pagehead" style={{ padding: '24px 0 28px' }}>
          <Editable as="h1" k="ingest.title" value={txt('ingest.title', 'Add a source')} editing={editing} />
          <Editable
            as="p"
            className="lede"
            k="ingest.lede"
            value={txt(
              'ingest.lede',
              'Drop a PDF or an article and it becomes a source with an AI dossier. From its source page you can attach evidence to specific claims, or turn it into a Signal Board draft through the same triage the discovery pipeline runs. Evidence never moves a confidence on its own; each move is a separate action with a rationale.'
            )}
            editing={editing}
          />
        </header>
        <WorkspaceTabs tabs={SOURCES_TABS} active="/ingest" />

        <SourceForm />

        <p className="mt-6 text-sm">
          <Link href="/sources" style={{ color: 'var(--accent)' }}>← All sources</Link>
        </p>
      </section>
    </>
  );
}
