# Daily Edition (/blotter)

A public AI newspaper written every weekday from what the engines already stored, never from a new search. Pages: `/blotter` (latest, `EditionView`), `/blotter/[day]`, `/blotter/archive` (rows carry a PDF button), `/blotter/desk` (redirect stub to `/savant/desk`).

## Files
- `lib/edition/pack.ts` `buildEditionPack(day)`: the one DB reader.
- `lib/edition/pure.ts`: DB-free helpers so plain-Node tests can load them: `windowFor`, `allowlistForEdition`, `deterministicFront`, `validateFrontItems`, `thingsHappenFor`, `penalizeRepeats`.
- `lib/edition/cluster.ts`: groups items into stories; `sameStory`, `stripOutletSuffix`.
- `lib/edition/generate.ts`: the two GLM legs (`generateFront`, column).
- `lib/edition/desks.ts`: `isAiStory`, `deskFor`, `groupByDesk`, `industryFor`.
- `lib/edition/builders.ts` `judgeBuilderReads` + pure `builders-core.ts` (`pickBuilderCandidates`, `catalogHrefFor`, `DEFAULT_BUILDERS_STEERING`).
- `lib/edition/research-weight.ts` `paperWeight`.
- `lib/edition/hn.ts` (Algolia HN), `lib/edition/markets.ts` (market basket).
- `lib/edition/paper.ts` `buildEditionPaper` (pure view model) → `lib/pdf/edition-paper.tsx` `renderEditionPaperPdf`.
- `lib/edition/deck.ts`: 16:9 deck.
- `getRecentEditions`, `cleanBlindSpots`, `rateDomainByRule`, `urlForms`, `enforceCitations` are used from here.
- Styles `.ed-*` in `app/styles/edition.css`.

## Data window
- Window: `windowFor`, 16:45 UTC to 16:45 UTC, Monday back to Friday's. Reads since the previous press time.
- `scan_items` + `intel_items`: relevance/significance >= 0.55, tier <= 3, not marketing.
- Approved `signal_candidates`.
- Published `signals` windowed on `first_published_at` (mig `0059`, stamped once by every publishing writer, never moved). Don't window on `published_at` (the editorial date): a draft published days after its article would miss the paper.
- `papers`: engine-analyzed only (`triage_status = 'kept'` with non-null `extraction`, never `review_status = 'dismissed'`), human-confirmed tracked/noted first, limit 8. Don't use a same-day tracked/noted predicate: human review lands days after analysis and it read 0 every edition. Strip label is "Papers analyzed".
- Monday's new tooling entrants, the latest run's coverage misses, `intel_facts` by company (window = the engines' day, Monday covers the weekend; pipeline rows on the 06:00 UTC day).
- Pipeline/signal items get a tier from `rateDomainByRule` + `source_tiers` at pack build.
- Origin `backfill` signals are excluded (a published 2023 story must never lead today).
- `pack.companies` no longer exists; intel-registry company names in public rows are never rendered.
- Free strips fetched at build time (no cron, no table): HN front page filtered to AI; market basket NVDA, MSFT, GOOGL, META, AMZN, TSM, SOXX, XLU via Yahoo's keyless chart endpoint (unofficial feed). The market strip is omitted when fewer than 4 symbols answer.

## Ranking and clustering
- Score = relevance × log(coverage) × tier × content kind × AI weight. AI weight: items whose text names no AI term score 0.45, lens-sourced items always 1.
- `sameStory` also merges one shared entity + Jaccard >= 0.25 after stripping trailing outlet suffixes (`stripOutletSuffix`).
- Repeat guard: `penalizeRepeats` over the previous two editions' fronts: a cluster sharing a URL or a headline with Jaccard >= 0.4 gets `repeat: true` and score × 0.35. `generateFront` drops repeats from candidates and the prompt lists the recent fronts.
- The front prefers a cluster's `/signals/<id>` href over the external URL.
- `coverageLine` is empty for a lone plain outlet ("Corroborated by N outlets" from 2).
- `numbers.clusters` counts AI clusters before the 40 cap (label "AI stories"); `papersKept` is a real count.
- Blind spots always run through `cleanBlindSpots` (GDELT titles like "Fortune" or an earnings-call transcript never reach the page).

## Model legs
- Features `edition_front` / `edition_column`, GLM, `EDITION_DAILY_BUDGET_USD` 0.10.
- Front: Axios-style, 4-8 items (headline, why it matters, by the numbers, a go-deeper href that must be in the cluster's allow-list).
- Column: Levine-style, ties the day to claims (`claimsTouched`; filled with the claims that gained the most evidence in 30 days when the board is quiet).
- Column prompt: writes for a general reader (positions argued as the columnist's own reasoning, links on natural phrases, never the words claim/confidence/argument map or a code); gets the previous two columns' titles and heads plus a Monday/Friday brief. Every front story it discusses must link its source on first mention (advisory gate 3 in `dropped`); the closing line is never labeled.
- Citation-gated by `allowlistForEdition` + `enforceCitations` at save and render. The allow-list admits the query-stripped twin of a stored URL (`urlForms`) because the model drops `?amp=1`-style parameters.
- A failed model leg falls back to the deterministic front / no column and is recorded in `narrative.dropped`.
- Builders leg: feature `edition_builders`, one GLM call over `pickBuilderCandidates` judged for an AI builders pod inside a large regulated company; tags tooling/patterns/agents/evals/security/infra/field with a one-line why. `edition_prefs.builders_steering` (mig `0067`, null = `DEFAULT_BUILDERS_STEERING`) steers it. No-model fallback is the top-8 HN strip; `pack.hn` (8) is kept for the deck.
- Vendor releases in the builders section: `tooling_events` of kind launch/feature/pricing/changelog on cataloged products, never `note`. Chips Show HN / repo / debate and an `in the catalog` link via `catalogHrefFor`.

## Saving
- `generated_reports` kind `'edition'` (mig `0057`; the third auto-publishing kind; `edition_prefs` singleton).
- One per `scope_to` day, enforced by the `0058` partial unique index: an overlapping cron + manual run reports the second insert as skipped.
- Skipped on quiet days (< 3 clusters).
- Refresh in place: `npx -y tsx scripts/refresh-edition.mts <day> --sections=column,builders,research [--dry-run]` → `rewriteEditionColumn` and `rewriteEditionPackSections` (additive `builders`/`papers`/`papersKept`) in `lib/mutations/reports.ts`. These are the only mutable pieces beside `is_published`; front, clusters, Things happen and other numbers stay frozen.

## Page layout (`EditionView`)
- Masthead, numbers strip, market strip with sparklines, front + column.
- Things happen: AI-only one-line briefs grouped by desk. `isAiStory` is the gate; desks are Labs & models / Chips & infrastructure / Policy & regulation / Banks & payments / Work & labor / Deals & markets / Research & evidence. Policy is checked before research (an executive order that "directs a study" is policy). `groupByDesk` puts the biggest desk first. Desks are stamped at pack build and recomputed from the headline for older rows.
- The industry (`industryFor`): strongest non-AI financial-services stories, tier 1-2, because the front is AI-only.
- Research full width: each paper shows a quiet weight (three dots: human-confirmed / reaches a position or thread / model-proposed rigor high); dek is `headline_claim`; mono kicker like `TRACKED · BEARS ON 2 · RIGOR HIGH · CONTRADICTS`.
- What builders are reading, a prominent Sources block with the outlet count, Tools, Blind spots.

## Access & guest safety
- Public page. `paperWeight` is guest-safe by construction: it shows the rigor BAND of the model's proposed score, never the number, never `rigor_prior`.

## PDFs
- `/blotter/[day]/pdf`: newspaper PDF, US Letter, narrow margins, 2-3 dense pages, every link clickable, online edition linked from the masthead.
- One flowing `<Page size="LETTER">` whose small `wrap={false}` blocks paginate by content.
- The column is two balanced text columns kept whole (`wrap={false}`): it moves to the next page rather than splitting, since a split read as a mid-sentence jump. Things happen is one whole block of three balanced desk columns.
- Section order is chosen for packing: front, research, column, builders, Things happen, sources. Two whole blocks adjacent gives 4 pages instead of 3.
- Unwrap `<code>` first: the shell sets it in JetBrains and the fontkit ligature crash applies.
- `/blotter/[day]/deck/pdf`: the 16:9 deck, secondary, behind the smaller "Deck" button.
- Both PDF routes must stay in `next.config.ts` `outputFileTracingIncludes`.
- `scripts/render-edition-paper.mts` renders stored days locally.

## Cron
- `/api/cron/edition` weekdays 16:45 UTC; `?day=` backfills.
- The scheduled call replaces an edition built before that day's press time (a manual morning run is a preview and the 12:45 ET paper still lands). A named-day backfill or a second manual run never clobbers an existing edition.
- The 20:30 UTC `/api/cron/feeds` late sweep lands in the next morning's paper.

## Tests
- `scripts/test-edition.mjs`, `scripts/test-edition-pack.mjs`, `scripts/test-edition-deck.mjs`, `scripts/test-edition-paper.mjs`.
- `scripts/replay-edition-clusters.mts` replays clustering over stored days.
