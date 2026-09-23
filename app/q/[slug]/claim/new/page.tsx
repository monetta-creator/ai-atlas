import { notFound } from 'next/navigation';
import { adminGate } from '@/lib/admin-gate';
import { getQuestion, getTargets, getArgumentGapScan, getThesis, nextClaimCode, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createClaimAction } from '@/lib/actions';
import type { Domain, Resolvability, Relation } from '@/lib/types';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import ClaimForm, { type ClaimEdgeInitial } from '@/components/ClaimForm';

export const dynamic = 'force-dynamic';
// Hosts the AI recommend-edges action.
export const maxDuration = 60;
export const metadata = { title: 'New claim · The AI Atlas' };

export default async function NewClaimPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ gap?: string; thesis?: string }>;
}) {
  const { slug } = await params;
  const gate = await adminGate(`/q/${slug}/claim/new`, 'New claim');
  if (gate) return gate;
  // Started before the page's own reads so the tab badges load beside them.
  const countsP = getNavCounts().catch(() => null);
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const { gap, thesis: thesisParam } = await searchParams;
  const question = await getQuestion(slug, true);
  if (!question) notFound();

  const { claims: allClaims, bridges } = await getTargets();
  const stanceCodes = new Set(question.stances.map((s) => s.code));
  const bridgeCodes = new Set(bridges.map((b) => b.code));
  const suggestedCode = nextClaimCode(question.question.sort_order, allClaims.map((c) => c.code));

  // ?gap=<code> pre-fills from the persisted gap scan (only the code travels in the
  // URL; the body is re-read here). With &thesis=<uuid> the scan is that thesis's
  // (migration 0036) and the created claim also maps onto the thesis on submit.
  // Edge target_type is derived from the live code namespace, never trusted from
  // the wire. Still recommend-only: review, then submit.
  const UUID_RE = /^[0-9a-f-]{36}$/i;
  const thesisId = thesisParam && UUID_RE.test(thesisParam) ? thesisParam : undefined;
  let initial:
    | {
        code: string; statement: string; test: string; domain?: Domain;
        resolvability?: Resolvability | null; edges: ClaimEdgeInitial[];
      }
    | undefined;
  let fromGap = false;
  if (gap) {
    const scan = thesisId
      ? (await getThesis(thesisId))?.gap_scan ?? null
      : await getArgumentGapScan();
    const rec = scan?.recommendations.find((r) => r.kind === 'claim' && r.code === gap);
    if (rec) {
      const edges: ClaimEdgeInitial[] = rec.edges.flatMap((e): ClaimEdgeInitial[] => {
        if (stanceCodes.has(e.code)) return [{ target_type: 'stance', code: e.code, relation: e.relation as Relation }];
        if (bridgeCodes.has(e.code)) return [{ target_type: 'bridge_claim', code: e.code, relation: e.relation as Relation }];
        return [];
      });
      initial = {
        code: rec.code,
        statement: rec.statement,
        test: rec.test,
        domain: rec.domain ?? undefined,
        resolvability: rec.resolvability,
        edges,
      };
      fromGap = true;
    }
  }

  const counts = await countsP;

  return (
    <>
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop
          pathname={`/q/${slug}/claim/new`}
          label="New claim"
          viewer={{ admin, portal: admin }}
          counts={counts}
          infoKey="/q/[slug]/claim/new"
          title={
            <Editable
              as="h1"
              k="claim-new.title"
              value={txt('claim-new.title', 'New claim')}
              editing={editing}
            />
          }
        >
          {fromGap ? 'Pre-filled from the gap diagnosis' : `Adding to ${question.question.title}`}
        </PageTop>

        <ClaimForm
          action={createClaimAction}
          questionSlug={slug}
          questionLabel={`Q${question.question.sort_order}`}
          stances={question.stances}
          claims={question.claims}
          edges={question.edges}
          bridges={bridges}
          suggestedCode={suggestedCode}
          initial={initial}
          thesisId={fromGap ? thesisId : undefined}
        />
      </section>
    </>
  );
}
