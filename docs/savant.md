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

Console: `/savant/desk` (admin): the week's notebook by day, the hypotheses ledger, prefs (models, rotation, one-off lead override, editor name, email on/off). It replaced the old News Blotter Desk (the leaf is labeled Savant; `/blotter/desk` redirects).

Measured on the first live pass (Friday 2026-09-25): 81 raw connections, 15 kept (papers on the hiring evaluation bottleneck to the labor claims; Bank of America's AI budget and Citi's job cuts to claim 7.2), 19 metric anomalies after the delta rule (Citi's CFPB complaints down 41% month on month at 4.95σ, PNC's efficiency ratio up two points), 3 misses, one note. Before the delta rule the anomaly leg fired 66 times on level trends and on EDGAR series that had ended years earlier.

## Phase 2 (shipped 2026-09-26): the Friday issue

`lib/savant/issue.ts runSavantIssue(weekEnd)` runs Fridays at 20:00 UTC, with sweeps at 20:20 and 20:40 that resume from the legs parked in the notebook (`kind = 'query'`, `key = 'leg:<name>'`), so three 300-second calls finish an issue. By hand: `npx -y tsx scripts/savant-issue.mts <week> [--force] [--reset-legs] [--email]`.

| leg | module | model | what it does |
|---|---|---|---|
| plan (if the week has none) | `plan.ts` | notebook model | the Monday plan made on Friday's material; the hypothesis enters the ledger |
| pack | `pack.ts`, `peers.ts`, `calendar.ts` | none | the frozen data half: notebook, what moved, the peer tables with identifier-built citations, regulation, research, tools, dated items, counts, every map href |
| lead | `lead.ts` | writer model | Savant's own bounded research loop over the /ask tools in portal mode plus web search (3), 4 rounds, then a forced `submit_lead`: 1,500 to 2,500 words, records cited by tag and resolved to hrefs, positions linked by exact href, a "What we will watch" close, and its reading of the week's hypothesis |
| front | `write.ts` | writer model | the five-bullet executive summary, the new hypothesis paragraph, one reading per open hypothesis |
| departments | `write.ts` | writer model | what moved, regulation, research, tools, missed, the week ahead (an empty department prints its one-line notice) |
| peers | `write.ts` | writer model | the peer and market watch from the tables, every figure from the table, every series linked |
| editor | `editor-core.ts` + `editor.ts` | editor model | deterministic checks, then the editor persona: verdict, required edits per section, cuts, a signed note |
| revise | `editor.ts` | writer model | one round over the sections the editor named |
| save | `issue.ts` | none | citation gate over every fragment, `generated_reports` kind `savant` (published), the ledger update, the email |

Departments, in order: executive summary; lead analysis; Savant's hypotheses (the new one, then the standing ones with this week's reading) and what moved on the map; peer and market watch; regulation and policy; research desk; tools and builders; missed and blind spots; the week ahead; Appendix A (how this issue was researched: the plan, the diary, the queries, the editor's cuts, what the gate removed); Appendix B (every link, by host); the editor's note; the colophon.

Surfaces: `/savant` (latest), `/savant/[week]`, `/savant/archive` (the Report Portal's cover-page cards, one per issue), `/savant/[week]/pdf`. Guests see the title and the table of contents only; access-key holders and the admin read the issue. The `/reports` portal lists it as a portal-only card.

Fallbacks: past the weekly budget or on a failed leg, the lead falls back to the plan stated as open questions, departments to their empty notices, and the editor to the automated checks alone; the issue still publishes with the shortfall recorded in `dropped` and the editor's note.

## Phase 3 (shipped 2026-09-26): distribution

`email.ts sendSavantIssue` sends the executive summary, the table of contents and a link, one Resend send per recipient: the admin (`AGENT_EMAIL_TO`, else `agent_prefs.email_to`) and every active key with `savant_email` set, toggled per key on `/access`. `savant_prefs.email_enabled` gates it (default off). Without a verified Resend sending domain only the account owner receives mail; the run records failures rather than failing.

## Tuning notes

- Echoes need a paper or fact on one side; two news items at 0.99 are the scan and intel engines storing the same article.
- Metric anomalies use the z-score of the latest period-over-period change against the trailing eight changes, a 120-day freshness gate, no year-to-date or annual/quarterly-mixed flows, and one entry per company and label family. The first live pass fired 66 times on levels; the rule brings it to about 16.
- FDIC and Y-9C report dollars in thousands, EDGAR in dollars; `fmtMetric` renders both in billions.
