import { after } from 'next/server';
import { identityFromRequest } from '@/lib/portal/identity';
import { fieldReportActor, NO_STORE, UUID_RE, ownsRun } from '@/lib/field-report/access';
import { claimRun, getRun, getFieldReportPrefs, fieldReportSpendToday } from '@/lib/field-report/store';
import { runFieldReport } from '@/lib/field-report/run';
import { validatePlan, fieldReportSteps, capRoom, type FieldReportRunResponse, type FieldReportSize } from '@/lib/field-report/core';
import { stepsFromSpecs } from '@/lib/jobs/core';
import { createUiJob } from '@/lib/mutations/jobs';

// POST /api/field-report/run: starts (or resumes) a Field Report. Answers at
// once with the job id; the run itself happens in after(), which Next keeps
// alive for the route's maxDuration (800 s on Vercel Pro), so it survives a
// closed tab. A run that nears the deadline parks its legs and pauses; the
// same call resumes it.
export const dynamic = 'force-dynamic';
export const maxDuration = 800;
const WORK_MS = 760_000;

export async function POST(req: Request): Promise<Response> {
  const who = fieldReportActor(await identityFromRequest(req));
  if (!who) return Response.json({ error: 'Field Reports need a personal access key.' }, { status: 401, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; plan?: unknown; size?: unknown };
  const runId = String(body.runId ?? '');
  if (!UUID_RE.test(runId)) return Response.json({ error: 'Unknown run.' }, { status: 404, headers: NO_STORE });
  const run = await getRun(runId);
  if (!run || !ownsRun(run, who)) return Response.json({ error: 'Unknown run.' }, { status: 404, headers: NO_STORE });
  if (run.status === 'running') return Response.json({ error: 'This report is already running.' }, { status: 409, headers: NO_STORE });
  if (run.status === 'done') return Response.json({ error: 'This report is finished.' }, { status: 409, headers: NO_STORE });

  const prefs = await getFieldReportPrefs();
  if (!prefs.enabled) return Response.json({ error: 'Field Reports are switched off for now.' }, { status: 503, headers: NO_STORE });
  if (who.keyId) {
    const spent = await fieldReportSpendToday(who.keyId);
    const room = Math.min(capRoom(spent.key, prefs.keyDailyUsd), capRoom(spent.allKeys, prefs.allKeysDailyUsd));
    if (room <= 0) return Response.json({ error: 'Today\'s Field Report allowance for this access key is used up.', reason: 'cap' }, { status: 402, headers: NO_STORE });
  }

  // A planned run takes the edited plan and the chosen size; a resume keeps its own.
  const fresh = run.status === 'planned';
  let plan = run.plan;
  let size: FieldReportSize = run.size;
  if (fresh) {
    const edited = validatePlan(body.plan ?? run.plan);
    if (typeof edited === 'string') return Response.json({ error: edited }, { status: 400, headers: NO_STORE });
    plan = edited;
    size = body.size === 'full' ? 'full' : 'brief';
  }
  const legs = run.legs as Record<string, unknown>;
  const keepDone = [
    legs.atlas ? 'atlas' : '', legs.web ? 'web' : '', legs.draft ? 'write' : '',
    legs.review ? 'editor' : '', legs.revised ? 'revise' : '',
  ].filter(Boolean);
  const jobId = await createUiJob({
    kind: 'field_report', subject: runId, label: plan.title,
    steps: stepsFromSpecs(fieldReportSteps(size)), actor: who.actor, keepDone,
  });
  const claimed = await claimRun(runId, { plan: fresh ? plan : undefined, size: fresh ? size : undefined, jobId });
  if (!claimed) return Response.json({ error: 'This report is already running.' }, { status: 409, headers: NO_STORE });
  after(() => runFieldReport(runId, { deadlineMs: WORK_MS }).then(() => undefined));
  const out: FieldReportRunResponse = { runId, jobId };
  return Response.json(out, { status: 202, headers: NO_STORE });
}
