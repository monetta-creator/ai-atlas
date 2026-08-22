import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getConceptGraph, getConceptGapScan, reconcileConceptGapScan } from '@/lib/data';
import Header from '@/components/Header';
import ConceptGraph from '@/components/ConceptGraph';
import ConceptGapPanel from '@/components/ConceptGapPanel';

export const dynamic = 'force-dynamic';
// Hosts the AI gap-diagnosis action.
export const metadata = { title: 'Concepts · The AI Atlas' };

export default async function ConceptsPage() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
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
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1100, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Concepts
        </div>

        <header className="pagehead" style={{ padding: '24px 0 28px' }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1>Concepts · the semantic scaffold</h1>
              <p className="lede">
                The vocabulary the AI-economy debate is conducted in, stacked by dependency:
                foundational ideas at the bottom, the concepts built on them above. Most terms
                have settled technical meanings; the contested ones are where arguments
                quietly talk past each other.
              </p>
            </div>
            {personal && (
              <Link href="/concepts/new" className="btn btn--primary" style={{ marginTop: 6 }}>
                Create concept
              </Link>
            )}
          </div>
        </header>

        {personal && <ConceptGapPanel initial={gapScan} />}

        <ConceptGraph nodes={nodes} edges={edges} />
      </section>
    </>
  );
}
