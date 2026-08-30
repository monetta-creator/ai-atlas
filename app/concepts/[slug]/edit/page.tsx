import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/auth';
import { getConceptForEdit, getConceptGraph, getTargets } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { updateConceptAction, deleteConceptAction } from '@/lib/actions';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ConceptForm from '@/components/ConceptForm';

export const dynamic = 'force-dynamic';
// Hosts the AI recommend actions (prerequisites + claim wiring).
export const maxDuration = 60;
export const metadata = { title: 'Edit concept · The AI Atlas' };

export default async function EditConceptPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const { slug } = await params;
  const [data, { concepts }, { claims, bridges }] = await Promise.all([
    getConceptForEdit(decodeURIComponent(slug)),
    getConceptGraph(),
    getTargets(),
  ]);
  if (!data) notFound();
  const { concept, prerequisite_ids, claim_codes } = data;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/concepts">Concepts</Link> /{' '}
          <Link href={`/concepts/${concept.slug}`}>{concept.name}</Link> / Edit
        </div>
        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <Editable
            as="h1"
            k="concepts-edit.title"
            value={txt('concepts-edit.title', 'Edit concept')}
            editing={editing}
            style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}
          />
        </header>

        <ConceptForm
          mode="edit"
          action={updateConceptAction}
          conceptId={concept.id}
          concepts={concepts
            .filter((c) => c.id !== concept.id)
            .map((c) => ({ id: c.id, slug: c.slug, name: c.name, short_definition: c.short_definition }))}
          claims={claims}
          bridges={bridges}
          initial={{
            name: concept.name,
            slug: concept.slug,
            short_definition: concept.short_definition,
            explanation: concept.explanation ?? '',
            status: concept.status,
            prerequisite_ids,
            claim_codes,
          }}
        />

        <form action={deleteConceptAction} style={{ marginTop: 28 }}>
          <input type="hidden" name="id" value={concept.id} />
          <button type="submit" className="btn btn--danger btn--sm">
            Delete concept
          </button>
          <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 8 }}>
            Removes the concept, its dependency edges, and its claim links. Concepts that listed it
            as a prerequisite stay; they just lose this edge.
          </p>
        </form>
      </section>
    </>
  );
}
