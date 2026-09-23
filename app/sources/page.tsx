import { adminGate } from '@/lib/admin-gate';
import { getSourcesWithCounts, getEvidenceGraph, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import SourcesHub from '@/components/SourcesHub';

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const gate = await adminGate('/sources', 'Sources');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const [sources, graph] = await Promise.all([getSourcesWithCounts(), getEvidenceGraph()]);
  const counts = await getNavCounts().catch(() => null);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <PageTop
          pathname="/sources"
          label="Sources"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={<Editable as="h1" k="sources.title" value={txt('sources.title', 'Sources')} editing={editing} />}
        />
        <SourcesHub sources={sources} graph={graph} />
      </section>
    </>
  );
}
