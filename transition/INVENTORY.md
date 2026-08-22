# Kill / keep / mutate inventory

Produced 2026-08-22 by a full-codebase sweep (58,388 LOC across `app/ lib/ components/
scripts/ supabase/`). This is the checklist the strip is executed against. Verdicts:
**KILL** (delete), **KEEP** (untouched or trivial edits), **MUTATE** (survives with
surgery; the note says what changes). Read §0 and §7 before cutting anything.

## 0. Orienting facts

**"Stance" means two unrelated things.** A naive grep-strip destroys working code:
1. The `stances` TABLE (candidate answers under a question, codes like `Q1-S1A`). This
   is what dies.
2. The signal-direction rollup: `stanceOf()` in `lib/thesis/pack-core.ts:70`,
   `ThesisPackSignal.stance`, `pack.stats.stances` (`supports|contradicts|mixed|...`).
   Nothing to do with the table. **KEEPS**, and the JSON key is frozen inside existing
   `thesis_reports.pack` / `generated_reports.pack` rows, so renaming it to `direction`
   needs a data migration or read-time shim. Callers: `lib/data/desk.ts`
   (`getLatestThesisReports`), `lib/tearsheet/pack-core.ts:535`.

**The webless intake spine already exists.** Migration `0015` added
`run_cadence_t='source'` + `signal_candidates.source_id` so a manual source runs the
triage→analyze→draft funnel as a pre-approved candidate. The door is
`prepareSignalFromSourceAction` (`lib/actions/signals.ts:190`). This spine is the KEEP
around which the pipeline strip is performed.

## 1. Routes (`app/`)

### Argument-map core
| Route | Verdict |
|---|---|
| `page.tsx` (Lobby) | MUTATE: drop Scout tile (`components/portal-icons.tsx` `PORTALS`), drop scout from `getNavCounts` |
| `map/page.tsx` | MUTATE: becomes the hypotheses map; bridge refs throughout |
| `q/[slug]/page.tsx` | KILL with the question tier (D-013); its claim-list duties move to the hypothesis surfaces. 9 stance + 5 bridge refs, imports `StanceCard`/`QuestionMap`/`BridgeBand` |
| `q/[slug]/summary/page.tsx` | KILL with questions (`lib/summary.ts` narrates stances) |
| `q/[slug]/claim/new/page.tsx` | MUTATE: re-home claim/hypothesis authoring off the question path; stance-edge picker dies |
| `claim/[code]/page.tsx` | MUTATE → becomes the hypothesis detail page (D-016): its evidence/test/rationale structure survives, re-targeted |
| `bridge/[code]/page.tsx`, `bridge/new/page.tsx`, `bridges/page.tsx` | KILL |
| `worldview/page.tsx` | MUTATE: `getNodeOptions()` returns `{stances, claims, bridges}` |
| `data/page.tsx` | MUTATE: 8 stance + 7 bridge refs |
| `calibration/page.tsx` | MUTATE: `getCalibration()` buckets claims/stances/bridge_claims/positions |

### Theses → hypotheses (rename cluster)
`theses/page.tsx`, `theses/new`, `theses/[id]`, `thesis-report/[id]` (+ `pdf/route.ts`,
via `lib/pdf/thesis-doc.tsx`, 5 stance refs): all MUTATE → `/hypotheses`.

### Signals / pipeline
| Route | Verdict |
|---|---|
| `signals/page.tsx`, `signals/drafts`, `signals/digest` | KEEP |
| `signals/[id]`, `signals/[id]/edit`, `signals/new` | MUTATE: bridge codes in touch rendering/picker |
| `pipeline/page.tsx` | MUTATE (heavy): discovery/sweep/coverage orchestration dies; triage/analyze/draft UI + candidate list stay |
| `blotter/page.tsx` | MUTATE: `PipelineAnalytics` charts assume the discovery funnel + coverage |
| `ingest/page.tsx` | KEEP — becomes the primary intake |
| `sources/page.tsx`, `source/[id]/page.tsx` | MUTATE (bridge refs on detail) |

### Scout
`scout/page.tsx`, `scout/[id]`, `scout/console`: KILL.

### Research
| Route | Verdict |
|---|---|
| `research/page.tsx`, `research/console` | MUTATE/KILL per OQ-6 — the intake is arXiv |
| `research/[id]` | MUTATE: hosts the arXiv iframe (`PaperReader`) which must go |
| `research/threads/[slug]`, `research/digest` | KEEP (non-web) |

### Reports / portal / misc
| Route | Verdict |
|---|---|
| `reports/page.tsx`, `reports/sheet/[id]` (+pdf) | MUTATE: `report_kind_t` drops `'bridge'` |
| `reports/[id]` (+pdf), `reports/period` | KEEP |
| `costs`, `tickets`, `login`, `share/route.ts` | KEEP |
| `ask/page.tsx` + `ask/actions.ts` | MUTATE: retrieval legs (§2d) |
| `concepts/*` (4 routes) | MUTATE per OQ-9: `concept_claims.target_type` admits `bridge_claim` |
| `datasets/*` (5 routes) | MUTATE: drop scout datasets; drop bridge rows from argument-nodes/edges datasets |
| `traceroute/page.tsx` | fully offline as-built (`three` + `gpt-tokenizer` bundled); fate is OQ-10 (product call, not a network problem) |
| Redirect stubs (`landscape`, `lens`, `supply-chain`, `report`, `about/reading-guide`) | KILL (nothing inside links them) |
| `showcase/page.tsx` | MUTATE: 2 stance refs; screenshots stale post-strip |
| `about/*` (6 pages) | MUTATE: all describe stances/bridges/scout AND Vercel+Supabase (`about/architecture/page.tsx:103`) |
| `layout.tsx` | MUTATE: `next/font/google` (§5E — build-breaker offline) |
| `app/styles/*` | KEEP; 5 sheets carry `.stance`/`.bridge` classes to prune |

### API routes
| Route | Verdict |
|---|---|
| `api/ask/route.ts` | MUTATE: remove `web_search_20250305` toggle + `collectWebSources` |
| `api/ask/deep/route.ts` | MUTATE: remove web leg; re-tune `DEADLINE_MS` for on-prem |
| `api/ask/verify`, `api/ask/peek` | MUTATE: stance/bridge kinds in `PeekKind`/`CitationKind` |
| `api/ask/doc`, `api/signals/[id]/ask`, `api/tickets/*`, `api/traceroute/tokenize` | KEEP |
| `api/portal/ask` | MUTATE: web toggle out |
| `api/datasets/[slug]` | MUTATE: drop scout slugs |
| `api/probe/duration` | KILL (Vercel ceiling probe, reads `VERCEL_REGION`) |

## 2. Lib

### 2a. `lib/pipeline/` — the discovery leg
| Module | Verdict |
|---|---|
| `discovery.ts`, `coverage.ts`, `config.ts` | KILL entirely (plan/batches/sweep, coverage check, lens queries + blocked-domains + `resolveDateTokens`) |
| `triage.ts` | KEEP (imports only `normalizeUrl` from web.ts) |
| `analysis.ts` | MUTATE: remove the `fetchCandidateText` backstop at `:87`; require `cand.raw_content` |
| `dedupe.ts` | KEEP |
| `web.ts` | SPLIT then delete — see below |

**`web.ts` split.** DIES: `searchCandidates`, `searchBreakingSweep`,
`assertPublicHttpUrl`, `looksLikePdf`, `fetchReadableText`, `fetchViaJina`,
`fetchCandidateText`, `inferPublishedDate`, the fetch constants; `extractReadable`
mostly dies but its `unpdf` branch is worth salvaging for server-side file intake.
STAYS, re-homed (e.g. new `lib/text.ts`) BEFORE the file is deleted:
- `sanitizeText` (:313) — NUL/surrogate stripping before any DB write; ~30 call sites
  via `lib/mutations/{pipeline,research,scout}.ts`. Deleting it un-re-homed
  reintroduces the `invalid byte sequence 0x00` run-killer.
- `domainOf` (:23), `normalizeUrl` (:46), `MIN_READABLE_CHARS` (:321),
  `FetchFailure` (:299) (survives as an error type or collapses to Error),
  `RawCandidate` (type).
- Consolidation target: `lib/pack-shared.ts` has an independent `domainOfUrl()`.

### 2b. `lib/scout/` — KILL wholesale
All 8 modules; plus `lib/actions/scout.ts`, `lib/data/scout.ts`,
`lib/mutations/scout.ts`, `lib/types/scout.ts`. Each of the four barrels
(`lib/{actions,data,mutations,types}/index.ts`) has an `export * from './scout'` to
remove. Also: `lib/format.ts:210-246` (company/scout labels),
`lib/portal/budget.ts:16` (`'portal_scout'`), `lib/datasets/core.ts:30` (`'scout'`
category), registry slugs `scout-companies`/`scout-events` + their builders,
`getNavCounts` scout count.

### 2c. `lib/research/`
| Module | Verdict |
|---|---|
| `arxiv.ts`, `pull.ts`, `citations.ts` | KILL (arXiv Atom API, Semantic Scholar) |
| `analysis.ts` | MUTATE (heavy): `hydratePaper` fetches arxiv.org (:46, :52) and `p.url` (:57) — dies; `analyzePaper` (non-web) survives if text arrives by upload |
| `triage.ts`, `synthesis.ts`, `thread-scan.ts`, `queue-agent.ts` | KEEP (non-web; bridge refs to prune) |
| `lib/actions/research.ts` | MUTATE: drives the pull/citation legs |

### 2d. `lib/ask/`
| Module | Verdict |
|---|---|
| `retrieve.ts` (687 L; 16 stance / 33 bridge refs) | MUTATE (heavy): `loadNamespace()` 6-way query incl. stances/bridges + prompt skeleton sections; `detectIds()` matches `\bB\d+\b`; delete `ftsStances`/`ftsBridges` legs, keep claims/concepts/signals/threads/papers/evidence/articles legs |
| `search.ts` | MUTATE: `PeekKind` union; `evidenceFor(..., 'claim'|'bridge_claim', ...)` |
| `deep.ts` | MUTATE: `SEARCH_KINDS`/`FETCH_KINDS` arrays; tool descriptions name stances/bridges; `renderRecord` stance branch |
| `prompt.ts` | MUTATE: citation-grammar examples `[bridge B1]`/`[stance Q1-S1A]`; delete `SCOPE_RECORDS_PLUS_WEB` |
| `verify.ts` | MUTATE: `CitationKind`, `ValidIds.bridges/.stances`, token classifier (`^B\d+$` → bridge). Left in place, the verifier accepts citations to records that no longer exist |
| `history.ts` | MUTATE: web-citation filtering (:231) |

### 2e. Report cores
| Module | Verdict |
|---|---|
| `lib/thesis/pack-core.ts` | MUTATE: its 13 "stance" refs are the DIRECTION ROLLUP (keep, §0); 6 bridge-namespace refs die |
| `lib/thesis/{map,gaps,generate,citations,retrieve}.ts` | MUTATE (claim/bridge namespace) |
| `lib/tearsheet/pack-core.ts` (619 L; 19 stance / 36 bridge refs) | MUTATE (heavy): `:197-212` joins edges→stances; `:479-568` `buildAtlasSheet` rolls evidence up claim→stance. The whole-Atlas sheet is a redesign against hypotheses, not a find/replace (`AtlasSheetQuestion`/`AtlasSheetStance` types) |
| `lib/tearsheet/{generate,retrieve}.ts` | MUTATE |
| `lib/pack-shared.ts`, `lib/citations.ts` | KEEP |

### 2f. Remaining lib
| Module | Verdict |
|---|---|
| `lib/db.ts` | MUTATE: drop `SUPABASE_DB_*` fallback + pooler shape; plain `DATABASE_URL`, proper TLS option, sane default pool |
| `lib/auth.ts` | KEEP |
| `lib/cost.ts` | MUTATE: drop `web_search_requests` pricing (:78, :105, :120) |
| `lib/dossier.ts` | MUTATE: inject configurable `baseURL` into the two `new Anthropic()` sites (:137, :244); add the no-key fail-soft |
| `lib/data/map.ts` (719 L; 49 stance / 75 bridge refs) | MUTATE (heavy) — the most entangled file: `getQuestions/getQuestion/getClaim/getBridge/getBridges/getTargets/getCalibration/getEvidenceGraph/getNodeOptions/getWorldview/...` |
| `lib/data/shared.ts` | MUTATE: `getEvidenceFor(targetType: 'claim'|'bridge_claim')` |
| `lib/data/pipeline.ts` | MUTATE: kill `getZeroYieldDomains` + `isFetchHostileDomain` (the learning loop); keep run/candidate reads |
| `lib/actions/pipeline.ts` | MUTATE: KILL `discoverBatchAction`, `discoverBreakingSweepAction`, `coverageCheckAction`, `hydrateCandidateAction`; KEEP triage/analyze/override/archive/complete/dedupe actions; `startPipelineRunAction` drops the batch plan |
| `lib/actions/signals.ts` | MUTATE: KILL `refetchMissingTextAction` + `retainTextFor` (web fetch); **`publishSignalAction:120` silently web-fetches via the retained-text guard — remove or every publish eats a 20s doomed timeout on-prem**; KEEP `prepareSignalFromSourceAction` |
| `lib/actions/nodes.ts` | MUTATE: `createBridgeAction` dies; gap actions survive re-grounded |
| `lib/mutations/core.ts` | MUTATE: `CONF_TABLE` maps `{claim, bridge_claim, stance, position}`; `snapshotOnClient` snapshots all four buckets |
| `lib/argument-nodes.ts`, `lib/argument-gaps.ts`, `lib/gaps-core.ts`, `lib/concepts.ts`, `lib/lens.ts` | MUTATE (`recommendBridgeFeeders` dies) |
| `lib/summary.ts` | KILL with questions |
| `lib/report.ts`, `lib/report-generate.ts` | MUTATE |
| `lib/signal-brief.ts`, `lib/signal-ask.ts` | KEEP |
| `lib/pdf/*` | KEEP (fonts are LOCAL .ttf registered by fs path); `sheet-doc`/`thesis-doc` prune bridge/stance |
| `lib/supply-chain/*`, `lib/traceroute/*` | follow OQ-10 |
| `lib/datasets/*` | MUTATE (scout + bridge rows) |
| `lib/types/*` | MUTATE (`scout.ts` KILL) |

## 3. Components

**KILL:** `StanceCard`, `BridgeBand`, `BridgeForm`, `components/scout/*` (11 files),
`TextGuardPanel` (drives the refetch web loop), `PaperReader` (the arXiv iframe),
`FindingCoveragePanel` (batch loop over arXiv hydrate).

**MUTATE (highlights):**
- `QuestionMap.tsx` — the signature claims↔stances bipartite SVG; every edge filters
  `to_type==='stance'`. Re-conceive as the hypothesis→evidence map (the mechanism, a
  measured-layout argument SVG, is D-015-protected; the object changes). `ClaimForm`
  consumes its `ProposedClaim.stanceEdges` ghost-preview API.
- `ClaimForm.tsx` — stance-edge picker + bridge-feeder picker die; ghost preview
  re-targets.
- `PipelineConsole.tsx` — drop the discover/sweep/hydrate/coverage calls (:82, :112);
  triage/analyze/complete loop stays. `PipelineCandidates.tsx` loses the
  fetch-failed "needs manual" concept.
- `dashboard/PipelineAnalytics.tsx` + `pipeline-charts.tsx` — funnel charts keyed on
  discovery/coverage/query yield; rebuild around the manual-intake funnel or drop.
- `ConfidenceEditor.tsx` — `targetType` union shrinks.
- Ask cluster (`AskPeek`, `AskThread`, `AskWorkspace` web toggle), `CitationsPanel`.
- Thesis rename cluster (8 components), reports sheet trio (drop bridge kind),
  `SiteNav.tsx` (nav arrays :33-65), `portal-icons.tsx`, research cluster
  (`AddPaperForm` arXiv auto-fill etc.), `SourceEvidenceMap`, `SignalForm`,
  `ConceptForm`/gap panels, `CalibrationView`, `DraftQueue`.

**KEEP:** Header/Brand/ThemeToggle/Prose/Editable family, ConfidenceBadge, HeatChips,
signal display family, EvidenceList, SourceForm (in-browser unpdf), Costs/Tickets,
report document family, lobby/ask remainder, feedback dialogs.

## 4. Schema (37 migration files)

### Enums
- MUTATE (narrow): `node_t` ('stance','claim','bridge_claim' → hypothesis-era values),
  `rationale_target_t`, `extraction_target_t`, `run_cadence_t` (drop daily/weekly),
  `run_step_t` (drop 'discovery'), `report_kind_t` (drop 'bridge'), `paper_origin_t`.
- KILL: all 6 scout enums.
- KEEP: the rest (`domain_t`, `lens_t`, `relation_t` (verify whether `organizes` is
  stance-only), `direction_t`, `significance_t`, `signal_lens_t` (→ context axis),
  triage/run/origin/analysis enums, concept enums, ticket enums, `thesis_status_t`).

### Tables
- KILL: `stances`, `bridge_claims`, the 5 scout tables + `company_documents`,
  (`questions` + `question_summaries` die with D-013).
- MUTATE: `edges` (polymorphic, NO FKs — see gotcha 1), `evidence` (`target_type` has
  NO CHECK; audit data before narrowing), `node_lenses`, `position_components`
  (admits 'stance'), `snapshots` (state buckets), `rationales`, `extraction_queue`,
  `pipeline_runs` (drop `coverage` jsonb), `signal_candidates` (drop `fetched_via` +
  `discovery_queries`, the 0016 learning-loop columns), `concept_claims` (CHECK
  includes 'bridge_claim'; links by TEXT CODE), `theses` → `hypotheses`,
  `thesis_reports` (frozen packs, §0), `generated_reports` (kind).
- KEEP: `claims` (merges INTO `hypotheses` with `theses`, D-016), `sources`,
  `signals` + `digest_snapshots`,
  `positions_crosscutting`, `dedupe_scan`, `reports`, `ai_rate_cards` + `ai_cost_log`,
  concepts trio + gap scans, research tables (per OQ-6), `research_agent_prefs`,
  `tickets` + `ticket_images`, supply-chain pair (OQ-10).
- Squash note (D-010): carry `pg_trgm`/`pgcrypto`, the `search_tsv` generated columns +
  GIN/trgm indexes, `conf_label()`, `set_updated_at()`, `atlas_touch_text()` (0037 —
  `signals.search_tsv` was defined 3 times; only the 0037 version survives), and the
  RLS enable blocks.

## 5. Outbound-network audit

**A. Anthropic API (KEEP, make configurable).** Ten `new Anthropic({apiKey})` sites,
none sets `baseURL` today: the 5 ask/signal routes, `lib/dossier.ts` ×2, plus 5 sites
in dying modules (pipeline web/coverage, scout). Surviving sites get
`ANTHROPIC_BASE_URL` support (D-009) — ideally via one shared client factory.

**B. Anthropic server-side `web_search_20250305` (KILL every use).** Pipeline
web/coverage, scout ×3, and the toggles in `api/ask`, `api/ask/deep`,
`api/portal/ask`. Cost accounting for `web_search_requests` in `lib/cost.ts`.

**C. Direct server `fetch()` to the web (KILL).** Candidate fetch + `r.jina.ai`
fallback (`lib/pipeline/web.ts:396,442`), arXiv Atom API (`lib/research/arxiv.ts:108`),
Semantic Scholar (`lib/research/citations.ts:24`), arXiv html/pdf + paper URL
(`lib/research/analysis.ts:46,52,57`), scout enrich (`lib/scout/enrich.ts:67`),
`retainTextFor` (`lib/actions/signals.ts:105`), `hydrateCandidateAction`
(`lib/actions/pipeline.ts:118`), analysis backstop (`lib/pipeline/analysis.ts:87`).

**D. Browser-side external content (KILL).** The ONLY external iframe:
`components/PaperReader.tsx:19,64` (arxiv.org html/pdf). Plus external `target="_blank"`
links there and cosmetic placeholders.

**E. Build-time: fonts.** `app/layout.tsx:2` uses `next/font/google`
(Schibsted Grotesk, JetBrains Mono, Anton) — **downloads from Google at BUILD time; an
air-gapped `next build` fails**. Convert to `next/font/local`. Static TTFs for all
three faces already exist at `lib/pdf/fonts/*.ttf`, but the UI uses variable weights
(620/640/660/680), so vendor variable WOFF2s into the repo. `globals.css` is clean (no
remote imports). Everything else (showcase PNGs, ticket images, unpdf, gpt-tokenizer,
three) is bundled/local.

**F. Same-origin fetches:** all KEEP.

## 6. Seed / scripts

- `migrate.mjs` MUTATE: reads `SUPABASE_DB_*` + `ssl: {rejectUnauthorized:false}` —
  same for ALL 14 DB-touching scripts; re-point at `DATABASE_URL`.
- `seed.mjs` — effectively a REWRITE (D-010): 18 stances, 4 bridges, and every `edges`
  row targets a stance or bridge; the id-map insert blocks are unusable filtered.
  `seed-labor.mjs` is ~all stance content: KILL. `seed-concepts.mjs` MUTATE per OQ-9.
  `seed-threads.mjs` KEEP per OQ-6.
- Tests: `test-scout.mjs` KILL; `test-node-authoring`, `test-thesis` (mixes both
  stance meanings), `test-tearsheet`, `test-gaps`, `test-ask`, `test-deep`,
  `test-datasets`, `test-loop`, `test-page-latency`, `verify.mjs` all MUTATE;
  `test-traceroute*` follow OQ-10; `run-tests.mjs`, `capture-showcase.mjs` KEEP
  (Playwright browser download needs network at install — note for RUNBOOK).

## 7. Gotchas (verified, in cut order)

1. **`edges` has no FKs** (polymorphic uuids). Dropping stances/bridge_claims strands
   rows silently; delete edge rows BEFORE narrowing `node_t` (the unique constraint
   blocks enum narrowing while rows exist). For the seed, ~100% of edge rows die.
2. **`evidence.target_type` has no CHECK** — schema permits `'stance'` even though code
   assumes claim|bridge_claim. Audit live data before narrowing the enum. Same for
   `position_components.target_type`.
3. **`signals.claim_touches text[]` mixes namespaces** (claim codes + `B*` bridge
   codes), as do `papers.claim_touches` and `theses.claim_codes`. Strip `B*` codes from
   rows AND `touch_details` keys; `signals.search_tsv` is generated from
   `atlas_touch_text(claim_touches, touch_details)` so touched rows reindex on update.
   `lib/format.ts:64 touchHref` routes `B*` → `/bridge/`.
4. **`concept_claims` links by text code** — deleting bridges orphans links that
   accumulate as admin drift flags. Clean them in the same migration.
5. **/ask verifier shape-classifies tokens** (`^B\d+$` → bridge, `-S\d+` → stance);
   left in place it validates citations to dead records. Strip with the retrieval legs.
6. **`QuestionMap` has no meaning without stances** — re-conceive (see §3), don't
   patch.
7. **The whole-Atlas tear sheet is a stance rollup** — redesign against hypotheses.
8. **Two meanings of "stance"** (§0) — the direction rollup survives and is frozen in
   existing report JSONB.
9. **Re-home `sanitizeText` (+ `domainOf`, `normalizeUrl`, `MIN_READABLE_CHARS`,
   `FetchFailure`, `RawCandidate`) BEFORE deleting `lib/pipeline/web.ts`.**
10. **`publishSignalAction` hides an outbound fetch** (retained-text guard) — on an
    air-gapped box every publish eats a doomed ~20s timeout. Remove the guard's fetch;
    keep the "is text retained" check as a display-only flag.
11. **The learning loop** (`getZeroYieldDomains`/`isFetchHostileDomain` + the 0016
    columns) dies with discovery.
12. **`lib/db.ts` is Supabase-shaped** (pooler assumptions, `rejectUnauthorized:false`,
    `DB_POOL_MAX` pooler note); `.env.example` documents all of it — rewrite both.
13. **30 files export `maxDuration`** (inert off Vercel) and ~15 comments justify the
    chunked architecture by the 60s cap. Keep the chunking (it buys resumability,
    D-002) but rewrite the justifying comments; delete `api/probe/duration`.
14. **The seed needs a new shape, not a filter** (§6).
15. **`next/font/google` fails the air-gapped BUILD** (§5E) — invisible until the first
    on-prem `next build`. Fix before zipping.
16. **`generated_reports` may hold `kind='bridge'` rows** with frozen packs — delete or
    remap before narrowing `report_kind_t`; `SHEET_KIND_LABEL`/`SHEET_SECTION_TITLES`
    in `lib/format.ts` are keyed on it.
17. **Barrels hide the blast radius** — `lib/{actions,data,mutations,types}/index.ts`
    each re-export scout; edit barrel and file together or the build breaks.
18. **`proxy.ts` allow-list encodes the old IA** — 8 blocks reference bridges/scout +
    retired stubs. A renamed route missing from the allow-list bounces guests to
    `/login` silently; sweep it as part of every route rename.
19. **Stale docs:** `docs/discovery-pipeline-spec.md` + `docs/web-research-pipeline-primer.md`
    describe the dead leg (delete or move to an archive note); `CLAUDE.md` references
    stances/bridges/scout/Vercel throughout (full rewrite is a transition deliverable);
    `docs/core-loop.md` + `docs/prompt-architecture.md` describe the surviving spine
    (keep, light edits).
