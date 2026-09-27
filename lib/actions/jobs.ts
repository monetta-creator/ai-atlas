'use server';

import { getPortalIdentity } from '../portal/identity';
import { createUiJob, markJobStep, finishUiJob, failUiJob, heartbeatUiJob, parkUiJob } from '../mutations/jobs';
import { getUiJob } from '../data/jobs';
import { actorFor, jobViewerFor, stepsFromSpecs, STEP_KEY_RE, type StepSpec, type StepState } from '../jobs/core';
import { UUID_RE } from './shared';

// The client's door into the model-run registry (lib/jobs/use-model-run.ts
// calls these between the steps of a chain). The gate is admin OR an active
// keyholder, and a keyholder may only touch jobs they started: the job row's
// actor must match. Every input is validated; a failed registry write never
// breaks the run it describes (the hook fires these without awaiting).

async function viewer() {
  const v = jobViewerFor(await getPortalIdentity());
  const actor = actorFor(v);
  if (!actor) throw new Error('Unauthorized');
  return { v, actor };
}

async function owned(id: string) {
  if (!UUID_RE.test(id)) throw new Error('Invalid job id.');
  const { v } = await viewer();
  const job = await getUiJob(id, v);
  if (!job) throw new Error('Job not found.');
  return job;
}

const STATES: StepState[] = ['todo', 'running', 'done', 'failed'];
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : null);

const FEATURE_RE = /^[a-z0-9_]{1,60}$/;

export async function createUiJobAction(input: {
  id: string; kind: string; subject?: string | null; label: string; steps: StepSpec[]; keepDone?: string[];
}): Promise<{ ok: true }> {
  const { v, actor } = await viewer();
  if (!UUID_RE.test(input.id)) throw new Error('Invalid job id.');
  if (!/^[a-z0-9:_-]{1,60}$/.test(input.kind)) throw new Error('Invalid job kind.');
  const steps = (Array.isArray(input.steps) ? input.steps : []).slice(0, 40)
    .filter((s) => typeof s?.key === 'string' && STEP_KEY_RE.test(s.key))
    .map((s) => ({
      key: s.key,
      label: clip(s.label, 80) ?? s.key,
      running: '',
      features: (Array.isArray(s.features) ? s.features : []).filter((f) => typeof f === 'string' && FEATURE_RE.test(f)).slice(0, 12),
    }));
  // Re-registering an existing id is a retry of that job: allowed only for its owner.
  const existing = await getUiJob(input.id, { admin: true, keyId: null });
  if (existing && existing.actor !== actor && !v.admin) throw new Error('Unauthorized');
  await createUiJob({
    id: input.id,
    kind: input.kind,
    subject: clip(input.subject, 120),
    label: clip(input.label, 160) ?? input.kind,
    steps: stepsFromSpecs(steps),
    actor: existing?.actor ?? actor,
    keepDone: (Array.isArray(input.keepDone) ? input.keepDone : []).filter((k) => typeof k === 'string' && STEP_KEY_RE.test(k)),
  });
  return { ok: true };
}

export async function markJobStepAction(
  id: string, key: string, state: StepState, extra: { note?: string | null; attempt?: number | null; label?: string; parallel?: boolean } = {}
): Promise<{ ok: true }> {
  await owned(id);
  if (!STEP_KEY_RE.test(key)) throw new Error('Invalid step.');
  if (!STATES.includes(state)) throw new Error('Invalid step state.');
  await markJobStep(id, key, state, {
    ...(extra.note !== undefined ? { note: clip(extra.note, 500) } : {}),
    ...(typeof extra.attempt === 'number' ? { attempt: Math.max(1, Math.min(9, Math.floor(extra.attempt))) } : {}),
    ...(extra.label ? { label: clip(extra.label, 80) ?? undefined } : {}),
    ...(extra.parallel ? { parallel: true } : {}),
  });
  return { ok: true };
}

export async function finishUiJobAction(id: string, resultHref?: string | null): Promise<{ ok: true; costUsd: number | null }> {
  await owned(id);
  // Only a same-site path may be stored as the result link.
  const href = typeof resultHref === 'string' && /^\/[^/\\]/.test(resultHref) ? resultHref.slice(0, 300) : null;
  const costUsd = await finishUiJob(id, href);
  return { ok: true, costUsd };
}

export async function parkUiJobAction(id: string, note: string): Promise<{ ok: true }> {
  await owned(id);
  await parkUiJob(id, clip(note, 300) ?? 'paused');
  return { ok: true };
}

export async function failUiJobAction(id: string, error: string): Promise<{ ok: true }> {
  await owned(id);
  await failUiJob(id, clip(error, 1000) ?? 'failed');
  return { ok: true };
}

export async function heartbeatUiJobAction(id: string): Promise<{ ok: true }> {
  await owned(id);
  await heartbeatUiJob(id);
  return { ok: true };
}
