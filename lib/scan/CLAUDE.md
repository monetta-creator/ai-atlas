# External Scan (and shared Tavily/OpenRouter facts)

Migration `0038`. A weekday cron-driven sweep of public news across configurable topics (financial services + technology, broader than the AI lenses). Console at `scan/page.tsx` (admin, `adminGate`, `maxDuration = 60`, admin nav row "Scan"). Output ships ONLY as key-gated datasets.
Full write-up: docs/external-scan.md

## Files
- `lib/scan/run.ts`: step engine, DB-checkpointed per unit on the day-keyed `scan_runs` row (lease column = overlap guard).
- `lib/scan/feeds.ts`: RSS/Atom feeds per topic; hand-rolled parser in `lib/scan/core.ts`.
- `lib/scan/search-tavily.ts`: Tavily LLM-free news search (`$0` cost-log rows as model `tavily-search`).
- `lib/scan/web.ts`: fallback Sonnet `web_search` call (the scout call shape), used when `TAVILY_API_KEY` is unset.
- `lib/scan/enrich.ts`: per-item summary, taxonomy-code tags allow-listed from active topics, entities, advisory relevance.
- `lib/scan/models.ts`: curated OpenRouter open-weight shortlist with rate cards. `lib/scan/llm.ts`: OpenAI-compat fetch client.
- `lib/scan/budget.ts`: `SCAN_DAILY_BUDGET_USD` guard.
- `lib/scan/source-tiers.ts` (pure), `lib/scan/source-rating.ts`, `lib/scan/ensemble.ts`, `lib/scan/relevance-vote.ts`, `lib/scan/handoff.ts`, `lib/scan/tavily-breaker.ts`.
- `lib/data/scan.ts`: `getScanHealth`. `lib/feeds/late-sweep.ts`: late feed sweep.

## Flow
- Pipeline: feeds + per-topic news search, hydrate via `fetchCandidateText`, enrich per item.
- Drivers: four weekday Vercel windows 09:00 / 11:00 / 13:00 / 15:00 UTC (`/api/cron/scan` plus `/sweep`, `/sweep2`, `/sweep3` stubs; scan-only, Bearer `CRON_SECRET`, `maxDuration = 300`) and the console tick loop (`scanTickAction`, one bounded unit per call).
- Discovery window is `lookbackDays(day)` in `lib/scan/core.ts`: 1 day, 3 on Mondays (weekend catch-up). The health panel and day grid treat runless weekends as scheduled off, not misses.
- Late feed sweep: `/api/cron/feeds` weekdays 20:30 UTC (`lib/feeds/late-sweep.ts`) reopens the day's completed run at step `feeds`, re-pulls feeds (no Tavily), lets the engine hydrate + enrich new items under the same daily budget, noted in run notes. One `sweepEngine` over a `SweepEngine` adapter per engine (`SCAN`/`INTEL`).
- Past `SCAN_DAILY_BUDGET_USD` the run completes unenriched.
- Topics are DB rows (`scan_topics`), seeded from the untracked `private/scan-topics.json` by `db:seed:scan`. The real topic set never enters the public repo.

## Enrichment models
- Picker: `scan_prefs.enrich_models` + `scan_items.enriched_by` (mig `0041`). 2+ models picked = deterministic per-item A/B split, compared in the /scan "Model A/B" table. None picked = `claude-haiku-4-5` via `runStructured`'s `model` override.
- Relevance ensemble (mig `0053`): after enrichment every other panel model (`ensemblePanel`: the picked models when 2+, else the default trio) gives a score-only read of the same clipped text (`lib/scan/relevance-vote.ts`, feature `scan_relevance_vote`, ~60 output tokens). `relevance` = MEDIAN of `relevance_votes`; `relevance_spread` is the disagreement signal; the A/B table shows each model's bias vs the median. Keep the random A/B split and ensemble the score; the rubric's absolute anchors must survive (don't quantile-normalize). Backfill: `scripts/backfill-relevance-votes.mjs`.

## Source reliability tiers (mig `0052`)
- `relevance` is topic fit only. Reliability is a SEPARATE source-derived axis. Nobody tunes it by hand.
- `lib/scan/source-tiers.ts` rates a domain by suffix rules (`.gov`, `.edu`, central banks, blog platforms) and a curated map (~180 domains: regulators, research houses, wires, majors, trade/tech press, aggregators, PR wires, social, promo/junk).
- A domain neither covers is rated ONCE by the utility model (`lib/scan/source-rating.ts`, feature `scan_source_rating`, ~40 domains per call at the search to hydrate transition of both scan and intel engines) and persisted in `source_tiers` (`rated_by` model; a human row is never overwritten).
- Items are stamped `source_tier` (1 best to 4 junk) + `source_kind` at collection (`stampSourceTiers`). `content_kind` (news/analysis/data/press_release/marketing/opinion/other) rides the enrichment call.
- Datasets ship all three plus `priority` = relevance × tier weight (1.0/0.85/0.6/0.25) × content weight (press_release 0.7, marketing 0.4). Backfill: `scripts/backfill-source-tiers.mjs`.

## Datasets, access and the console
- Access: admin console only; items publish ONLY as the key-gated (portal) `external-scan` dataset (heavy, `?day=` filter).
- `signals-export` (key-gated, on /scan's "Firewall export" panel with its own `buildSignalsExportHandoff` copy button) ships EVERY published signal in the same row shape: first 19 columns mirror external-scan key for key, plus signal-native columns incl. `touch_details` (the ONE scoped exception to the datasets guest-safety ban, key-gated only, enforced in `test-datasets.mjs`) and a composed `full_text`.
- Console: download links, schedule + config (crons rendered live from the `vercel.json` import, env status, today's spend), crons on/off toggle (`scan_prefs` singleton, mig `0039`; pauses the CRON route only, manual runs bypass it; cron TIMES stay deploy-time config in `vercel.json`), topic registry, import contract from the live dataset registry.
- **Copy importer handoff** (`buildScanHandoff` in `lib/scan/handoff.ts`): orientation doc for the firewall-side intake assistant (JSON Schema from registry columns + the `FIELD_FACTS` nullability/enum map, field guarantees, status semantics, live taxonomy codes, transport last; portal key as a placeholder). Test-guarded: a new dataset column must be added to `FIELD_FACTS` or `test-scan.mjs` fails.
- History and health: `ScanCalendar` day grid (17 weeks; completed cells link to `?day=&download=1`, intensity by item volume, failed days in status color), 30-day `getScanHealth` panel (run/miss counts, fetch success, enrichment coverage, relevance, spend), topic-yield table (dry searched topics flagged), recent-issues feed from persisted run notes (mig `0040`: feed/search/budget notes append to `scan_runs.notes`, deduped, cap 40), per-run JSON/CSV chips.

## Shared by every engine: Tavily, OpenRouter, search budget
Scan, pipeline, intel and tooling all use these. Cron schedule, `CRON_SECRET` and the other engine budgets live in `lib/cron/CLAUDE.md`.
- `TAVILY_API_KEY`: switches the scan search leg to Tavily's LLM-free news search. Unset = the Sonnet `web_search` call.
- Plan: 5,000-credit Pro plan (the free 1,000 ran out at ~60 queries per weekday across scan/pipeline/intel/tooling). `TAVILY_MONTHLY_CAP` defaults to 5000 for the quota tile (`getTavilyQuota`).
- A Tavily 432 trips the module-state breaker in `lib/scan/tavily-breaker.ts` (`tavilyAvailable()`, re-exported from `search-tavily.ts`). 15 minutes per trip (about one work budget; Fluid Compute reuses warm instances and the next window should re-learn with one call).
- Only a live 432 inside `tavilyQuery`/`searchTopicNewsTavily` trips it, so callers need no `TAVILY_API_KEY` check in front of it.
- On trip, scan, intel, pipeline and tooling engines skip their remaining search legs with ONE run note instead of firing every unit into it.
- `TAVILY_QUOTA_NOTE_RE` is the one matcher for both note spellings. `tavilyQuotaWarning` turns the Daily Jobs widget amber with "search legs skipped: Tavily quota" when a completed run's notes match. The `reopen*` mutations strip those notes.
- Recovery once credits are back: `GET /api/cron/{scan,intel}?rerun=search` and `/api/cron/pipeline?rerun=discovery` reopen a completed run at its search step.
- `OPENROUTER_API_KEY`: powers the /scan picker's cheap enrichment models. Unset or nothing picked = Haiku fallback.
- Scan's 2-query topics rotate to 1/day to stay inside Tavily quota.

## Tests
- `scripts/test-scan.mjs`, `test-datasets.mjs`.
