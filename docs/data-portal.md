# The Datasets portal (`/datasets`)

Written 2026-08-13, at v1 ship; counts refreshed 2026-09-23. The self-service data product
over the Atlas: colleagues query the data, download structured datasets, and ask in plain
language, without accounts. The registry (`lib/datasets/registry.ts`, `DATASETS`) is the
source of truth for what exists: 24 datasets at this writing (23 plus the `catalog`
self-description), 11 of them key-gated (`keyGated: true`).

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

- Everything except Ask and the key-gated datasets is public, at the same trust level as the
  existing reader surface: guest-safe **by construction** (builders never SELECT personal
  columns; `scripts/test-datasets.mjs` enforces the ban against serialized output).
- The **access key** unlocks Ask and the 11 key-gated datasets. Since 2026-09-23 keys are
  **per person** (migration 0060): the maintainer issues a named key from `/access`
  (`atlas_<prefix>_<secret>`, HMAC-hashed at rest, shown once, 90-day expiry, renewable,
  revocable, its own daily Ask budget), colleagues request one from `/datasets/request`
  (work-email domains allow-listed in `PORTAL_REQUEST_EMAIL_DOMAINS`; the maintainer is
  emailed through Resend). A key travels as a signed `atlas_portal` cookie (30 days; the enter
  link `/datasets/enter?k=<key>` or the inline panel on `/ask` sets it) or, for scripts, as
  `Authorization: Bearer <key>` / `X-Atlas-Key` on `/api/datasets/*` and `/api/portal/*`.
  Expiry and revocation bite on the next request (`isPortal()` looks the key up); a 401 says
  why (`key_expired` / `key_revoked` / `key_required`). The legacy shared `PORTAL_KEY` still
  works during the migration and can be killed by unsetting it. Key-gated means the file
  carries retained article text, machine-extracted records including unreviewed items, agent
  scores, `rigor_prior`, dossier fields, or tracked company names: material a guest should not
  get by URL. Admins pass the gate implicitly.
- Published signals in the `signals`, `signals-by-claim`, `evidence-ledger`, and
  `articles-full-text` datasets were published by a human or, for high-significance pipeline
  drafts with a claim touch, by the 48-hour promotion policy (mig 0055).
- Budget: `PORTAL_DAILY_BUDGET_USD` (default 1.00) and `PORTAL_DAILY_MAX_CALLS` (default 200),
  both reset at midnight UTC. Over budget, Ask returns a friendly refusal and downloads keep working.

## The datasets

The original eleven (v1, 2026-08-13). The later families are the `research-export`,
`scout-companies`/`scout-events`, `external-scan`/`signals-export`, the four `intel-*`
files (`docs/intel-desk.md`), and the four `tooling-*` files (below); the registry is the
list.

| slug | what it is |
|---|---|
| `signals` | The flagship: one row per published signal with brief/counterpoint prose. `?lens=` slices. |
| `argument-nodes` | Questions, stances, claims, frames, bridge claims, flat. No confidence anywhere. |
| `argument-edges` | The wiring, uuids resolved to codes, dangling edges dropped. |
| `evidence-ledger` | Every public evidence row with direction, weight, excerpt. |
| `sources` | Publicly cited bibliography with counts and a full-text flag. |
| `articles-full-text` | Key-gated. Complete retained article text per published signal (`coalesce(sources.raw_text, signal_candidates.raw_content)`). Retained indefinitely; there is no retention job. |
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

## Query grammar (since 2026-09-23)

Every download URL accepts a filter grammar, validated against the dataset's registry columns
(unknown column, op, or enum value = 400 naming the token). Everything except the pushdowns
post-filters in JS over the builder's deterministic rows, so builder SQL never changes and no
column can be added.

| Param | Meaning |
| --- | --- |
| `where=<col>:<op>:<value>` | Repeatable, max 8. Ops by type: enum `eq ne in isnull notnull`; text/longtext adds `contains` (case-insensitive); number `eq ne gt gte lt lte in isnull notnull`; date `eq ne gt gte lt lte isnull notnull` (`YYYY-MM-DD`, ISO timestamps compare on their first 10 chars). `in` = comma list, max 20. `isnull`/`notnull` take no value. |
| `cols=a,b,c` | Projection, in the given order; CSV header and JSON `columns` follow it. |
| `sort=<col>:asc\|desc[,<col>:asc\|desc]` | Max 2; a stable tiebreak on the first column is always appended; nulls last. |
| `limit=N` | 1..50000 after where/q/sort (a top-N). `preview=N` keeps its 1..100 JSON-only meaning and wins when both are present; a preview with `where`/`q` filters the full slice, then caps. |
| `q=<text>` | Case-insensitive substring over every text, longtext, and enum column (max 200 chars). |
| `schema=1` | The JSON Schema of exactly this slice (projected columns) plus the normalized spec; no rows, no DB call. |
| `lens`, `day`, `since`, `source`, `company` | SQL pushdowns, each declared per dataset (`company=<slug>` on the three intel sets). |
| `view=<uuid>` | Apply a saved view's stored params; explicit params override; the dataset's own gate still runs first. |

Guardrails: `intel-metrics` (about 2M rows) needs `since`, `source`, or `company` before any
JS-side filter or sort; any dataset whose built rows exceed 400,000 answers 413 to a filtered
request. The JSON envelope carries `dataset.filter` (the normalized spec); a filtered filename
ends in `-filtered`. Every keyed pull is logged to `portal_usage` with the spec and the served
row count. Pure module: `lib/datasets/filter.ts` (`scripts/test-dataset-filter.mjs`).

Example: `/api/datasets/signals?where=significance:in:high,medium&cols=signal_id,title,published_on&sort=published_on:desc&limit=50&format=json`.

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
  `argument-nodes`/`argument-edges`, and `/traceroute`.
- **capability / product, engineering**: `concepts` as onboarding data, `research-papers`.
- **society / comms, brand**: the `counterpoint` column is a pre-drafted opposing read per
  development.

## Architecture (for the next model)

- `lib/datasets/{core,builders,registry,serialize}.ts` — the registry, patterned exactly on
  `lib/thesis/pack-core.ts`: injected `Q`, deterministic ORDER BY with id tiebreakers,
  guest-safe by construction, type-strippable for the Node test script.
- `app/api/datasets/[slug]/route.ts` — the download route (BOM, attachment, CDN cache for
  public sets, `no-store` for key-gated, batch streaming for heavy): gate via
  `identityFromRequest` first, then `?view=`, the pushdowns, `schema=1`, build, the
  guardrails, `applyFilterSpec`, projection, serialize; keyed pulls logged in `after()`.
- `app/api/datasets/[slug]/handoff/route.ts` — `GET` returns a generic importer orientation
  document (`text/markdown`) for any dataset, built by the pure `lib/datasets/handoff-generic.ts`
  `buildDatasetHandoff`; same gate shape as the download route. The four hand-written domain
  handoffs (`lib/scan/handoff.ts`, `lib/intel/handoff.ts`, `lib/tooling/handoff.ts`,
  `lib/research/handoff.ts`) and this generic one share their Transport-section prose
  (authentication for scripts, the query grammar, saved views, the `schema=1` hint) from
  `lib/datasets/handoff-shared.ts`, so the wording can never drift between the six.
- `lib/datasets/filter.ts` — the pure grammar (`parseFilterSpec`, `applyFilterSpec`,
  `projectColumns`, `guardFilterRequest`); `lib/datasets/cards.ts` the hub's card projection
  and filters (`components/datasets/DatasetCatalog.tsx` renders them with the `.tl-filters`
  plate, URL-mirrored).
- `lib/portal/{keys,identity,budget}.ts` — per-person keys (pure key math + the one identity
  resolver over cookie or header, the per-key budget); `lib/data/portal.ts` +
  `lib/mutations/portal.ts` back `/access`.
- `lib/auth.ts` — `verify(token, expected)` generalized; `atlas_portal` cookie; `isPortal()`
  (authoritative: resolves the key row); `checkPortalKey()` for the legacy key (fail closed).
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

## Tooling Monitor datasets

Added 2026-09-17 alongside the AI Tooling Monitor (`/tooling`, `docs/tooling-monitor.md`).
Four datasets, category `tooling`:

| slug | gating | what it is |
|---|---|---|
| `tooling-products` | key-gated, heavy | Every product with a status other than dismissed: descriptive facts, the scoring agent's advisory fit read and rubric scores, the merged dossier, and the latest deep dive. |
| `tooling-events` | key-gated | The per-product timelines: launches, funding, feature and pricing changes, partnerships, and changelog entries, on non-dismissed products. |
| `tooling-features` | key-gated | The feature matrix in long form, one row per (cataloged or parked product, normalized feature tag): the who-does-what comparison across a category. |
| `tooling-catalog` | public | The same corpus as `tooling-products`, filtered to cataloged products only, with every agent, dossier, deep-dive, status, and provenance column dropped. The one tooling file that needs no team key. |

`tooling-products` and `tooling-catalog` are full-corpus, non-incremental downloads, the same
posture as the argument-graph and Scout datasets; neither declares a `?day=`, `?since=`, or
`?lens=` filter.

`lib/tooling/handoff.ts`'s `buildToolingHandoff` renders the importer orientation doc shown on
the `/tooling/console` downloads panel: the market-monitor overview, a JSON Schema per file,
the identity rule (`id` stable, `slug` stable, `url` can change), the live category roster,
the curation-status semantics (candidate, cataloged, parked, dismissed, and how a transition
should read on re-download), intake design guidance (upsert on `id`, treat `features` as an
open tag list, never re-judge the agent's advisory fit score), and the transport steps last.
It mirrors `lib/intel/handoff.ts`'s `buildIntelHandoff` shape and shares its JSON Schema
machinery (`lib/datasets/handoff-shared.ts`'s `buildRowJsonSchema`/`envelopeJsonSchema`/
`cronLabel`).

Tests: `scripts/test-tooling-datasets.mjs` (the `scripts/test-intel-datasets.mjs` sibling):
`FIELD_FACTS` coverage for all four defs, the handoff doc's schema blocks and no-em-dash
check, gating (`tooling-products` key-gated and heavy, `tooling-catalog` not key-gated), a
determinism double-build, and a DB-backed recount proving every `tooling-catalog` row's id
resolves to `status = 'cataloged'` in `tooling_products`. Every assertion holds on an empty,
unseeded schema.
