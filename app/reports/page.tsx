import { isAdmin } from '@/lib/auth';
import { getPortalIdentity } from '@/lib/portal/identity';
import { jobViewerFor } from '@/lib/jobs/core';
import { listSavedReports, getLatestThesisReports, listGeneratedReports, getTargets, getFeatureStats, getRecentJobOfKind } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { descriptionFor } from '@/lib/page-info';
import SheetConsole from '@/components/reports/SheetConsole';
import ReportGrid from '@/components/reports/ReportGrid';
import {
  toSheetCard, toPeriodCard, toThesisCard, toDeckCard, sortCards,
  REPORT_KIND_FILTERS, DRAFTS_FILTER,
} from '@/lib/reports/cards';
import { visibleDecks } from '@/lib/reports/decks';

export const dynamic = 'force-dynamic';
// Hosts the sheet-generation server actions (pack + two model legs + save).
export const maxDuration = 60;
export const metadata = { title: 'Report Portal · The AI Atlas', description: descriptionFor('/reports') };

const VALID_KINDS = new Set([...REPORT_KIND_FILTERS.map((f) => f.key), DRAFTS_FILTER.key]);

// The Report Portal: a five-wide grid of every report family (generated
// sheets, period reports, thesis reports), each with a cover-page preview
// mirroring the branded PDF's own cover. Filter/search/pagination run
// client-side over the server-assembled card set (ReportGrid); the
// generator console (admin) collapses into a <details> so the grid leads.
// ?generate=claim&code=4.2 pre-fills and opens the console (claim pages
// link here); ?q=/&kind=/&page= seed the grid's own state.
export default async function ReportPortal({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string; generate?: string; code?: string }>;
}) {
  const [admin, sp] = await Promise.all([isAdmin(), searchParams]);
  const identity = await getPortalIdentity();
  const portal = identity.active;
  // A keyholder's own unpublished Field Reports need their key id (never
  // another keyholder's draft); jobViewerFor is the one shared identity->
  // {admin, keyId} mapping (also used by the ui_jobs registry).
  const keyId = jobViewerFor(identity).keyId;
  const { editing, txt } = await getEditContext();
  const [reports, theses, generated, targets, runStats, lastRun] = await Promise.all([
    listSavedReports(),
    getLatestThesisReports(50),
    listGeneratedReports(!admin, { portal, keyId }),
    admin ? getTargets() : Promise.resolve({ claims: [], bridges: [] }),
    // The generator's run panel: the usual time and cost per step, and a run
    // still going (or just ended) when the admin comes back to this page.
    admin ? getFeatureStats().catch(() => null) : Promise.resolve(null),
    admin ? getRecentJobOfKind('sheet', { admin: true, keyId: null }).catch(() => null) : Promise.resolve(null),
  ]);

  const cards = sortCards([
    ...generated.map(toSheetCard),
    ...reports.map(toPeriodCard),
    ...theses.map(toThesisCard),
    // The 16:9 decks (admin-only ones filtered here, before anything reaches
    // the client): undated, so sortCards places them after the reports.
    ...visibleDecks(admin).map(toDeckCard),
  ]);

  const gen = typeof sp.generate === 'string' ? sp.generate : undefined;
  const initialKind = gen === 'claim' || gen === 'lens' || gen === 'atlas' ? gen : undefined;
  const initialCode = typeof sp.code === 'string' ? sp.code : undefined;

  const kindParam = typeof sp.kind === 'string' ? sp.kind : 'all';
  const kind = VALID_KINDS.has(kindParam) && (kindParam !== DRAFTS_FILTER.key || admin) ? kindParam : 'all';
  const pageParam = typeof sp.page === 'string' ? parseInt(sp.page, 10) : 1;
  const page = Number.isFinite(pageParam) && pageParam >= 1 ? pageParam : 1;
  const q = (typeof sp.q === 'string' ? sp.q : '').slice(0, 120);

  return (
    <>
      <section className="wrap rp-wrap">
        <PageTop
          pathname="/reports"
          label="Report Portal"
          viewer={{ admin, portal: portal || admin }}
          title={
            <Editable
              as="h1"
              k="reports.title"
              value={txt('reports.title', 'Report Portal')}
              editing={editing}
            />
          }
        />

        {admin && (
          <details className="rp-console" open={!!gen || lastRun?.status === 'running'}>
            <summary>Generate a report</summary>
            <SheetConsole
              claims={targets.claims.map((t) => ({ code: t.code, statement: t.statement }))}
              bridges={targets.bridges.map((t) => ({ code: t.code, statement: t.statement }))}
              initialKind={initialKind}
              initialCode={initialCode}
              stats={runStats}
              initialJob={lastRun}
            />
          </details>
        )}

        <ReportGrid cards={cards} admin={admin} initial={{ q, kind, page }} />
      </section>
    </>
  );
}
