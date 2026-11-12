# Model runs: one shared UX for every model call

Migrations `0072`-`0073` (`ui_jobs`). Every button that starts a model call registers a job in `ui_jobs` and moves its steps through it, so a run survives leaving the page. Styles `.mr-*`/`.jobs-*` in `app/styles/model-run.css`.

## Data
- `ui_jobs` columns: kind, subject (the resume key), `steps` jsonb with per-step features, status `queued|running|done|failed`, actor (`admin` | `cron` | `key:<keyId>`), `cost_usd`.
- `cost_usd` is stamped at finish from `ai_cost_log` over the steps' features since start.

## Pure core (`lib/jobs/core.ts`)
- Transitions.
- `typicalForSteps`: the sum of per-call p50 time and cost from `getFeatureStats()` over 180 days; one sample is enough.
- Stale rule: running untouched 10 min = lost; queued (a parked resumable run) 6 h.
- `jobFromEngineRun`: shows engines holding their lease as synthetic running jobs.
- `canSeeJob` / `jobViewerFor`.

## Client
- `lib/jobs/use-model-run.ts` `useModelRun({ kind, subject, label, steps: StepSpec[], stats, initialJob, run(ctx, from), mode: 'chain' | 'poll' })`.
  - `ctx.step` retries visibly. A result with `ok:false` or a throw is a failed attempt. Retry resumes from the failed step.
  - `poll` mode is for one long server action that moves its own steps. A page opened mid-run polls `/api/jobs/<id>`.
- `components/jobs/ModelRunPanel.tsx`: stepper, current sentence, `0:23 elapsed · usually about 55s · $0.09`, a progress bar that never reaches 100 while running, retry line, done state with actual time + cost + link, failed state with Retry from step, run log.
- `ModelCallButton`: compact single-call form. `feature` or `features[]` supply the usual time and cost. `isFailedResult` treats `{ error }` without `ok: true` as a failure.
- `FormRunStatus`: for form-post buttons.
- Rail `JobsIndicator` (only while something runs) and `JobToasts` (mounted from the Header so phones get them). Runs under 30s finish in front of the reader and get no toast.
- One shared poll in `lib/jobs/jobs-store.ts`: 5s while active, 30s idle, paused while the tab is hidden, stops on 401.
- Client pages that cannot receive `stats` as a prop read them from `lib/jobs/stats-client.ts` `useFeatureStats()` over `GET /api/jobs/stats`.

## Routes and access
- `/api/jobs/active` and `/api/jobs/[id]` gate on `identityFromRequest`: admin sees all, a keyholder only their own. Both sit on `PUBLIC_API_PREFIXES`.

## Who uses it
- Multi-step consoles use `useModelRun` chains: Sheet, Thesis, ToolingReport, ReportGenerator (per-lens steps then synthesis; a failed synthesis fails the run with Retry, never saves without it), Pipeline/ResearchConsole/Scout phases.
- The seven engine consoles share `lib/jobs/use-tick-loop.ts` `useTickLoop({ engine, label, start, tick, read })` + `components/jobs/TickLoopPanel.tsx`. Job kind `engine:<name>`, subject = the run id; a held lease or Stop parks the job.
- Savant's issue runs in poll mode: `lib/savant/issue-job.ts` `runSavantIssueJob` wraps `runSavantIssue` with `onLeg` marks over `SAVANT_ISSUE_STEPS` (`lib/savant/issue-steps.ts`, per-leg features like `savant_lead:research`, measured per `feature:leg` from `metadata.leg`). It parks the job on a partial return so the next click or the 20:20/20:40 UTC cron sweep resumes the same job. The cron creates it with actor `cron`.
- Not on it: `AskWorkspace`/`AskThread` and the agent chat keep their streaming UI.

## Tests
- `scripts/test-jobs-core.mjs`
