import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getConceptGraph, getConceptGapScan, reconcileConceptGapScan } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import ConceptGraph from '@/components/ConceptGraph';
import ConceptGapPanel from '@/components/ConceptGapPanel';

export const dynamic = 'force-dynamic';
// Hosts the AI gap-diagnosis action.
export const maxDuration = 60;
export const metadata = { title: 'Concepts · The AI Atlas' };

export default async function ConceptsPage() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();
  const [{ concepts, edges }, rawGapScan] = await Promise.all([
    getConceptGraph(),
    personal ? getConceptGapScan() : Promise.resolve(null),
  ]);

  // Slim, serializable nodes for the client graph (no timestamps/explanations on the wire).
  const nodes = concepts.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    short_definition: c.short_definition,
    status: c.status,
  }));

  // The persisted gap scan (admin-only), reconciled so a recommendation whose
  // concept has since been created never resurfaces.
  const gapScan = personal
    ? reconcileConceptGapScan(rawGapScan, new Set(concepts.map((c) => c.slug)))
    : null;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 1100, paddingBottom: 100 }}>
        <PageTop
          pathname="/concepts"
          label="Concepts"
          viewer={{ admin: personal, portal: personal }}
          title={
            <Editable
              as="h1"
              k="concepts.title"
              value={txt('concepts.title', 'Concepts · the semantic scaffold')}
              editing={editing}
            />
          }
          action={
            personal && (
              <Link href="/concepts/new" className="btn btn--primary">
                Create concept
              </Link>
            )
          }
        />

        {personal && <ConceptGapPanel initial={gapScan} />}

        <ConceptGraph nodes={nodes} edges={edges} />
      </section>
    </>
  );
}
