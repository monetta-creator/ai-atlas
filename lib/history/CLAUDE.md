# History backfill and the reader organization's public record

One-time backfill of the AI economy since ChatGPT, plus the `self` company's cited public record. Migs `0076`-`0077`.
Full write-ups: docs/history-backfill.md, docs/self-record.md

## Run
- `npx -y tsx scripts/history-backfill.mts <phase> [--dry-run] [--month=YYYY-MM] [--limit=N]`. A LOCAL script, never a cron.
- Pure rules in `lib/history/core.ts`: `monthWindows` (folds the one-day Nov 2022 window into December because Tavily refuses start = end), `pickLandmarks` + `sameStory`, `extractAiPassages`, `validateTimeline`/`validateProfile` citation gates, `tavilyRoom`. Test: `scripts/test-history-core.mjs`.
- Network fetchers in `lib/history/self-sources.ts`.

## Data
- It NEVER writes the day-keyed engine tables: every live reader of them windows on `created_at` (edition, intel deck, Savant, datasets by run day).
- Writes `history_items` (AI economy Dec 2022 to Aug 2026 by month and lens, keyed on the article's own date, triaged, landmarks marked), `self_record` + `self_timeline` + `intel_companies.public_profile`, and `backfill_units` (the checkpoint).
- The `self` record sources: SEC filings with deterministic AI passages via `extractAiPassages`, 8-K press-release exhibits, merger filings, news with the exact quoted name, OpenAlex research, USPTO patents via the Open Data Portal when `PATENTSVIEW_API_KEY` is set (an ODP key; `search.patentsview.org` no longer resolves), regulator-domain enforcement and merger orders, the organization's own regulations.gov comment letters and govinfo hearings when `DATA_GOV_API_KEY` is set. Both keys are local-only.
- SEC documents can carry NUL bytes: strip before insert.

## Guard rails
- Model calls log under `history_*` / `self_record_*` features that no live budget checker sums; the script caps itself at `--cap` (default $25).
- Tavily stops `TAVILY_RESERVE` (600) short of `TAVILY_MONTHLY_CAP`.
- `tavilyQuery` takes `startDate`/`endDate`/`exactMatch`; `days` counts back from NOW and cannot reach a past month.

## Landmarks and drafts
- Landmarks draft through ONE pipeline run (cadence `backfill`, excluded like `source` from run history) via `analyzeCandidate(id, model, { feature: 'history_analysis', origin: 'backfill' })` into draft signals with `origin = 'backfill'` and `published_at` = the article date.
- The auto-publish sweep only publishes origin `pipeline`; the drafts desk bulk cuts skip backfill; `/signals/drafts?batch=backfill` reviews them as their own batch.
- The Daily Edition and Savant's weekly reads must exclude origin `backfill` so a published 2023 story never leads today.

## Access & surfaces
- Kept history items embed as kind `history_item` (keyholders/admin only) and cite in Ask as `[history H3]`.
- Savant reads `public_profile` + the latest timeline events as the reader-organization context; its allow-list admits `self_record` URLs.
- `/savant/record` (keyholders + admin): the profile, the timeline, the record list, with CSV/JSON buttons for the key-gated `company-record` dataset (the firewall export: documents, timeline events and profile sentences in one row shape via `record_type`, with `cites`/`cite_urls`; `buildCompanyRecord` in `lib/datasets/builders.ts`). Pair it with `intel-items`/`intel-facts`/`intel-metrics` `?company=<slug>`.

## Landmines
- Heavy JSON downloads must stream (`streamString` in the datasets route, surrogate-safe slices): Vercel refuses a buffered function response over 4.5 MB, and the company record alone is ~4.7 MB.
- A flash model asked for a verdict on EVERY item answers a handful and drops the rest, so triage asks for a keep-list and runs on Haiku.
- Anthropic strict tools need `additionalProperties: false` on every object.
