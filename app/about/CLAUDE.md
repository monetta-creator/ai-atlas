# About pages and site metadata

Seven public About pages, in `NAV_ISLAND` order. Shared bare `about/layout.tsx`; the group's tabs come from `PageTop`. All copy is `Editable`/`Prose`; no `content_blocks` rows exist for `about.*`, so the code defaults ARE the live copy.

## Pages
- `about/page.tsx` What it is: the one-liner from `lib/brand.ts ATLAS_ONE_LINER`, a portal paragraph derived from `portalGroups()` + `DATASETS`, the story and the loop, hub cards.
- `inside`: Inside the Atlas. One section per `portalGroups()` entry in rail order: page-info summary, hand-written `PORTAL_DOES` paragraph, the portal's visible pages as chips, one screen grab from `public/showcase/<key>.png`. Then Ask and Education.
- `how-it-works`: guardrails, ingestion, retrieval under anchors `#guardrails`/`#ingestion`/`#retrieval`, plus model runs and report passages.
- `where-it-fails`: limitations, unreviewed auto-published outputs, retrieval misses, the guest name scrub, estimates.
- `data-handling`: who runs it, sources by engine, third-party processors, what goes to model providers, what is stored (incl. `ui_jobs` and report embeddings), personal data, the three access tiers, which outputs are model-written and auto-published. Every count derives from `NAV_TREE`/`portalGroups()`/`DATASETS`.
- `glossary`, `why-bespoke`.
- `architecture` is deliberately UNLISTED.
- `guardrails`, `ingestion`, `retrieval`, `limitations`, `reading-guide` are redirect stubs to the pages above.

## Truth rules
- Public copy never names the employer or a person (say "the maintainer").
- Never hard-code portal/dataset/table counts: derive from `NAV_TREE`, `portalGroups()`, `DATASETS`, or say "as of migration NNNN".
- Reader-facing text says "access key", never "team key".
- When automation changes (a new auto-publishing kind, a new search leg, a new processor), update `/about/data-handling` and the About set in the same commit.

## Screen grabs
- Capture as a GUEST (`scripts/capture-showcase.mjs`). A non-guest grab of Savant showed the key-gated issue on a public page.

## Site metadata
- `app/layout.tsx`: description = the one-liner, `metadataBase` from `APP_BASE_URL`, `openGraph` + `twitter`.
- `app/opengraph-image.tsx` / `twitter-image.tsx`: `ImageResponse` with the bundled Anton; both in `outputFileTracingIncludes`.
- `app/robots.ts`: disallows `/api/`, `/login`, `/showcase` and every `access: 'admin'` leaf as `${p}$` + `${p}/`. A bare `/data` prefix would also block `/datasets`.
- `app/sitemap.ts`: public leaves, portal hubs, About and Education.
- Each portal hub's `metadata.description` comes from `descriptionFor(pathname)` in `lib/page-info.ts`.
