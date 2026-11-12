# Intel Desk and company intel deck

Company intelligence: a registry of tracked companies swept daily by a checkpointed engine, plus a weekday 16:9 deck of what each did. Console `intel/page.tsx` (admin, `adminGate`, `maxDuration = 60`). Everything that names tracked companies is keyholder (portal) + admin only; guests never see it.
Full write-up: docs/intel-desk.md

## Intel Desk: registry and engine (mig `0043`)
- Registry tiers: self / card_issuer / consumer_bank / fintech / tech_platform / wildcard. Real registry seeds from the untracked `private/intel-companies.json` via `db:seed:intel`.
- Engine `lib/intel/engine.ts` (scan pattern): feeds, Tavily search on a 3-day company ring, SEC EDGAR filings (+ Monday metrics: EDGAR XBRL / FDIC / CFPB, LLM-free), hydrate, cheap-model enrich with structured fact extraction into `intel_facts`. Monday runs close with a per-company dossier synthesis via Scout's `mergeDossier`.
- Company linkage + dimension tags are allow-listed (deBracketed first).
- Budget: `INTEL_DAILY_BUDGET_USD`.
- Driver: `/api/cron/intel` plus `/sweep`, `/sweep2`, `/sweep3` at 09:40 / 11:40 / 13:20 / 15:20 UTC, weekdays.
- Late feed sweep: `/api/cron/feeds` weekdays 20:30 UTC (`lib/feeds/late-sweep.ts`) reopens the day's completed run at step `feeds`, re-pulls RSS/Atom feeds (no Tavily), lets the engine hydrate + enrich the new items under the same daily budget, noted in run notes.
- Scout bridge: `promoteScoutCompanyToIntelAction` graduates a tracked discovery into the registry.
- Tavily quota, breaker and `?rerun=` facts: see `lib/scan/CLAUDE.md`.

## Datasets and access
- Output ships ONLY as four key-gated datasets: `intel-items` (mirrors `external-scan`'s leading columns key for key, incl. the `0052` trailing `source_tier`/`source_kind`/`content_kind`/`priority` quartet), `intel-companies`, `intel-facts`, `intel-metrics`.
- `intel-metrics` takes `?since=` and `?source=` for incremental pulls.
- Orientation doc: `buildIntelHandoff` in `lib/intel/handoff.ts`; shared schema machinery in `lib/datasets/handoff-shared.ts`.
- Console: downloads + handoff, cron toggle + model picker, Tavily quota tile (`getTavilyQuota`: month-to-date query count across scan/pipeline/intel vs `TAVILY_MONTHLY_CAP`, warn past 85%), tier-grouped registry (toggles, dossier refresh), day grid, health tiles, model A/B, per-company yield, run history.

## Company intel deck (migs `0061`-`0063`)
Routes under `intel/deck/*`. A weekday deck of what each tracked company (every tier except `self`) did since the previous press time. Access-key holders and admin only.
- `lib/intel/deck-pack.ts` `buildIntelDeckPack(day)` reads the 16:20 to 16:20 UTC window (`windowFor(day, INTEL_DECK_PRESS_UTC)`, Monday back to Friday): items (max 6; filings = `discovered_via 'edgar'` / `doc_type 'filing'`), facts (max 6), metric rows fetched in the window with previous period's delta.
- Score: Σ significance + 0.5/fact + 1.0/filing + 1.5/metric. Movers = top 3. Quiet = active companies with nothing.
- Logos baked once as PNG data URIs (`lib/logo-fetch.ts`, max 12KB, 4s, 6-way). `lib/logo.ts` + `components/EntityLogo.tsx` are the shared favicon/monogram pair; `ProductLogo` delegates.
- `lib/intel/deck-generate.ts` is the ONE model leg: feature `intel_deck_sentence`, `intel_prefs.deck_model` default `claude-haiku-4-5`, 12 companies per call in parallel via `Promise.allSettled`. One markdown sentence per company (max 240 chars) + a front.
- Citation gate: each sentence passes `enforceCitations` against that company's own item/fact/filing urls. The allow-list MUST map href to href in `tagByHref`: it is the only way the gate counts a link as cited. A sentence with no surviving link is dropped; a failed batch loses only its sentences.
- Past `INTEL_DECK_DAILY_BUDGET_USD` (0.10) the deck publishes deterministic.
- `lib/intel/deck-run.ts` `runIntelDeck(day)` saves `generated_reports` kind `intel_deck` (auto-published; 23505 = skipped).
- `lib/intel/deck-pure.ts` `buildIntelDeck`: title, stat-grid, movers bullets, one `company` slide each (the one new `DeckSlide` kind, rendered in `components/costs-deck/slides.tsx` and `lib/pdf/costs-deck.tsx`), quiet bullets, divider.
- Routes: `/intel/deck` (redirect to latest or `/intel/deck/none`), `/intel/deck/[day]` (chromeless `DeckController`; guests see a "Keyholders only" plate linking `/datasets/request`), `/intel/deck/[day]/pdf` (404 for guests; in `next.config.ts` `outputFileTracingIncludes`).
- `/reports` hides the card in SQL for guests (`PORTAL_ONLY_KINDS` in `lib/reports/access.ts`, `listGeneratedReports({ portal })`); sheet routes 404 it; nav leaf `Intel deck` under Report Portal is `access: 'portal'`.
- Cron `/api/cron/intel-deck` 16:20 UTC weekdays (`?day=` backfills). Agent check `reports.intel_deck_missing` + propose remedy `reports.intel_deck`.

## Landmines
- react-pdf: the deck PDF body is a fixed 296pt clipped two-column block because `flex: 1` inside the content-sized page body measures 0 tall.
- `enforceCitations` with an empty `tagByHref` drops every sentence (the first live deck lost all 24).

## Tests
- `scripts/test-intel-deck.mjs`.
