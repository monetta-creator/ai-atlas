import { exec, one, withTx } from '../db';
import { applyTransition, statusFromSteps, type JobStep, type StepState } from '../jobs/core';

// ---- The model-run registry (migration 0072) -------------------------------
// Writers for ui_jobs. The server actions in lib/actions/jobs.ts are the
// client's door (they gate on admin or the owning keyholder); server code
// that runs long work itself (the Savant issue, the cron routes) calls these
// directly. Every step move is a read-modify-write under a row lock, so two
// quick marks from one chain never lose each other.

export async function createUiJob(input: {
  id?: string | null;
  kind: string;
  subject?: string | null;
  label: string;
  steps: JobStep[];
  actor: string;
  keepDone?: string[];   // on a resume, the steps already finished stay finished
}): Promise<string> {
  const steps = input.keepDone?.length
    ? input.steps.map((s) => (input.keepDone!.includes(s.key) ? { ...s, state: 'done' as const } : s))
    : input.steps;
  const row = await one<{ id: string }>(
    `insert into ui_jobs (id, kind, subject, label, status, steps, actor, started_at)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, 'running', $5::jsonb, $6, now())
     on conflict (id) do update set
       status = 'running', steps = excluded.steps, label = excluded.label,
       started_at = coalesce(ui_jobs.started_at, now()), finished_at = null, error = null
     returning id::text as id`,
    [input.id ?? null, input.kind, input.subject ?? null, input.label, JSON.stringify(steps), input.actor]
  );
  return row!.id;
}

export async function markJobStep(
  id: string,
  key: string,
  state: StepState,
  extra: { note?: string | null; attempt?: number | null; label?: string; parallel?: boolean } = {}
): Promise<void> {
  await withTx(async (c) => {
    const r = await c.query<{ steps: JobStep[] }>(`select steps from ui_jobs where id = $1 for update`, [id]);
    if (!r.rows[0]) return;
    const steps = applyTransition(r.rows[0].steps ?? [], key, state, new Date().toISOString(), extra);
    const status = statusFromSteps(steps);
    await c.query(
      `update ui_jobs set steps = $2::jsonb,
              status = case when status in ('done', 'failed') and $3 = 'running' then status else $3 end
        where id = $1`,
      [id, JSON.stringify(steps), status === 'queued' ? 'running' : status]
    );
  });
}

// Finishes a job and stamps its actual cost: the ai_cost_log rows for the
// features its steps declared, since it started (a few seconds of slack for
// clock skew). Returns that cost so the caller can show it at once.
export async function finishUiJob(id: string, resultHref?: string | null): Promise<number | null> {
  return withTx(async (c) => {
    const r = await c.query<{ steps: JobStep[]; started_at: Date | null }>(
      `select steps, started_at from ui_jobs where id = $1 for update`, [id]
    );
    if (!r.rows[0]) return null;
    const now = new Date().toISOString();
    // Close any step the caller left open (a chain that finished early).
    const steps = (r.rows[0].steps ?? []).map((s) => (s.state === 'running' ? { ...s, state: 'done' as const, endedAt: now } : s));
    const features = [...new Set(steps.flatMap((s) => s.features ?? []))];
    let cost: number | null = null;
    if (features.length && r.rows[0].started_at) {
      const cr = await c.query<{ usd: string | number | null }>(
        `select sum(cost_usd) as usd from ai_cost_log
          where feature = any($1::text[]) and created_at >= $2::timestamptz - interval '5 seconds'`,
        [features, r.rows[0].started_at]
      );
      const v = cr.rows[0]?.usd;
      cost = v == null ? 0 : Number(v);
    }
    await c.query(
      `update ui_jobs set status = 'done', steps = $2::jsonb, finished_at = now(),
              result_href = coalesce($3, result_href), error = null, cost_usd = $4
        where id = $1`,
      [id, JSON.stringify(steps), resultHref ?? null, cost]
    );
    return cost;
  });
}

// A resumable run that stops for now without failing (Savant's parked legs,
// a click that ran out of its time budget): queued until the next call.
export async function parkUiJob(id: string, note: string): Promise<void> {
  await withTx(async (c) => {
    const r = await c.query<{ steps: JobStep[] }>(`select steps from ui_jobs where id = $1 for update`, [id]);
    if (!r.rows[0]) return;
    const steps = (r.rows[0].steps ?? []).map((s) => (s.state === 'running' ? { ...s, state: 'todo' as const, note } : s));
    await c.query(`update ui_jobs set status = 'queued', steps = $2::jsonb where id = $1`, [id, JSON.stringify(steps)]);
  });
}

export async function failUiJob(id: string, error: string): Promise<void> {
  await withTx(async (c) => {
    const r = await c.query<{ steps: JobStep[] }>(`select steps from ui_jobs where id = $1 for update`, [id]);
    if (!r.rows[0]) return;
    const now = new Date().toISOString();
    const steps = (r.rows[0].steps ?? []).map((s) => (s.state === 'running' ? { ...s, state: 'failed' as const, endedAt: now } : s));
    await c.query(
      `update ui_jobs set status = 'failed', steps = $2::jsonb, finished_at = now(), error = $3 where id = $1`,
      [id, JSON.stringify(steps), error.slice(0, 1000)]
    );
  });
}

// A long single step (a Savant leg, a deep dive) touches the row so the
// stale rule does not call it lost while it is still working.
export async function heartbeatUiJob(id: string): Promise<void> {
  await exec(`update ui_jobs set updated_at = now() where id = $1 and status in ('queued', 'running')`, [id]);
}
