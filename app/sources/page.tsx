import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getSourcesWithCounts, getEvidenceGraph } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import SourcesHub from '@/components/SourcesHub';
import WorkspaceTabs, { SOURCES_TABS } from '@/components/WorkspaceTabs';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const [sources, graph] = await Promise.all([getSourcesWithCounts(), getEvidenceGraph()]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Sources
        </div>
        <header className="pagehead" style={{ padding: '24px 0 22px' }}>
          <Editable as="h1" k="sources.title" value={txt('sources.title', 'Sources')} editing={editing} />
          <Editable
            as="p"
            className="lede"
            k="sources.lede"
            value={txt(
              'sources.lede',
              "The source library: filter sources, view dossiers, and see which claims each source's evidence attaches to."
            )}
            editing={editing}
          />
        </header>
        <WorkspaceTabs tabs={SOURCES_TABS} active="/sources" />
        <SourcesHub sources={sources} graph={graph} />
      </section>
    </>
  );
}
