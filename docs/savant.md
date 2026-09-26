# Savant

Savant is the Atlas's autonomous weekly research report: one issue every Friday, key-gated, written for people doing AI transformation inside large regulated financial-services companies and read by their executives. It is branded as its own imprint under The AI Atlas. Strapline, every issue: *An autonomous research agent with an editorial point of view. Produced by The AI Atlas.*

This document is the contract: what Savant reads, what it writes, and the rules that keep it publishable without a human in the loop.

## The rules

1. **Public data only.** Savant reads the stores the engines fill from public sources (scan, intel feeds and filings, papers, the tooling monitor, published signals and their evidence). It reads no admin free text: `intel_companies.notes`, `review_note`, `raw_content`, `rigor_prior` and the `agent_*` columns never enter a prompt.
2. **The reader organization is a registry row, never code.** The intel registry's `self` tier names the organization the report is contextualized for. Its name and its `public_blurb` (a public-facing description the maintainer writes from public sources) are the only organization context Savant sees. Nothing in the repo names the organization.
3. **Nothing may lean confidential.** Every statement about the reader organization must trace to a cited public record. The editor persona's checklist has an explicit "reads as insider knowledge" item and cuts the sentence.
4. **Every figure has a source.** Metrics come from the warehouse (FDIC call reports, FR Y-9C, EDGAR company facts, CFPB complaints, careers-site counts) and carry their series and identifier-built citation. Prose links go through the citation gate (`enforceCitations`) against the issue's allow-list; a link the pack cannot vouch for is removed before save and again at render.
5. **One new hypothesis a week, carried forward.** Every issue poses one falsifiable hypothesis and returns to the open ones with what the week did to them. The ledger (`savant_hypotheses`) is Savant's memory. Confidence numbers and question summaries are out of scope by decision.

## Phase 1 (shipped 2026-09-26): the notebook

`lib/savant/notebook.ts runNotebookDay(day)` runs weekdays at 17:15 UTC (`/api/cron/savant`, after the Daily Edition's press) and appends rows to `savant_notebook` for the week ending that Friday (`weekEndFor`). Every row upserts on `(week_end, day, kind, key)`, so re-running a day is safe. By hand: `npx -y tsx scripts/savant-notebook.mts <day> [--skip-plan] [--skip-note] [--reset] [--show]`.

| kind | what it is | how |
|---|---|---|
| `connection` | a new record sits near a node of the argument map | cosine join over the shared `embeddings` table in plain SQL (`lib/savant/connections.ts`): the day's scan items (relevance ≥ 0.55), intel items, facts and kept papers against every claim, bridge and stance; sim ≥ 0.55, at most 2 targets per record, 40 per day. Map nodes are embedded by code, so targets resolve by code. |
| `echo` | a paper or extracted fact and a news item saying one thing | the same join across natures (paper/fact vs item), sim 0.80 to 0.95 (above that the two engines stored the same article) |
| `anomaly` | a metric that broke its own pattern; a topic or company with a volume spike; a lens no signal touched (Friday) | `lib/savant/anomalies.ts` + pure `anomalies-core.ts`: curated codes in `metric-codes.ts`, latest period within 120 days, z-score of the latest period-over-period change against the trailing 8 changes (so a bank growing every quarter is not an anomaly), flows reported year-to-date or mixing annual and quarterly facts excluded, one entry per company and label family, 3 per company, 20 per day; volumes vs the trailing four weeks |
| `miss` | what the desk knows it did not cover | the pipeline's coverage misses (cleaned), scan topics with 30+ relevant items and no approved candidate (top 5), questions with no new evidence (Friday) |
| `plan` | Monday's editorial decision | `lib/savant/plan.ts` on `savant_prefs.notebook_model` (feature `savant_plan`): topic, question, why, and the week's new hypothesis; deterministic rotation fallback in `plan-core.ts`; the hypothesis is inserted into the ledger; `savant_prefs.lead_override` is honored once |
| `note` | the day's diary, ~120 words | `lib/savant/note.ts` (feature `savant_note`) over the day's entries |

Budget: `checkSavantBudget(weekEnd)` sums the `savant_*` features stamped `metadata.week_end` against `SAVANT_WEEKLY_BUDGET_USD` (default 6). The first live pass cost under a cent.

Console: `/savant/desk` (admin): the week's notebook by day, the hypotheses ledger, prefs (models, rotation, one-off lead override, editor name, email on/off).

Measured on the first live pass (Friday 2026-09-25): 81 raw connections, 15 kept (papers on the hiring evaluation bottleneck to the labor claims; Bank of America's AI budget and Citi's job cuts to claim 7.2), 19 metric anomalies after the delta rule (Citi's CFPB complaints down 41% month on month at 4.95σ, PNC's efficiency ratio up two points), 3 misses, one note. Before the delta rule the anomaly leg fired 66 times on level trends and on EDGAR series that had ended years earlier.

## Phase 2 (next): the Friday issue

Departments, in order: executive summary; lead analysis (1,500 to 2,500 words, the Monday topic researched through the week); Savant's hypotheses (the new one, the standing ones with updates) and what moved on the map; peer and market watch (the `self` company beside its tiers from public filings; key-gated content); regulation and policy; research desk; tools and builders; missed and blind spots; the week ahead (dated items already in the corpus); Appendix A, how this issue was researched (the notebook); Appendix B, numbers; Appendix C, sources; the editor's note.

Legs: pack (`buildSavantPack`), lead research (the deep-research loop extracted from `/api/ask/deep` into a library function, portal-mode retrieval, web capped at 3 and labeled), department writing on `writer_model`, the editor persona on `editor_model` (checklist: bottom line first, every claim sourced, no insider tone, no hedging, no repetition, figures consistent with Appendix B, the lead answers its hypothesis, banned words, no em dashes), one revision round, save as `generated_reports` kind `savant` (one per week, published on save), email. Surfaces: `/savant`, `/savant/[week]`, `/savant/archive`, `/savant/[week]/pdf` (Letter, the script wordmark on the cover); the `/reports` card; the nav leaf. The public page shows title and table of contents only.

## Phase 3: distribution

Per-key opt-in (`portal_keys.savant_email`), the Friday email with the executive summary and a link, a verified Resend sending domain (without it only the account owner receives mail).
