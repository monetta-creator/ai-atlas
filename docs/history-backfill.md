# The backfill since ChatGPT

A one-time job (2026-09-27) that gives the Atlas a history before its engines existed: what happened in AI from ChatGPT's launch (2022-11-30) to the day the daily engines started (2026-08-28). It runs locally from `scripts/history-backfill.mts`; it is not a cron and not an engine.

## Why it is a script and not the engines

Every live reader of the engine tables windows on `created_at`: the Daily Edition, the company intel deck, Savant's pack and volume baselines, and the datasets by run day. Writing three years of items into `scan_items` or `intel_items` would make all of them look like they arrived today. So the backfill never writes those tables. It writes its own stores, keyed on the article's own publish date:

| Table | Holds |
|---|---|
| `history_items` | what the news search returned per month and audience lens, triaged, with each month's landmarks marked |
| `backfill_units` | the checkpoint: one row per unit of work (a month-lens window, a filing, a synthesis leg), with credits, items and notes |
| `self_record`, `self_timeline` | the reader organization's public record, see `docs/self-record.md` |

## Phases

`npx -y tsx scripts/history-backfill.mts <phase> [--dry-run] [--limit=N] [--month=YYYY-MM]`

| Phase | What it does | Cost |
|---|---|---|
| `probe` | 40 queries over eight sample months: result counts and the share dated inside the window | 40 credits |
| `collect` | 45 month windows × 6 lenses × 2 queries, plus one "biggest AI news of the month" roundup per window | about 585 credits |
| `triage` | the utility model keeps what mattered, with a significance and the best lens | cents |
| `landmarks` | up to 8 per month across lenses, near-duplicate headlines dropped, at most 3 per lens | free |
| `draft` | landmarks become candidates on ONE pipeline run (cadence `backfill`), are hydrated, and analyzed into draft signals with `origin = 'backfill'` and `published_at` = the article date | about $0.01 each on Haiku |
| `status` | units by phase, Tavily credits this month, spend so far | free |

What the probe found (2026-09-27): Tavily's news search with `start_date`/`end_date` reaches back to December 2022 with every result dated inside its window, 5 to 10 results per query. The generic lens queries missed month-defining stories (December 2022 returned no ChatGPT item), which is why each window adds a roundup query. The one-day November 2022 window folds into December because Tavily refuses a window whose start equals its end.

## Guard rails

- **Spend**: every model call logs under a `history_*` or `self_record_*` feature, which no live budget checker sums. The script stops at `--cap` (default $25) by summing those features.
- **Tavily**: before each unit the script reads month-to-date credits (the same sum as the quota tile) and stops `TAVILY_RESERVE` (600) credits short of `TAVILY_MONTHLY_CAP`, so the crons never hit a 432.
- **Idempotent**: `backfill_units` plus unique URLs; rerunning a phase skips finished units and retries failed ones.
- **Drafts only**: backfill drafts never publish on their own. The auto-publish sweep only publishes origin `pipeline`, the drafts desk's bulk cuts skip origin `backfill`, and the drafts desk shows them as their own batch (`/signals/drafts?batch=backfill`).
- **No flooding on publish**: when a person publishes a backfill draft, its evidence enters the map with the historical date. The Daily Edition's signals window and Savant's weekly reads exclude origin `backfill`, so an old story never leads today's paper or this week's issue.
- **Ask**: kept `history_items` are embedded as kind `history_item` (keyholders and admin) and cite as `[history H3]`, so "what happened in March 2024" has answers.

## Provenance

- `history_items.batch` names the run (`since-chatgpt`).
- Drafted signals carry `origin = 'backfill'`, `drafted_by` = the analysis model, and a candidate on the backfill pipeline run.
- `backfill_units` keeps the per-unit trail.
