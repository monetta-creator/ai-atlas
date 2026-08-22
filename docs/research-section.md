# Research Section (arXiv) — Design

> **Historical note (2026-08-22).** This document describes the AI Atlas as built before the Strategy Atlas remodel (claims/stances/bridges, audience lenses, web discovery). The machinery it explains largely survives, but object names and some subsystems changed; `transition/` is the authoritative record of what maps to what.

Status: design agreed 2026-07-09, pre-implementation. This doc is the source of truth for the build; open items at the bottom need the maintainer's input but do not block phase 1.

## What it is

A dedicated research surface (`/research`) that pulls recent AI papers from the arXiv API, triages them against the Atlas's argument graph, deep-analyzes only the ones the admin selects, and organizes the keepers into a compounding web of **research threads** (living synthesis pages, a wiki-garden pattern) linked to the existing **concepts** scaffold.

The differentiator is not summarization (alphaXiv, Emergent Mind, HF Daily Papers already do that). It is summarizing **against the Atlas**: what does this paper do to the tracked claims, bridges, and concepts — and what does this capability result imply for the economic claims in 12–24 months. The research section is the leading-indicator surface upstream of the Signal Board.

## Decisions (locked)

1. **Admin-first, public later.** The surface is built public-ready (personal layer strippable, same `personal = isAdmin() && !preview` pattern) but gated behind the login redirect until the funnel proves itself. Flipping it public later is a proxy allow-list + redirect change, not a rearchitecture. When it goes public, thread synthesis gets a per-thread publish gate (Signal Board pattern).
2. **Spine = research threads + concept links.** Threads are frontier questions ("does scaling keep paying off?") holding a living, model-maintained synthesis. Papers also link to existing `concepts` by slug. Concepts stay pedagogical; threads carry the moving frontier.
3. **Broad intake, hard triage.** Pull whole categories (cs.AI, cs.LG, cs.CL), kill 95%+ at metadata-only triage. Targeted keyword queries would miss capability results whose economic relevance isn't in the title.
4. **Manual runs only. No cron. Cost at rest is $0.** The run is driven step-by-step from a console, exactly like `/pipeline`. Extraction is **on-demand per paper**: triage surfaces a review queue, the admin picks which papers get the expensive full-text pass. Human before the expensive call.
5. **Papers never write evidence directly.** Triage may record advisory claim touches, but the only road into the Argument Map is promotion to a signal (the existing pre-approved-candidate path, like `TurnIntoSignalButton`), and publish materializes evidence via `syncSignalEvidence`. Two human gates between arXiv and a confidence move.
6. **Triage rejects are kept** (metadata rows only, no AI spend) with a ~90-day prune, so the citation-velocity self-correction ("you dismissed this, it's at 80 citations") is possible later.
7. **Manual entry exists alongside runs.** An "Add paper" form on `/research` and a "Send to research" button on source pages (distinct from "Turn into signal") both create pre-approved papers that skip triage. This covers papers missed between sessions (the lookback-gap caveat) and non-arXiv research (NBER/SSRN working papers, lab reports).

## Relationship to the existing system

Standalone organs, shared circulatory system:

- **Shared primitives:** the `pg` pool (`lib/db.ts`), `runStructured` (`lib/dossier.ts`), `ai_cost_log` metering, the DB-checkpointed short-step run pattern (Vercel ~60s cap), `fetchCandidateText`'s fetch layer for full text.
- **Promotion bridges (one-way, human-gated):**
  - Paper → Concept: link by slug, `concept_link_status_t` (`suggested`/`confirmed`) — this is the propose→queue flow that enum was future-proofed for in `0017`.
  - Paper → Signal: promote through the pre-approved candidate path (triage→analyze→draft; a human publishes). Suggested `origin` handling: reuse `manual` or add `research` to `signal_origin_t`. **Promotion is additive, not a move**: research-side and signal-side are not exclusive. The paper stays in the research section, `signal_id` links the two, the paper page shows its signal and the signal page its paper. Same item, two altitudes.
- **Shared dedup surface:** discovery sometimes finds arXiv URLs; triage already URL-dedups against `sources` and drafts. The research layer joins that surface — a paper never enters twice through two doors (normalize on arXiv ID; versions collapse into one row).

Not integrated: papers are NOT signal candidates (different volume, different rhythm — signals are few-per-week and editorial; papers are hundreds-per-day and matter in aggregate).

## Data model (new tables, one migration)

- **`papers`** — one row per paper. `origin` (`arxiv`/`manual`, mirrors `signals.origin`); `arxiv_id` **nullable** (unique when present; new arXiv versions update the row) with a normalized-URL unique fallback for manual entries; nullable `source_id` when the paper came from an ingested source ("Send to research"). Metadata: title, abstract, authors jsonb, categories text[], published/updated timestamps, `comments` (venue-acceptance signal, e.g. "Accepted at NeurIPS"), pdf/html URLs. Funnel state: `triage_status` (pending/kept/rejected — manual entries enter as kept), advisory `claim_touches text[]`, triage one-liner. Post-analysis: cached `raw_content` (survivors the admin analyzed only), extraction jsonb (shape below), `rigor_prior` (0–100, human-adjustable, mirrors `sources.reliability_prior`). Personal layer: `review_status` (pending/noted/tracked/dismissed) + tracking note. Promotion: nullable `signal_id`. Later: `citation_count`, `citations_checked_at`.
- **`paper_concepts`** — paper → concept slug, status `suggested`/`confirmed` (reuse `concept_link_status_t`). Public reads (later) filter `confirmed`, matching `concept_claims`.
- **`research_threads`** — slug, title, question framing, `synthesis` (the living page), status (open/settled/dormant).
- **`thread_papers`** — thread ↔ paper, relation (`supports`/`complicates`/`contradicts`/`context`) + one-line why.
- **`thread_revisions`** — append-only synthesis history (prior text, trigger, timestamp). The `snapshots` discipline applied to prose: you can watch a thread's story drift.
- **`research_runs`** — mirrors `pipeline_runs`: status, step (pull/triage/review/complete), tallies, high-water mark. Runs are resumable; the tables are the checkpoint state.
- **`research_thread_scan`** — singleton for model-proposed new threads (mirrors `concept_gap_scan`/`argument_gap_scan`); *Start draft* prefills a thread form server-side from the persisted scan.

RLS enabled, no public policies (deny-by-default, app role bypasses), same as every other table.

Prune job for rejects: opportunistic delete at the start of a pull step (`triage_status='rejected' AND review_status='pending' AND older than 90 days`), no cron needed.

## The run (manual, console-driven, mirrors `/pipeline`)

All steps are short, DB-checkpointed units driven from the console; every model call goes through `runStructured` and lands in `ai_cost_log`.

1. **Pull** (no AI). Query `https://export.arxiv.org/api/query` (Atom XML) since the run's high-water mark, with an **admin-chosen lookback (3 / 7 / 14 days, default 7)** — volume control belongs to the human; the 14-day / ~3,000-paper ceiling is the hard cap (a lesson from the first live run). One checkpointed invocation per page respects both the 60s cap and arXiv politeness (~1 req/3s). Upsert by `arxiv_id`. Note: arXiv announces Sun–Thu evenings ET — an empty pull near a weekend is normal, not an error.
2. **Triage** (cheap AI). Chunks of ~25 title+abstract pairs against a cached system digest of claims, bridges, concepts, and open threads; the console runs **3 chunks concurrently** (chunks are claimed atomically server-side, `for update skip locked`, so workers never double-triage). Output per paper: keep/reject, advisory claim touches, candidate concept slugs / thread slugs, one-line relevance. A 7-day window ≈ ~1,500 abstracts ≈ ~$1.50 and ~6 minutes.
3. **Review queue** (human). Kept papers listed with title, venue signal, relevance line. The admin selects papers to analyze — nothing below this line costs money without a click.
4. **Analyze** (on-demand, two invocations per paper, the hydrate→analyze pattern). Hydrate: fetch full text (prefer `arxiv.org/html/{id}`, fall back to PDF via `unpdf` through `fetchCandidateText`), cache `raw_content`. Analyze: one `runStructured` call producing the extraction (below), suggested concept links, suggested thread placements, and a proposed `rigor_prior`.
5. **Commit** (human). Track (why required — the `rationales` discipline) / note / dismiss; confirm or reject concept links and thread placements; optionally trigger a per-thread synthesis update (one bounded call per thread, admin-clicked, writes `thread_revisions`); optionally promote to signal.

## Manual entry (no run required)

Two doors into the same review/analyze stage, both creating pre-approved rows (`origin='manual'`, `triage_status='kept'`, no triage call):

- **"Add paper" on `/research`** — paste an arXiv URL/ID (metadata auto-fetched from the arXiv API, dedup by `arxiv_id`) or any other URL/PDF (the `/ingest`-style metadata auto-fill path, text-only, file never stored). Solves the between-sessions staleness gap: hear about a missed paper, add it in seconds. Also the door for non-arXiv research (NBER, SSRN, lab reports).
- **"Send to research" on `/source/[id]`** — a button alongside "Turn into signal," independent of it (the same source can go through both; neither excludes the other). Creates a paper row linked via `source_id`, reusing the source's cached text, metadata, and reliability prior (seeding `rigor_prior`).

Cross-dedup applies in both directions: adding a paper whose URL/arXiv ID already exists in `papers`, `sources`, or a signal draft surfaces the existing row instead of duplicating.

## Extraction shape (the paper page)

Structured finding, not a summary:

- **Headline claim** — what the paper asserts, in one falsifiable sentence.
- **The test** — what was actually measured, on what, at what scale.
- **Effect size & scope conditions** — how big, and where it holds / breaks.
- **Limitations acknowledged** — what the authors themselves concede.
- **Counterpoint** — what a skeptic says (benchmark gaming? lab PR? n=3?). Mirrors the signal detail's briefing+counterpoint.
- **Capability→economy implication** — what this means for the tracked economic claims in 12–24 months, stated with restraint (recommending nothing is a normal outcome).
- **Who this matters for** — one line per relevant audience lens (`signal_lens_t`: market/labor/geopolitics/regulatory/capability/society). Nice-to-have; ships after the core extraction if it crowds the prompt.
- **Advisory touches** — claim/bridge codes this bears on (advisory only; see gate rule).

Prompt conventions: no em dashes in AI output (house rule), restraint-biased, every suggestion must cite its grounding or be dropped.

## Evaluation

- **Credibility:** venue signal from `comments`, code availability, plus the model-proposed `rigor_prior` — always a prior, human-adjustable, never authoritative (the `reliability_prior` pattern).
- **Importance:** relevance to the graph at triage; later, **citation velocity** via the Semantic Scholar API (free, keyed by arXiv ID) as an in-session "refresh citations for tracked papers" button — not a cron. Surfaces both "your tracked paper is compounding" and "your reject is blowing up."

## Threads

- **Seed threads (agreed):** an idempotent seed script (the `db:seed:concepts` pattern, never clobbers prose) creates five starting threads: *does scaling keep paying off*; *agent reliability vs. the eval–real-work gap*; *inference cost curves*; *what RL-on-verifiable-rewards changes*; *automation evidence in real labor data*. All editable/renameable/retireable in the console — nothing is locked in. After that, the scan-singleton panel proposes new threads from clusters of kept papers; human commits.
- Synthesis updates are admin-triggered per thread (never automatic on ingest), bounded (`timeoutMs 55s`, `maxRetries 0` — the report-generation lesson), and every rewrite is preserved in `thread_revisions`.

## Cost model

- At rest: $0. No cron, no background work.
- Per session (weekly-ish): triage <$1, extraction ~$0.10 × the papers actually clicked (typically 5–10), synthesis updates ~$0.20 × threads touched. **~$2–3 per session**, all visible in `/costs`.

## Phasing & execution

**Phases are build order, not ship gates.** Per the maintainer: build all four phases in one autonomous pass, no human in the loop mid-build. The implementing agent owns its own testing and remediation — build/lint clean, migrations applied and verified against the dev DB, funnel exercised end-to-end (a run with mocked/live arXiv responses, manual add, promote-to-signal round-trip), fix what breaks — and communicates progress as it moves between phases rather than asking permission.

1. **Library + funnel:** migration, arXiv client, pull + triage steps, `/research` console with review queue, track/note/dismiss with required why, manual "Add paper" form, thread seed script. (Ship this and the feature is already useful.)
2. **Depth:** hydrate/analyze extraction, paper detail page, concept links (suggested→confirmed), rigor prior, promote-to-signal, "Send to research" on source pages.
3. **The web:** thread pages, synthesis updates, revisions history, thread-scan proposals, concept-page "recent research" pane.
4. **Self-correction:** Semantic Scholar citation refresh (in-session batch, plus the "rising rejects" requeue surface), tracked-paper watchlist view, and a standalone print-friendly `/research/digest` (the `/signals/digest` pattern; kept out of the saved-report jsonb schema so existing reports and the public report renderer stay untouched).

## Open items (maintainer)

- **Public flip criteria** — what has to be true before `/research` joins the public reader surface. Deferred, non-blocking: the surface is built public-ready but gated, so the flip is a proxy allow-list + redirect change whenever the funnel has earned it.
