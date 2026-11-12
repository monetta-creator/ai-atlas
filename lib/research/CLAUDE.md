# Research Portal and engine

Public reading surface for papers and threads plus a daily admin-run engine (4th daily engine). Background only: `docs/research-section.md` is the ORIGINAL design doc and predates the daily engine.

## Pages
- `research/page.tsx` (public, insight-first): "New this fortnight" strip (thread synthesis revisions with `trigger_note` via `getRecentThreadRevisions`, newly tracked papers via `getTrackedSince`), threads as cards with synthesis excerpts, "On the Argument Map" advisory rollup (`getResearchTouchRollup`), then watchlist + noted (`getNotedPapers`, fetched directly). Admins get a desk strip only. A "This week" strip + past-roundups list show the Friday roundup.
- `research/console/page.tsx` (admin, `adminGate`): runs, review queue, add form, thread tools, citations, run history, engine strip + tick loop, enabled toggle, model pickers, `getResearchHealth(30)`, run-notes issues feed, Model A/B table over `analyzed_by`, `research-export` downloads.
- `research/[id]/page.tsx`: the FINDING is public (editorial like signal briefs). Analyze button, model-suggested rigor, review controls, rigor, promotion and `raw_content` stay admin. "Bears on" codes link to their claim/bridge pages.
- Header carries `PaperReader` ("Read the paper here" + "Open on arXiv" buttons): the drawer iframes the ORIGINAL arXiv document in a right side pane, arXiv's `/html/<id>` LaTeXML version by default with a PDF toggle. Both are frame-embeddable, unlike its `frame-ancestors 'none'` abs pages. CSS `.pv-*`.
- `research/threads/[slug]/page.tsx`: synthesis + papers public (with effect-size lines); update button, `why` rationales, revisions admin.
- `research/digest`: admin-only, Header-less, so it redirects a non-admin to the public parent.
- Claim/bridge pages carry a "Research bearing on this · advisory" pane (`getPapersForTarget`). Papers never write evidence.
- `research/*` pages that host AI actions set `maxDuration = 60`.

## Findings coverage and queue agent (migration `0033`)
- `getFindingCoverage` + `FindingCoveragePanel`: batch "Analyze missing" over the reviewed shelf, reusing the per-paper hydrate/analyze actions, about $0.10 each.
- `QueueAgentPanel` + `lib/research/queue-agent.ts`: recommend-only pass over ALL pending papers in 12-paper `runStructured` chunks, feature `research_agent`.
- The run-static system block carries the standing steering note from the `research_agent_prefs` singleton, a revealed-taste digest of past tracks/notes/dismissals, and the Atlas digests.
- Stamps each paper with `agent_recommendation/reason/confidence/cluster`. The queue re-sorts track-candidates-first, cards show agent chips, Track prefills the agent's why.
- Per-group BULK accepts flow through the same review write. Accepting tracks chains straight into finding extraction.
- Re-runs refresh every pending paper with current steering. Recommendations are kept after decisions (for a future agreement-rate audit).
- Landmine: the Anthropic tool validator rejects `minimum`/`maximum` on integer schema properties. Put ranges in descriptions and clamp in writers.
- **The reader is cheap by default**: `queueAgentModel` (queue agent and triage-to-N) uses the console's triage pick, else `z-ai/glm-5.3-flash` when `OPENROUTER_API_KEY` is set, else the Haiku fallback. The engine's agent step runs `AGENT_POOL` (2) disjoint chunks per unit.

## Review desk (`research/queue/page.tsx`, admin, migs `0082`-`0083`; the `/signals/drafts` shape)
- `ResearchQueueBar`: queue shape plus judgment-free cuts: dismiss the agent's dismissals, dismiss past `research_prefs.stale_days` unless agent-tracked, note the agent's notes.
- **Auto-dismiss policy**: `research_prefs.auto_dismiss` + `auto_dismiss_min_confidence` (default on, 80), committed by `applyResearchQueuePolicy` when the engine leaves its agent step and by Run now. No model call.
- The agreement record over 90 days with `suggestThreshold` lives in the pure `lib/research/queue-core.ts`, tested by `scripts/test-research-queue.mjs`.
- `PaperSprint`: T track (why prefilled from a track recommendation), N note, D dismiss, S skip, ← back, O open. The queue agent panel and card list sit behind a details block.
- `papers.review_basis` records how a decision was made: null = one human call; `agent_policy` / `bulk_agent` / `bulk_stale` / `bulk_cap`. Only null rows feed `getReviewTasteDigest` and the agreement record, so the agent never learns from its own calls.
- Track and note stay human: both put a paper on a public shelf. Nothing is ever bulk-noted, and `getReviewedSince` skips bulk-noted papers because the Friday roundup reads every paper noted that week.
- **Triage down to N**: `TriageToCapPanel`, or `npx -y tsx scripts/research-cap.mts --keep=25 [--dry-run] [--skip-read]`, over `lib/research/queue-cap.ts`. `readUnreadBatch` runs eight 12-paper agent chunks per call until nothing is unread (the page declares `maxDuration = 300`; server actions from one client run serially, so the parallelism lives server-side). Then `pickAndCap` (one call, feature `research_queue_pick`) picks N from the agent's top 100 track/note picks (the pure `finalists` fills any shortfall in agent-confidence order and never keeps a dismissal on its own) and dismisses every other pending paper with basis `bulk_cap`. Rows stay, and decisions are reversible.
- When the desk can't read the database, its error plate prints the database message and lists pending migrations, with an admin-only "Apply pending migrations" button (`lib/migrations.ts`).

## Engine (mig `0046`, manual-runs doctrine is dead)
- `lib/research/engine.ts`: the scan pattern. Day-keyed `research_runs` rows (`day`, `lease_until`, `notes`), `checkResearchBudget` vs `RESEARCH_DAILY_BUDGET_USD` (default 1.00).
- Steps: pull → triage → agent → analyze. Agent-positive papers auto-hydrate + extract, most-confident first, stamped `papers.analyzed_by`.
- Crons (weekdays): `/api/cron/research` at 10:00, 11:50, 13:40, 15:40 UTC; `/sweep`, `/sweep2`, `/sweep3` are path stubs for the later windows. Monday uses a 3-day lookback.
- `research_prefs` singleton: `enabled`, `triage_model`, `analysis_models`. No Sonnet anywhere in the loop: all three model features route through `lib/research/model-route.ts` `researchStructured` (Anthropic ids via runStructured, else OpenRouter via `lib/scan/llm.ts`, one bounded retry on the OpenRouter path). Default is GLM-5.3-flash everywhere.

## Triage charter (`lib/research/triage.ts`)
- Keep-worthiness is DEFINED by the argument graph: 7 A-families + 3 B-families + explicit rejects + the tie-breaker "would the fortnight report cite it". Not taste.
- Regression test: the 120-paper gold set in `private/research-gold/`, replayed via `scripts/ab-research-triage.mjs`. GLM + charter holds 90.2% gold-keep recall at 5.1% noise.
- Don't reintroduce a "few percent" keep anchor: it makes cheap models over-reject.
- Triage runs maxTokens 8000 / 90s. Truncation at 4000 masqueraded as harshness, so never shrink it.

## Friday roundup (`lib/research/roundup.ts`)
- Cron `/api/cron/roundup` Fri 21:00 UTC (`maxDuration` 300).
- Refreshes threads that gained papers, builds a guest-safe `RoundupPack` (never `review_note` or `raw_content`), two Sonnet legs (`roundup_sections`, `roundup_close`), citation-gated.
- Saved as `generated_reports` kind `'roundup'`. It is the ONE report kind that auto-publishes (the maintainer's explicit decision).
- Renders on /reports, `/reports/sheet/[id]` and its PDF (no next.config change). Quiet weeks skip.

## Ask corpus (migration `0031` FTS)
- Papers + threads are in the /ask retrieval corpus. Threads are cited `[thread <slug>]`.
- Papers mint `P`-tags on the SAME counter as signal `S`-tags (one `signalOffset`, one tag map, prefix = kind; `/research/<uuid>` vs `/signals/<uuid>`), with peek panels, deep-research search/fetch and verify-route support.

## Dataset
- `research-export` (key-gated): tracked + noted papers with flattened extraction fields + retained `full_text` + `rigor_prior` (a scoped KEY_GATED_ALLOWED exception), plus the `buildResearchHandoff` orientation doc.
