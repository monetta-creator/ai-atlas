import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { getTargets, getArgumentGapScan, getThesis, nextBridgeCode } from '@/lib/data';
import { createBridgeAction } from '@/lib/actions';
import type { Domain, Resolvability, Relation } from '@/lib/types';
import Header from '@/components/Header';
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
  const admin = await requireAdminPage();

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

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 860, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / <Link href="/bridges">Bridges</Link> / New bridge-claim
        </div>
        <header className="pagehead" style={{ padding: '20px 0 18px' }}>
          <h1 style={{ fontSize: 'clamp(22px, 3vw, 30px)' }}>New bridge-claim</h1>
          <p className="lede" style={{ fontSize: 14, marginTop: 8 }}>
            {fromGap
              ? 'Pre-filled from the gap diagnosis: the statement, test, domains, and feeders below are the model’s draft, grounded in recent evidence. Review and edit everything before creating.'
              : 'A bridge-claim links two domains. Write the inter-domain statement and its test, then wire the claims that feed it. The AI suggests the feeders; you confirm each.'}
          </p>
        </header>

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
