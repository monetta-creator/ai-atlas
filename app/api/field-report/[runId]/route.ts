import { identityFromRequest } from '@/lib/portal/identity';
import { fieldReportActor, NO_STORE, UUID_RE, ownsRun } from '@/lib/field-report/access';
import { getRun } from '@/lib/field-report/store';
import { one } from '@/lib/db';
import type { FieldReportNarrative, FieldReportPack, FieldReportRunStatus } from '@/lib/field-report/core';

// GET /api/field-report/<runId>: the run's state and, once done, the report
// card the Ask thread shows. Owner or admin only.
export const dynamic = 'force-dynamic';

// The card is a teaser: footnote numbers stay in the report, not here.
const text = (html: string) => html.replace(/\s*<a [^>]*>\d+<\/a>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();

export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }): Promise<Response> {
  const who = fieldReportActor(await identityFromRequest(req));
  if (!who) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  const { runId } = await ctx.params;
  if (!UUID_RE.test(runId)) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const run = await getRun(runId);
  if (!run || !ownsRun(run, who)) return Response.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  let report: FieldReportRunStatus['report'] = null;
  if (run.report_id) {
    const r = await one<{ id: string; title: string; is_published: boolean; pack: FieldReportPack; narrative: FieldReportNarrative }>(
      `select id::text, title, is_published, pack, narrative from generated_reports where id = $1 and kind = 'field_report'`, [run.report_id]);
    if (r) {
      const summary = r.narrative.summary.flatMap((b) => {
        const items = [...b.html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
        return items.length ? items : [text(b.html)];
      }).filter(Boolean).slice(0, 6);
      report = {
        id: r.id, title: r.title, summary, provenance: r.pack.provenance,
        href: `/field-reports/${r.id}`, pdfHref: `/field-reports/${r.id}/pdf`,
        isPublished: r.is_published, size: r.pack.size, costUsd: r.pack.costUsd,
      };
    }
  }
  const out: FieldReportRunStatus = {
    run: { id: run.id, status: run.status, size: run.size, title: run.plan.title, jobId: run.job_id, error: run.error },
    report,
  };
  return Response.json(out, { headers: NO_STORE });
}
