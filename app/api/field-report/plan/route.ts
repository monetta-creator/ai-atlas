import { identityFromRequest } from '@/lib/portal/identity';
import { fieldReportActor, NO_STORE, UUID_RE, ownsRun } from '@/lib/field-report/access';
import { draftPlan } from '@/lib/field-report/plan';
import { createRun, getRun, getFieldReportPrefs, fieldReportSpendToday, getModelRates } from '@/lib/field-report/store';
import { estimateUsd, capRoom, MINUTES, type FieldReportPlanResponse } from '@/lib/field-report/core';

// POST /api/field-report/plan: the research plan (Field Report's first step).
// Admin, or a keyholder with a per-person access key under today's caps.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  const who = fieldReportActor(await identityFromRequest(req));
  if (!who) return Response.json({ error: 'Field Reports need a personal access key.' }, { status: 401, headers: NO_STORE });
  const prefs = await getFieldReportPrefs();
  if (!prefs.enabled) return Response.json({ error: 'Field Reports are switched off for now.' }, { status: 503, headers: NO_STORE });
  const body = (await req.json().catch(() => ({}))) as { question?: unknown; context?: unknown; note?: unknown; previousRunId?: unknown };
  const question = String(body.question ?? '').trim().slice(0, 2000);
  if (question.length < 8) return Response.json({ error: 'Ask a fuller question for a Field Report.' }, { status: 400, headers: NO_STORE });
  const context = typeof body.context === 'string' ? body.context.slice(0, 3000) : null;
  const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null;

  let roomUsd: number | null = null;
  if (who.keyId) {
    const spent = await fieldReportSpendToday(who.keyId);
    roomUsd = Math.min(capRoom(spent.key, prefs.keyDailyUsd), capRoom(spent.allKeys, prefs.allKeysDailyUsd));
    if (roomUsd <= 0) return Response.json({ error: 'Today\'s Field Report allowance for this access key is used up.', reason: 'cap' }, { status: 402, headers: NO_STORE });
  }

  let previous = null;
  if (typeof body.previousRunId === 'string' && UUID_RE.test(body.previousRunId)) {
    const prev = await getRun(body.previousRunId);
    if (prev && ownsRun(prev, who)) previous = prev.plan;
  }
  const runId = crypto.randomUUID();
  try {
    const plan = await draftPlan({
      question, context, note, previous, mode: who.mode, model: prefs.models.brief.research,
      metadata: { field_report_run: runId, ...(who.keyId ? { portal_key_id: who.keyId } : {}) },
    });
    await createRun({ id: runId, createdBy: who.actor, question, plan });
    const models = [...new Set([...Object.values(prefs.models.brief), ...Object.values(prefs.models.full)])];
    const rates = await getModelRates(models);
    const out: FieldReportPlanResponse = {
      runId, plan,
      estimates: {
        brief: { usd: estimateUsd('brief', prefs.models.brief, rates), minutes: MINUTES.brief },
        full: { usd: estimateUsd('full', prefs.models.full, rates), minutes: MINUTES.full },
      },
      capRoomUsd: roomUsd,
    };
    return Response.json(out, { headers: NO_STORE });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'The plan could not be drafted.' }, { status: 502, headers: NO_STORE });
  }
}
