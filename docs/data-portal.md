# The Datasets portal (`/datasets`)

> **Historical note (2026-08-22).** This document describes the AI Atlas as built before the Strategy Atlas remodel (claims/stances/bridges, audience lenses, web discovery). The machinery it explains largely survives, but object names and some subsystems changed; `transition/` is the authoritative record of what maps to what.

Written 2026-08-13, at v1 ship. The self-service data product over the Atlas: colleagues
query the data, download structured datasets, and ask in plain language, without accounts.

## What it is

Three public surfaces plus one gated feature:

- **`/datasets`** — the catalog hub: every dataset with description, schema link, CSV/JSON
  downloads, and per-lens quick slices of the signals feed.
- **`/datasets/<slug>`** — a dataset page: description, methodology, the auto-generated
  schema table (from the registry's column defs), and an in-browser explorer
  (filter, group-by with count/sum/avg, CSS-bar chart, export-this-view via the ViewData modal).
- **`/api/datasets/<slug>?format=csv|json[&lens=...]`** — the download route. CSV ships with
  a UTF-8 BOM and `Content-Disposition: attachment`; JSON is an envelope carrying the schema
  alongside the rows. Public responses CDN-cache for a few minutes.
- **`/ask`** — the team Ask surface (the one billable feature), now the full chat workspace
  in the main nav (2026-08-13, same day as v1): multi-turn, cited, streaming answers over the
  guest-safe layer plus article excerpts, with `[dataset <slug>]` suggestions rendered as
  download cards and a citation peek panel. Gated by the shared portal key; capped by a daily
  budget checked against `ai_cost_log` before every turn. `/datasets/ask` redirects here.

## Access model

- Everything except Ask and the full-text dataset is public, at the same trust level as the
  existing reader surface: guest-safe **by construction** (builders never SELECT personal
  columns; `scripts/test-datasets.mjs` enforces the ban against serialized output).
- The **portal key** (`PORTAL_KEY` env) unlocks Ask and the `articles-full-text` download via
  a signed `atlas_portal` cookie (30 days). Onboard a colleague with one link:
  `/datasets/enter?k=<key>`, or they paste the key into the inline panel on `/datasets/ask`.
  Admins pass the portal gate implicitly. Unset `PORTAL_KEY` = portal features off.
- Budget: `PORTAL_DAILY_BUDGET_USD` (default 1.00) and `PORTAL_DAILY_MAX_CALLS` (default 200),
  both reset at midnight UTC. Over budget, Ask returns a friendly refusal and downloads keep working.

## The 11 datasets

| slug | what it is |
|---|---|
| `signals` | The flagship: one row per published signal with brief/counterpoint prose. `?lens=` slices. |
| `argument-nodes` | Questions, stances, claims, frames, bridge claims, flat. No confidence anywhere. |
| `argument-edges` | The wiring, uuids resolved to codes, dangling edges dropped. |
| `evidence-ledger` | Every public evidence row with direction, weight, excerpt. |
| `sources` | Publicly cited bibliography with counts and a full-text flag. |
| `articles-full-text` | Key-gated. Complete retained article text per published signal (`coalesce(sources.raw_text, signal_candidates.raw_content)`). |
| `concepts` | The terminology DAG with prerequisites and confirmed claim links. |
| `signals-by-claim` | The touch matrix in long form with directions; the direction-balance dataset. |
| `thesis-reports` | The standing-hypothesis scoreboard off the frozen packs. |
| `research-papers` | The kept arXiv shortlist; claim touches advisory only. |
| `catalog` | The registry itself as data: one row per column, with type and definition. |

Full text note: `sources.raw_text` covers only manual ingests (~17 rows); pipeline article
text lives on `signal_candidates.raw_content` and `ensureSource` never copies it over, which
is why the articles dataset coalesces across both through published signals.

Copyright framing (also in the dataset's methodology): the full text is an internal working
corpus for research, provenance, and quotation. Not a redistribution channel; link to the
original source when sharing outward.

## Where the value is (lens to team)

The differentiated asset is the pre-built linkage development -> lens -> claim -> direction ->
evidence -> counterpoint, with citations. Per team:

- **market / strategy, finance**: thesis scoreboards (`thesis-reports`), capex-thesis direction
  balance (`signals-by-claim`).
- **labor / HR, workforce planning**: direction balance on displacement claims
  (`signals-by-claim` filtered to labor claims, `evidence-ledger` excerpts).
- **regulatory / legal, compliance**: `signals?lens=regulatory` timeline plus
  `articles-full-text` for primary language.
- **geopolitics / supply chain, gov affairs**: lens slice plus bridge claims in
  `argument-nodes`/`argument-edges`, and `/supply-chain`.
- **capability / product, engineering**: `concepts` as onboarding data, `research-papers`.
- **society / comms, brand**: the `counterpoint` column is a pre-drafted opposing read per
  development.

## Architecture (for the next model)

- `lib/datasets/{core,builders,registry,serialize}.ts` — the registry, patterned exactly on
  `lib/thesis/pack-core.ts`: injected `Q`, deterministic ORDER BY with id tiebreakers,
  guest-safe by construction, type-strippable for the Node test script.
- `app/api/datasets/[slug]/route.ts` — the download route (BOM, attachment, CDN cache,
  in-route `isPortal()` for key-gated, batch streaming for heavy).
- `lib/auth.ts` — `verify(token, expected)` generalized; `atlas_portal` cookie; `isPortal()`;
  `checkPortalKey()` (fail closed).
- `lib/portal/budget.ts` — the daily spend/call check over `ai_cost_log`.
- `lib/ask/retrieve.ts` — `buildAskContext(query, { mode: 'admin' | 'portal' })`; portal mode
  nulls personal columns in SQL and restricts signals to published; both modes get the
  article-excerpt leg over the 0029 tsvectors (`ts_headline`, published-signal scoped).
- `lib/ask/prompt.ts` — `PORTAL_SYSTEM` + `portalSkeletonBlock` (adds the DATASETS list and
  the `[dataset <slug>]` suggestion grammar; verified client-side like citations).
- `app/api/portal/ask/route.ts` — /api/ask's envelope with the four portal diffs
  (gate, budget, mode, feature slug `portal_ask`).
- `components/datasets/*` — `DatasetExplorer` (client, fetches its own JSON endpoint),
  `DatasetSchemaTable`, `PortalUnlock`, `AskDatasetCard`. `AskAtlas` gained the optional
  `datasets` prop for suggestion verification.
- Migration `0029_portal_fts.sql` — tsvectors + GIN over `sources.raw_text` and
  `signal_candidates.raw_content` (partial: `signal_id is not null`).
- Tests: `scripts/test-datasets.mjs` (guest-safety, determinism, shape, house style,
  registry integrity).

Deferred by design (see `docs/data-portal-upgrade-paths.md`): in-browser SQL via DuckDB-WASM
(v2), server-side SQL role, drag-and-drop BI, embeddings, multi-user auth.
