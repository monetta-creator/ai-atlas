import { adminGate } from '@/lib/admin-gate';
import { getTargets, getArgumentGapScan, getThesis, nextBridgeCode, getNavCounts } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { createBridgeAction } from '@/lib/actions';
import type { Domain, Resolvability, Relation } from '@/lib/types';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import BridgeForm, { type BridgeFeederInitial } from '@/components/BridgeForm';

export const dynamic = 'force-dynamic';
// Hosts the AI recommend-feeders action.
export const maxDuration = 60;
export const metadata = { title: 'New bridge-claim · The AI Atlas' };

export default async function NewBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ gap?: string; thesis?: string }>;
}) {
  const gate = await adminGate('/bridge/new', 'New bridge-claim');
  if (gate) return gate;
  const admin = true as const;
  const { editing, txt } = await getEditContext();

  const { gap, thesis: thesisParam } = await searchParams;
  const { claims, bridges } = await getTargets();
  const claimCodes = new Set(claims.map((c) => c.code));
  const suggestedCode = nextBridgeCode(bridges.map((b) => b.code));

  // ?gap=<code> pre-fill from the persisted scan (only the code travels; body
  // re-read here). With &thesis=<uuid> the scan is that thesis's (migration 0036)
  // and the created bridge also maps onto the thesis on submit.
  const UUID_RE = /^[0-9a-f-]{36}$/i;
  const thesisId = thesisParam && UUID_RE.test(thesisParam) ? thesisParam : undefined;
  let initial:
    | {
        code: string; statement: string; test: string;
        domain_from?: Domain; domain_to?: Domain;
        resolvability?: Resolvability | null; feeders: BridgeFeederInitial[];
      }
    | undefined;
  let fromGap = false;
  if (gap) {
    const scan = thesisId
      ? (await getThesis(thesisId))?.gap_scan ?? null
      : await getArgumentGapScan();
    const rec = scan?.recommendations.find((r) => r.kind === 'bridge' && r.code === gap);
    if (rec) {
      const feeders: BridgeFeederInitial[] = rec.edges
        .filter((e) => claimCodes.has(e.code))
        .map((e) => ({ code: e.code, relation: e.relation as Relation }));
      initial = {
        code: rec.code,
        statement: rec.statement,
        test: rec.test,
        domain_from: rec.domain_from ?? undefined,
        domain_to: rec.domain_to ?? undefined,
        resolvability: rec.resolvability,
        feeders,
      };
      fromGap = true;
    }
  }

  const counts = await getNavCounts().catch(() => null);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <PageTop
          pathname="/bridge/new"
          label="New bridge-claim"
          viewer={{ admin, portal: admin }}
          counts={counts}
          title={
            <Editable
              as="h1"
              k="bridge-new.title"
              value={txt('bridge-new.title', 'New bridge-claim')}
              editing={editing}
            />
          }
        >
          {fromGap ? 'Pre-filled from the gap diagnosis' : 'Links two domains'}
        </PageTop>

        <BridgeForm
          action={createBridgeAction}
          claims={claims}
          suggestedCode={suggestedCode}
          initial={initial}
          thesisId={fromGap ? thesisId : undefined}
        />
      </section>
    </>
  );
}
