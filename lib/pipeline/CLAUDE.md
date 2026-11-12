# Discovery pipeline

Finds AI developments, triages them, and drafts Signal Board signals (always drafts; a human publishes). Console `pipeline/page.tsx` (`PipelineConsole`, admin, `adminGate`, `maxDuration = 60`): discover (lens batches + breaking sweep), triage, analyze, review over `pipeline_runs` + `signal_candidates`, then an advisory coverage check panel, plus the retained-text strip (`TextGuardPanel` + `refetchMissingTextAction`, max 5 rows/call). Requires server-only `ANTHROPIC_API_KEY`.
Full write-up: docs/discovery-pipeline-2.md
Other `runStructured` callers (dossier, summary, lens, concepts, argument gaps) follow the root CLAUDE.md convention (`lib/dossier.ts`).

## Files
- `lib/pipeline/web.ts`: `searchCandidates` (web-grounded discovery), `searchBreakingSweep`, and the candidate fetch layer `fetchCandidateText`.
- `lib/pipeline/analysis.ts`: the SINGLE signal proposer, drafting for both the pipeline and the manual *Turn into signal* flow (`analyzeCandidate` then `createDraftForCandidate`).
- `lib/pipeline/triage.ts`: filters + URL dedup. `lib/pipeline/search.ts`: LLM-free Tavily lens discovery.
- `lib/pipeline/engine.ts`: `advancePipelineRun`. `lib/pipeline/hydrate.ts`: shared hydrate logic. `lib/pipeline/coverage.ts`: coverage check. `lib/pipeline/config.ts`: `PIPELINE_DAY_START_SQL`, `DEFAULT_UTILITY_MODEL`.
- Queries: `getZeroYieldDomains`, `getDomainStats`, `isFetchHostileDomain` in `lib/data/pipeline.ts`.
- The learning loop (mig `0016`): `signal_candidates.fetched_via` (`direct`/`jina`) + `discovery_queries` record how each URL was fetched and found; zero-yield domains feed `blocked_domains`, triage sees per-domain track records, fetch-hostile domains route straight to the reader.

## Pipeline 2.0 (mig `0042`)
- Cheap providers with Sonnet fallbacks: lens discovery = LLM-free Tavily; sweep + coverage = Tavily fetch + one utility-model judgment call; triage = the utility model (`DEFAULT_UTILITY_MODEL` in `config.ts` or `pipeline_prefs.utility_model`).
- Analysis A/B: the /pipeline picker's OpenRouter models per candidate via `pickEnrichModel`; drafts stamp `signals.drafted_by` (admin-only, stripped in `getSignal`, badge on the signal page, compared in the /pipeline Model A/B table). Empty selection = Sonnet.
- Daily rotating queries: `rotatedQueries`, about 2 per lens per day over the full lists, full coverage every ~3 days.
- Server-side engine: `advancePipelineRun`, scan pattern with `discovered_units` checkpoints + `lease_until` on `pipeline_runs`; `checkPipelineBudget` vs `PIPELINE_DAILY_BUDGET_USD` (default 1.00).
- Cron: `/api/cron/pipeline` plus `/sweep` (weekdays; prefs toggle). Cron schedule facts: `lib/cron/CLAUDE.md`. Tavily breaker, quota and `?rerun=discovery`: `lib/scan/CLAUDE.md`.
- Day boundary: the pipeline "day" starts at 06:00 UTC (`PIPELINE_DAY_START_SQL`). A daily run created 00:00 to 06:00 UTC counts as the previous day, so a late-evening smoke test cannot consume the next morning's run key.

## Web search call shape
- `searchCandidates`: a standard `messages.create` with the GA `web_search` tool (`web_search_20250305`, no beta header) plus a `submit_candidates` client tool. Same shape as scout discovery (`lib/scout/web.ts`).
- Decomposed into many short DB-checkpointed units (one lens's query batch, max 3 searches, about 45s), not one long call: this buys resumability and cheap retries.
- Analysis is two invocations per candidate: `hydrateCandidateAction` (fetch + cache `raw_content`, with the reader fallback) then `analyzeCandidateAction` (the model leg).
- `blocked_domains` passed to the search tool = curated deny-list + learned zero-yield domains. Guardrails in `getZeroYieldDomains`: duplicates count as YIELD, a never-auto-block allowlist protects primary sources/wires, only the trailing 90 days count so blocks decay.
- Run-static prompt halves (analysis target list, triage digest) live in the cached system block.
- Lens query templates resolve `{year}` AND `{month}` from the run window (`resolveDateTokens`): month-anchored, news-shaped phrasing, because evergreen year-only queries surfaced SEO listicles.
- Triage materiality override: a major uncovered development gets approved even from a weak source.
- Triage also flags any URL already in `sources` (a manual upload) or a prior draft as `duplicate`, so a manual link never re-enters discovery.

## Breaking sweep and coverage check
- `searchBreakingSweep`: lens-agnostic, significance-first, over a curated `allowed_domains` outlet list.
- Landmine: every `allowed_domains` entry must be crawlable by Anthropic's agent or the API 400s. reuters, apnews, nytimes, wsj, ft, economist, theverge, arstechnica all block it.
- Coverage check (`lib/pipeline/coverage.ts`): re-derives the window's biggest AI developments with independent phrasing, marks each covered/missed vs the run's candidates + existing signals, persists to `pipeline_runs.coverage`. Advisory only.

## Fetch layer
- `fetchCandidateText`: direct HTML/PDF fetch with `unpdf` extraction, NUL/control-char sanitization, terminal-vs-transient `FetchFailure` classification, and an `r.jina.ai` reader fallback for bot-walled/paywalled hosts. Optional `JINA_API_KEY` lifts its keyless rate limit.
- Fetch-hostile domains route straight to the reader (`isFetchHostileDomain`).
- `unpdf` also does browser-side PDF to text on the add-source form (text only; the file is never stored).

## Data model
- `pipeline_runs` (mig `0005`): `status` (`run_status_t` running/completed/failed), `step` (`run_step_t` discovery/triage/analysis/complete), `cadence` (`run_cadence_t` manual/daily/weekly/`source`; `source` = single manual-source runs, kept out of discovery history/analytics/lookback), running tallies, `coverage jsonb` (mig `0026`: `{since, checked_at, developments:[{headline,url,covered,matched}]}`), `discovered_units`, `lease_until`.
- `signal_candidates`: `lens` (reuses `signal_lens_t`), `triage_status` (`triage_status_t` pending/approved/rejected/duplicate), `unique (run_id, url)`, cascade delete on `run_id`, `signal_id` set when a candidate becomes a draft, `source_id` (mig `0015`) set for a manual upload so analysis reuses the curated source's text/metadata/prior instead of `ensureSource`ing a bare row.
- These tables ARE the run's checkpoint state, so runs are resumable.
