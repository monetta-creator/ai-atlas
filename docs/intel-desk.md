# The Intel Desk

Migration `0043` (2026-08-30): a company-intelligence subsystem. A registry of
tracked companies in tiers, a daily checkpointed collection engine over public
sources, cheap-model enrichment with structured fact extraction, LLM-free
quarterly metrics, and key-gated dataset export for a downstream importer.
The surface (`/intel`) is admin-only; nothing intel-shaped ships un-gated.

The real registry is seeded from the untracked `private/intel-companies.json`
by `npm run db:seed:intel` (the scan-topics discipline: the repo ships only
fictional example rows). The seeder validates everything up front, auto-fills
missing CIKs from SEC's public ticker map, upserts on slug, never touches
`active` after first insert, and never deletes.

## Data model

- **`intel_companies`** — the registry: slug, tier (`self` / `card_issuer` /
  `consumer_bank` / `fintech` / `tech_platform` / `wildcard`), niche (for
  wildcards), the identifier join keys (ticker, cik, rssd_id, fdic_cert,
  lei), aliases (exact search phrases), feed_urls (Bing News RSS is the
  free default; links unwrapped to publisher URLs), search_queries ({month}/{year} tokens), and the monotone
  `dossier` jsonb (Scout's mergeDossier).
- **`intel_runs`** — one row per UTC day: step, `swept_units` (per-leg
  per-company checkpoints), lease, notes, counters. The scan_runs pattern.
- **`intel_items`** — discovered documents with retained full text. Columns
  deliberately mirror `scan_items` so the export mirrors `external-scan`.
- **`intel_facts`** — provenance-carrying extracted facts, deduped per
  company on a normalized `fact_key` (generated column, mirrored by
  `intelFactKey` in `lib/intel/core.ts`).
- **`intel_metrics`** — LLM-free quarterly series keyed
  (company, metric, period, source); `source` is one of `edgar_xbrl`,
  `fdic`, `cfpb`, `y9c` (migration `0044` widened the CHECK for `y9c`).
- **`intel_prefs`** — singleton: cron toggle, enrichment model picker,
  utility model override.

## The engine (`lib/intel/engine.ts`)

`advanceIntelRun(runId, deadlineAt)`, the scan engine pattern, driven by the
`/api/cron/intel` route (plus `/sweep`) and the console tick action. Legs:

1. **feeds** — every active company's RSS in parallel (`fetchFeed` reused).
   Bing News RSS per company is the free primary news channel (links unwrapped to publisher URLs via unwrapNewsUrl).
2. **search** — Tavily per company, ONE company per unit, on a 3-day
   rotation ring (`searchDueSlugs`) to protect the Tavily quota. Skipped
   with a note when `TAVILY_API_KEY` is unset.
3. **filings** — SEC EDGAR submissions per company (8-K, 10-Q, 10-K, S-1,
   DEF 14A, 20-F, 6-K) as items whose primary document hydrates like any
   URL. Monday runs additionally refresh the structured metrics: EDGAR
   XBRL companyfacts (curated concept codes such as revenue and
   net_income, per-filer fallbacks, trailing 8 quarters), FDIC BankFind
   financials (the FULL RIS field set, roughly 2,300 numeric mnemonics,
   per cert per quarter via batched API calls, dictionary-driven off
   FDIC's own risview_properties.yaml with a curated 6-field fallback if
   that dictionary fetch fails), and CFPB complaint counts (a calendar-
   month series plus the trailing-30-day point sample; matched per
   company name, a name mismatch yields zero, tune the registry name).
   `scripts/backfill-intel-metrics.mjs` (one-off, re-runnable) loads the
   history the weekly sweep does not reach on its own: EDGAR's full
   reporting history on first run, and FR Y-9C holding-company
   consolidated series (MDRM-coded, `y9c_<mdrm>`) from the Chicago Fed's
   public archive files through 2021Q1, with recent quarters pending the
   NIC route, which is captcha-walled and not yet automated. Every metric
   write upserts on (company_slug, metric_code, period, source), so
   re-runs of the backfill converge rather than duplicate.
4. **hydrate** — `fetchCandidateText` waves of 4.
5. **enrich** — cheap-model waves of 3 (`lib/intel/enrich.ts`): summary,
   company linkage + dimensions (both allow-listed, deBracketed first: the
   qwen display-bracket landmine), entities, significance, and up to 8
   extracted facts per item. Models via the /intel picker
   (`pickEnrichModel`, `enriched_by` stamped on success and error); Haiku
   baseline. Monday runs close with the **dossier synthesis** phase: one
   utility-model read per company over recent items + facts, merged
   monotonically into the dossier.

Budget: `checkIntelBudget` (`INTEL_DAILY_BUDGET_USD`, default 1.00) before
every billable unit; a trip ships items unenriched. Every leg failure is a
note in `intel_runs.notes`, surfaced by the /intel health panel.

## Datasets (the point)

Four key-gated, heavy datasets (`lib/datasets/registry.ts`):
**`intel-items`** (day-filterable; leading columns mirror `external-scan`
key for key, so one firewall intake ingests external-scan, signals-export,
AND intel-items; `topic_slug` carries the primary company slug, `tags` the
dimension codes), **`intel-companies`** (the entity spine with the join
keys for licensed-dataset joins on the importer's side), **`intel-facts`**,
and **`intel-metrics`**. `buildIntelHandoff` (`lib/intel/handoff.ts`)
renders the orientation doc for the firewall-side intake assistant, with
formal JSON Schemas from the shared `lib/datasets/handoff-shared.ts`.
Licensed sources (AlphaSense, S&P Capital IQ) are never ingested here:
public sources only, joined downstream by ticker/cik/rssd_id/fdic_cert/lei.

`intel-metrics` also supports incremental pulls, on top of the full-corpus
default: `?since=YYYY-MM-DD` returns rows with `fetched_at` on or after
that date, and `?source=<code>` (`edgar_xbrl`, `fdic`, `cfpb`, `y9c`, or
`ats`) returns one source's rows; the two combine. The Monday engine
stamps `fetched_at` on every refreshed row, so a weekly `?since=` pull
against a previously downloaded corpus is the intended intake once the
importer holds the initial full download.

## Source reliability tiers (0052)

`intel-items` carries the same trailing four columns as `external-scan`
(migration `0052`, shared code in `lib/scan/source-tiers.ts`):
`source_tier` and `source_kind` score the SOURCE itself, deterministically
for a known domain (suffix rules plus a curated map) or, for a domain
neither covers, rated ONCE by the utility model and cached in
`source_tiers` so nobody tends the long tail by hand. `content_kind`
scores the piece from enrichment (news, opinion, press_release, and so
on), separately discounting promotional text found inside an otherwise
reliable source. `priority` composes both with the item's `relevance`
(significance) score into one ranking number the importer can sort on.

| source tier | weight | content kind | weight |
|---|---|---|---|
| 1 (primary: regulators, primary company sources, wires, research houses) | 1.0 | news, analysis, data | 1.0 |
| 2 (majors, trade press, tech press) | 0.85 | opinion, other | 0.85 |
| 3 (general, aggregator, blog, pr_wire, unrated) | 0.6 | press_release | 0.7 |
| 4 (junk: social, promo) | 0.25 | marketing | 0.4 |

`priority = relevance × tier weight × content weight`, rounded to two
decimals. An unrated source counts as tier 3; an unclassified piece counts
as other. All four columns are null exactly when the item has not been
rated or classified yet.

## Operating it

- `/intel` is the whole surface: downloads + handoff copy, cron toggle +
  model picker + env readout, the **Tavily quota tile** (month-to-date
  actual query count across scan/pipeline/intel vs `TAVILY_MONTHLY_CAP`,
  straight-line projection, warn past 85%, hard flag on quota errors),
  run console, the registry grouped by tier (toggles, dossier refresh),
  day grid, health tiles, model A/B table, per-company yield, run history.
- Crons (`vercel.json`, Vercel Pro): weekdays 9:40, 11:40, 13:20 and 15:20
  UTC (`/sweep`, `/sweep2`, `/sweep3` stubs, path-split because Vercel keys
  crons by path; the later two were Monday-only until 2026-09-03). Monday
  runs carry the 3-day weekend window and the metrics + synthesis refresh.
- The Scout bridge: wildcard niches run as Scout discovery verticals;
  `promoteScoutCompanyToIntelAction` graduates a tracked discovery into the
  registry as a `wildcard` row.
- Watch items: Tavily quota (~1,030/mo projected across all three
  subsystems at full cadence, just over the free 1,000; the tile says when
  the paid tier is earned), CFPB name matching, FDIC certs unset (the FDIC
  leg skips those companies until the registry carries certs).
