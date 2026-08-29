# Discovery Pipeline 2.0

The 2026-08-29 rework (migration `0042`): cheap providers, a server-side step
engine, daily cron cadence, and an analysis model A/B. The 1.0 design (console
driven, weekly, all Sonnet) cost ~$3.70/run; 2.0 runs daily for ~$0.05-0.10.

## Providers

| Leg | 1.0 | 2.0 (with fallback) |
|---|---|---|
| Lens discovery | Sonnet + web_search, ~$0.127/batch | Tavily news search, LLM-free, $0 (`lib/pipeline/search.ts` `searchCandidatesTavily`; falls back to `lib/pipeline/web.ts` when `TAVILY_API_KEY` is unset) |
| Breaking sweep | Sonnet + web_search over the quality-outlet allowlist | Tavily over the same allowlist + ONE utility-model judgment call (significance + lens assignment) |
| Triage | Sonnet `runStructured` | The utility model via OpenRouter (`pipeline_prefs.utility_model`, default `DEFAULT_UTILITY_MODEL` in config.ts); Sonnet fallback |
| Analysis (drafts) | Sonnet, effort medium | **The A/B**: the /pipeline picker's OpenRouter models, assigned per candidate by `pickEnrichModel` (UUID hash); empty selection = Sonnet. Every draft stamps `signals.drafted_by` |
| Coverage check | Sonnet + web_search, ~$0.18 | Tavily + one utility-model compare call |

The judgment guards did not move: every model output passes the same
allow-list/coercion validation, and a human still reviews and publishes every
draft. `drafted_by` is admin-only (stripped for guests in `getSignal`, off the
feed columns and every dataset).

## Cadence and rotation

Daily runs sweep ALL six lenses with `rotatedQueries` (config.ts): ~2 queries
per lens per day, a deterministic day-indexed window over each lens's full
query list, so full coverage lands every ~3 days at a fraction of the daily
search spend. Weekly/manual console runs keep the full batched set. The scan's
2-query topics rotate to 1/day the same way, keeping combined Tavily usage
(~730/mo) inside the 1,000 free tier.

## The engine and the shared cron

`lib/pipeline/engine.ts` `advancePipelineRun(runId, deadlineAt)` is the scan
pattern: bounded units, persisted checkpoints, a lease
(`pipeline_runs.lease_until`), resumable at every step. Discovery checkpoints
per unit in `pipeline_runs.discovered_units` ('market:0' … 'sweep'); triage and
analysis checkpoint through the candidate rows as before. Unit semantics match
the console orchestrator: discovery failures are notes, a triage failure fails
the run resumably, analysis distinguishes terminal (give up, mark
unanalyzable) from transient (left for the next invocation).

Vercel Hobby allows exactly two crons and the External Scan holds both, so
`/api/cron/scan` is now the **shared daily driver**: it advances the scan to
completion, then (with >60s of budget left) claims and advances the day's
pipeline run (`getOrCreateDailyRun` — the two invocations share one run per
day). Each leg is independently toggleable (`scan_prefs.enabled` /
`pipeline_prefs.enabled`) and the 11:xx sweep invocation finishes whatever the
9:xx one could not. Budget guard: `checkPipelineBudget`
(`PIPELINE_DAILY_BUDGET_USD`, default 1.00) before every billable unit; a trip
fails the run with a resume note.

The console is unchanged: its actions call the same underlying functions
(hydrate logic now shared via `lib/pipeline/hydrate.ts`), and the console's
analyze path A/Bs with the same picker selection.

## Operating it

- `/pipeline` carries the config: the daily-cron toggle, the analysis model
  picker (shared `EnrichModelPicker`, prop-injected save action), and the
  **Model A/B table** (per `drafted_by`: drafts, published, archived, avg
  touches, latency, $/draft). The published-vs-archived split is the real
  quality signal; read the drafts themselves on /signals/drafts (each signal
  page shows its `drafted_by` badge to admins).
- Manual runs: the console's buttons, or curl the cron route
  (`Authorization: Bearer $CRON_SECRET`) until `done: true`.
- Env: `TAVILY_API_KEY` + `OPENROUTER_API_KEY` (already set for the scan),
  `PIPELINE_DAILY_BUDGET_USD`.
- Watch: Tavily monthly usage (~730 projected across scan + pipeline; quota
  errors surface in run notes), and the first unattended Monday (3-day
  lookback + both legs on one cron).
