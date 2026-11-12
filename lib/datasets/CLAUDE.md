# Data Portal datasets

The dataset catalog, download route, query grammar and query builder. Some datasets are public, key-gated ones need a keyholder (portal) or admin. Keys, identity, saved views and the NL query are covered in `lib/portal/CLAUDE.md`.

Full write-up: docs/data-portal.md

## Pages and routes
- `datasets/page.tsx`: catalog hub, `components/datasets/DatasetCatalog.tsx` (client) over pure `lib/datasets/cards.ts`.
- `datasets/[slug]/page.tsx`: dataset page with an auto-generated schema table from the `lib/datasets/registry.ts` column defs, methodology, downloads, and the query builder. Key-gated `articles-full-text` previews only for portal holders.
- `datasets/ask/page.tsx`: redirect to `/ask`.
- `datasets/enter/route.ts`: one-link onboarding.
- `app/api/datasets/[slug]/route.ts`: CSV/JSON download. UTF-8 BOM, `Content-Disposition: attachment`, CDN cache for public datasets, in-route identity gate for key-gated ones, a `portal_usage` row per keyed pull written in `after()`.
- `GET /api/datasets/[slug]/handoff`: per-dataset orientation doc (pure `lib/datasets/handoff-generic.ts`), key-gated like its dataset.
- Proxy allow-list lives in `lib/route-shapes.ts` (`PUBLIC_API_PATHS` + `PUBLIC_API_PREFIXES`: `/api/datasets/`, `/api/portal/`, `/api/cron/`, ...).

## Catalog hub
- The `.tl-filters` plate: search over title/description/slug/column keys, Access, Category, Clear all. Count line, category kickers when filtered.
- Locked key-gated cards show Schema / Query / Unlock / Request access. Never a CSV/JSON button that would 401.
- URL-mirrored via `replaceState`. Test: `scripts/test-dataset-cards.mjs`.

## Query grammar
- Lives in pure `lib/datasets/filter.ts`: `parseFilterSpec`, `applyFilterSpec`, `projectColumns`, `guardFilterRequest`. Test: `scripts/test-dataset-filter.mjs`.
- `where=<col>:<op>:<value>`: max 8, ops by column type, enum values validated against `DatasetColumn.values ?? FIELD_FACTS`, `in` lists of 20, values capped at 200 chars, `isnull`/`notnull` take no value.
- `cols=`: projection. CSV header and JSON `columns` follow it.
- `sort=`: 2 keys + a stable first-column tiebreak, nulls last.
- `limit=`: 1..50000, applied after filter/sort.
- `q=`: over text/longtext/enum columns.
- `schema=1`: the slice's JSON Schema, no DB call.
- SQL pushdowns: `lens|day|since|source|company`. `company=<slug>` is for the three intel sets only.
- `view=<uuid>`: a saved view's stored params merged UNDER the explicit params. The gate runs first, so a view never widens a dataset. Never put `view=` in PUBLIC_CACHE.
- Everything but the pushdowns post-filters in JS over the builders' deterministic rows. Builder SQL never changes and no column can be added.

## Guardrails
- `intel-metrics` needs `since|source|company` before any JS-side filter or sort.
- 413 past 400,000 built rows on a filtered request.
- `preview=N` with `where`/`q` filters the full slice, then caps.
- A filtered filename ends `-filtered`. The JSON envelope carries `dataset.filter`.
- Keyed pulls log the spec and the SERVED row count.
- Heavy JSON downloads stream (`streamString`, surrogate-safe slices): Vercel refuses a buffered response over 4.5 MB.

## Query builder
- `components/datasets/QueryBuilder.tsx` (client) on every dataset page, over pure `lib/datasets/query-url.ts`: `BuilderState` <-> URL, `hrefs`, `describeState`, `requiresNarrowing`.
- Controls: filter rows, declared pushdowns, column checkboxes, sort, limit, search, then Preview (25 rows, only on click, AbortController) / Download CSV / Download JSON / Copy URL / Schema / Reset.
- Enum values are resolved SERVER-SIDE on the page (`col.values ?? fieldEnumValues`) so the client never imports the registry.
- A locked viewer on a key-gated set gets Unlock / Request access links and a disabled Preview.
- Test: `scripts/test-query-url.mjs` round-trips every op through the real `parseFilterSpec`.

## Handoffs
- Every importer handoff's Transport section documents header auth, the grammar, `company=`, `view=`, `schema=1`, and the 401 states.
- Shared schema machinery: `lib/datasets/handoff-shared.ts`.

## Landmines
- `FIELD_FACTS` in `lib/datasets/handoff-shared.ts` is keyed by column NAME across every dataset. Two datasets sharing a column name with different enums collide (`concepts.status` settled|contested vs tooling's status). Declare the override on the column, e.g. `col('status', ..., ['settled', 'contested'])`, never widen the shared enum.
- Never add a public API route without a gate marker or an EXEMPT entry. `scripts/test-api-gates.mjs` walks `app/api/**/route.ts` and fails on any route without one (markers: `isAdmin(` / `cronGate(` / `identityFromRequest(` / `getPortalIdentity(` / `isPortal(`).
- `listGeneratedReports(publishedOnly, { portal })` is the one report-visibility rule.
