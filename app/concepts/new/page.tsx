import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getConceptGraph, getConceptGapScan, getTargets } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createConceptAction } from '@/lib/actions';
import type { ConceptStatus } from '@/lib/types';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ConceptForm from '@/components/ConceptForm';

export const dynamic = 'force-dynamic';
// Hosts the AI recommend actions (prerequisites + claim wiring).
export const maxDuration = 60;
export const metadata = { title: 'New concept · The AI Atlas' };

export default async function NewConceptPage({
  searchParams,
}: {
  searchParams: Promise<{ gap?: string }>;
}) {
  const admin = await requireAdminPage();
  const { editing, txt } = await getEditContext();

  const { gap } = await searchParams;
  const [{ concepts }, { claims, bridges }] = await Promise.all([getConceptGraph(), getTargets()]);

  // ?gap=<slug> pre-fills the form from the persisted gap scan (the recommendation
  // lives server-side, so the link stays tiny and nothing is trusted from the URL
  // beyond the slug). Still recommend-only: the admin reviews, then submits.
  let initial:
    | {
        name: string; slug: string; short_definition: string; explanation: string;
        status: ConceptStatus; prerequisite_ids: string[]; claim_codes: string[];
      }
    | undefined;
  let fromGap = false;
  if (gap) {
    const scan = await getConceptGapScan();
    const rec = scan?.recommendations.find((r) => r.slug === gap);
    if (rec) {
      const idBySlug = new Map(concepts.map((c) => [c.slug, c.id]));
      initial = {
        name: rec.name,
        slug: rec.slug,
        short_definition: rec.short_definition,
        explanation: rec.explanation,
        status: rec.status,
        prerequisite_ids: rec.prerequisite_slugs
          .map((s) => idBySlug.get(s))
          .filter((id): id is string => !!id),
        claim_codes: rec.claim_codes,
      };
      fromGap = true;
    }
  }

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/concepts">Concepts</Link> / New concept
        </div>
        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <Editable
            as="h1"
            k="concepts-new.title"
            value={txt('concepts-new.title', 'New concept')}
            editing={editing}
            style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}
          />
          {/* lede branches on fromGap (a runtime condition, not a fixed string). Left static. */}
          <p className="lede" style={{ fontSize: 14, marginTop: 8 }}>
            {fromGap
              ? 'Pre-filled from the gap diagnosis: the definition, explanation, and wiring below are the model’s draft. Review and edit everything before creating.'
              : 'Define the term, then wire it in: which concepts a reader must understand first, and which claims on the map lean on it. The AI suggests both; you confirm each one.'}
          </p>
        </header>

        <ConceptForm
          mode="create"
          action={createConceptAction}
          concepts={concepts.map((c) => ({
            id: c.id, slug: c.slug, name: c.name, short_definition: c.short_definition,
          }))}
          claims={claims}
          bridges={bridges}
          initial={initial}
        />
      </section>
    </>
  );
}
