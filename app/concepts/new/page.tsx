import { adminGate } from '@/lib/admin-gate';
import { getConceptGraph, getConceptGapScan, getTargets, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createConceptAction } from '@/lib/actions';
import type { ConceptStatus } from '@/lib/types';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
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
  const gate = await adminGate('/concepts/new', 'New concept');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
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

  const counts = await countsP;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <PageTop
          pathname="/concepts/new"
          label="New concept"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="concepts-new.title"
              value={txt('concepts-new.title', 'New concept')}
              editing={editing}
            />
          }
        >
          {fromGap ? 'Pre-filled from the gap diagnosis' : 'Define the term, then wire it in'}
        </PageTop>

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
