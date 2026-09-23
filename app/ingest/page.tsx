import Link from 'next/link';
import { adminGate } from '@/lib/admin-gate';
import { getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import SourceForm from '@/components/SourceForm';

export const dynamic = 'force-dynamic';
// The PDF auto-fill calls extractSourceMetadataAction (a Server Action on this
// page) — give it headroom, same as the source page.
export const maxDuration = 60;

export default async function IngestPage() {
  const gate = await adminGate('/ingest', 'Add a source');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();
  const counts = await getNavCounts().catch(() => null);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <PageTop
          pathname="/ingest"
          label="Add a source"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={<Editable as="h1" k="ingest.title" value={txt('ingest.title', 'Add a source')} editing={editing} />}
        />

        <SourceForm />

        <p className="mt-6 text-sm">
          <Link href="/sources" style={{ color: 'var(--accent)' }}>← All sources</Link>
        </p>
      </section>
    </>
  );
}
