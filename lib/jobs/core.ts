// The model-run registry's pure core (2026-09-27): types, step transitions,
// the typical-time-and-cost estimate, and the stale rule. Zero imports, so
// scripts/test-jobs-core.mjs loads it under plain Node, and both the server
// (lib/data/jobs.ts, lib/mutations/jobs.ts) and the client hook
// (lib/jobs/use-model-run.ts) share one definition of a job.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type StepState = 'todo' | 'running' | 'done' | 'failed';

export interface JobStep {
  key: string;
  label: string;
  state: StepState;
  startedAt?: string | null;
  endedAt?: string | null;
  note?: string | null;
  attempt?: number | null;
  features?: string[];   // the ai_cost_log features this step spends (the finish-time cost sums them)
}

export interface UiJob {
  id: string;
  kind: string;
  subject: string | null;
  label: string;
  status: JobStatus;
  steps: JobStep[];
  startedAt: string | null;
  finishedAt: string | null;
  resultHref: string | null;
  error: string | null;
  actor: string;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
}

// A step as a caller declares it: the stepper label, the sentence shown while
// it runs, and the ai_cost_log feature slugs it spends (one entry per
// expected call, so a leg that makes three calls lists its feature three
// times). A step with no features is deterministic work (a pack, a save).
export interface StepSpec {
  key: string;
  label: string;
  running: string;
  features?: string[];
}

export function stepsFromSpecs(specs: StepSpec[]): JobStep[] {
  return specs.map((s) => ({ key: s.key, label: s.label, state: 'todo' as const, ...(s.features?.length ? { features: s.features } : {}) }));
}

// Moves one step to a new state. Never regresses a finished step; a step
// that starts running closes any earlier step still marked running (a caller
// that skipped its 'done' mark, or a resumed chain) as done; a step the
// caller never declared is appended, so an engine's steps can arrive as the
// run reports them.
export function applyTransition(
  steps: JobStep[],
  key: string,
  state: StepState,
  at: string,
  extra: { note?: string | null; attempt?: number | null; label?: string; parallel?: boolean } = {}
): JobStep[] {
  const idx = steps.findIndex((s) => s.key === key);
  const base = idx >= 0 ? steps : [...steps, { key, label: extra.label ?? key, state: 'todo' as const }];
  const at_ = idx >= 0 ? idx : base.length - 1;
  return base.map((s, i) => {
    if (i === at_) {
      if (s.state === 'done' && state !== 'done') return s;
      return {
        ...s,
        state,
        startedAt: s.startedAt ?? at,
        endedAt: state === 'done' || state === 'failed' ? at : s.endedAt ?? null,
        ...(extra.note !== undefined ? { note: extra.note } : {}),
        ...(extra.attempt !== undefined ? { attempt: extra.attempt } : {}),
      };
    }
    // Sequential chains: starting a step closes an earlier one left running.
    // Parallel steps (the period report's lenses) leave their siblings alone.
    if (!extra.parallel && state === 'running' && i < at_ && s.state === 'running') return { ...s, state: 'done', endedAt: at };
    return s;
  });
}

// The job's overall status from its steps (a failed step fails the job; all
// done is done; anything started is running).
export function statusFromSteps(steps: JobStep[]): JobStatus {
  if (steps.some((s) => s.state === 'failed')) return 'failed';
  if (steps.length && steps.every((s) => s.state === 'done')) return 'done';
  if (steps.some((s) => s.state === 'running' || s.state === 'done')) return 'running';
  return 'queued';
}

// ---------------------------------------------------------------- estimates

export interface FeatureStat { p50Ms: number; p90Ms: number; p50Usd: number; n: number }
export type FeatureStats = Record<string, FeatureStat>;

// A feature needs this many logged calls before its median is used. One is
// enough: most report features run a few times a month, and a rough "about
// 40s" from one real run beats no estimate at all.
export const MIN_SAMPLES = 1;

export interface Typical {
  p50Ms: number;
  p90Ms: number;
  p50Usd: number;
  unknown: string[];   // features with too little history
  known: boolean;      // at least one model step has a trusted estimate
}

// The typical time and cost of a chain: the sum of each step's per-call
// medians. Deterministic steps (no features) add nothing; a feature with too
// little history is listed as unknown and adds nothing, so the estimate
// under-reads rather than invents.
export function typicalForSteps(specs: StepSpec[], stats: FeatureStats | null | undefined): Typical {
  let p50Ms = 0; let p90Ms = 0; let p50Usd = 0;
  const unknown = new Set<string>();
  let anyKnown = false;
  for (const s of specs) {
    for (const f of s.features ?? []) {
      const st = stats?.[f];
      if (!st || st.n < MIN_SAMPLES) { unknown.add(f); continue; }
      anyKnown = true;
      p50Ms += st.p50Ms; p90Ms += st.p90Ms; p50Usd += st.p50Usd;
    }
  }
  return { p50Ms, p90Ms, p50Usd, unknown: [...unknown], known: anyKnown };
}

// "0:42", "1:05:09". Negative or NaN reads as 0:00.
export function clockLabel(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// "about 40s", "about 2 min", "about 1 hr 5 min": the estimate's wording.
export function aboutLabel(ms: number): string {
  if (!(ms > 0)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `about ${Math.max(5, Math.round(s / 5) * 5)}s`;
  const min = Math.round(s / 60);
  if (min < 60) return `about ${min} min`;
  return `about ${Math.floor(min / 60)} hr ${min % 60} min`;
}

export function usdLabel(usd: number): string {
  if (!(usd > 0)) return '';
  if (usd < 0.01) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

// The progress bar: linear to 80% at the median, to 95% at p90, and it never
// reaches 100% while running (an estimate is not a promise).
export function progressPct(elapsedMs: number, p50Ms: number, p90Ms: number): number {
  if (!(p50Ms > 0)) return 0;
  const hi = p90Ms > p50Ms ? p90Ms : p50Ms * 1.5;
  if (elapsedMs <= p50Ms) return (elapsedMs / p50Ms) * 80;
  if (elapsedMs <= hi) return 80 + ((elapsedMs - p50Ms) / (hi - p50Ms)) * 15;
  return 95;
}

// ---------------------------------------------------------------- staleness

// A running job whose heartbeat stopped this long ago was abandoned (a tab
// closed mid-chain, a function killed at its limit): it reads as failed. A
// queued job is a resumable run parked between calls (Savant's legs); it
// waits longer before it reads as abandoned.
export const STALE_AFTER_MS = 10 * 60_000;
export const PARKED_STALE_AFTER_MS = 6 * 60 * 60_000;

export function isStale(job: Pick<UiJob, 'status' | 'updatedAt'>, nowMs: number): boolean {
  const limit = job.status === 'running' ? STALE_AFTER_MS : job.status === 'queued' ? PARKED_STALE_AFTER_MS : 0;
  if (!limit) return false;
  const t = Date.parse(job.updatedAt);
  return Number.isFinite(t) && nowMs - t > limit;
}

export function withStaleRule(job: UiJob, nowMs: number): UiJob {
  if (!isStale(job, nowMs)) return job;
  return { ...job, status: 'failed', error: job.error ?? 'The run stopped reporting (the page was closed or the server timed out).' };
}

// ---------------------------------------------------------------- engines

// The cron-driven engines keep their own run rows; the registry shows a
// running one as a synthetic job so the rail and the ops board see it too.
export type EngineName = 'scan' | 'intel' | 'research' | 'pipeline' | 'tooling';

export const ENGINE_LABEL: Record<EngineName, string> = {
  scan: 'External scan', intel: 'Intel desk', research: 'Research engine', pipeline: 'Discovery pipeline', tooling: 'Tooling monitor',
};

export function jobFromEngineRun(engine: EngineName, run: {
  id: string; day: string | null; step: string | null; started_at: string | null; updated_at: string | null;
}): UiJob {
  const at = run.updated_at ?? run.started_at ?? new Date(0).toISOString();
  return {
    id: `engine:${engine}:${run.id}`,
    kind: `engine:${engine}`,
    subject: run.id,
    label: `${ENGINE_LABEL[engine]}${run.day ? `, ${run.day}` : ''}`,
    status: 'running',
    steps: run.step ? [{ key: run.step, label: run.step, state: 'running', startedAt: run.started_at }] : [],
    startedAt: run.started_at,
    finishedAt: null,
    resultHref: null,
    error: null,
    actor: 'cron',
    costUsd: null,
    createdAt: run.started_at ?? at,
    updatedAt: at,
  };
}

// Where the rail's popover sends you for a job of each kind.
export const JOB_KIND_HREF: Record<string, string> = {
  sheet: '/reports?generate=1',
  tooling_report: '/tooling/reports',
  period_report: '/reports/period',
  thesis: '/theses',
  savant_issue: '/savant/desk',
  field_report: '/field-reports',
  'engine:scan': '/scan',
  'engine:intel': '/intel',
  'engine:research': '/research/console',
  'engine:pipeline': '/pipeline',
  'engine:tooling': '/tooling/console',
  'engine:scout': '/scout/console',
  'engine:research-pull': '/research/console',
};

export function hrefForJob(job: Pick<UiJob, 'kind' | 'resultHref'>): string | null {
  if (job.resultHref) return job.resultHref;
  return JOB_KIND_HREF[job.kind] ?? null;
}

// Who may see a job: the admin sees everything; a keyholder sees jobs they
// started; nobody else sees any.
export function canSeeJob(actor: string, viewer: { admin: boolean; keyId: string | null }): boolean {
  if (viewer.admin) return true;
  return !!viewer.keyId && actor === `key:${viewer.keyId}`;
}

export const STEP_KEY_RE = /^[a-z0-9:_-]{1,40}$/;

// The job viewer and actor for a resolved portal identity: the admin sees
// everything and starts 'admin' jobs; a per-person key starts 'key:<id>'
// jobs; the legacy shared key is one keyholder, 'key:legacy'.
export function jobViewerFor(identity: { tier: string; keyId: string | null; active: boolean }): { admin: boolean; keyId: string | null } {
  if (identity.tier === 'admin') return { admin: true, keyId: null };
  if (!identity.active) return { admin: false, keyId: null };
  if (identity.tier === 'legacy') return { admin: false, keyId: 'legacy' };
  return { admin: false, keyId: identity.keyId };
}

export function actorFor(viewer: { admin: boolean; keyId: string | null }): string | null {
  if (viewer.admin) return 'admin';
  return viewer.keyId ? `key:${viewer.keyId}` : null;
}
