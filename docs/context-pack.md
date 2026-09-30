# The Briefcase: company context packs

Shipped 2026-09-29. Migrations `0080` (the briefs table) and `0081` (the public
record, unique per company).

## What it is

A model that runs where the Atlas cannot reach, inside a firewall or on an
internal open-weight endpoint, knows nothing the Atlas has collected. The
Briefcase packs everything public the Atlas holds about one tracked company into
files that model can use. Three files per company, all from one input:

| File | Size | Job |
|---|---|---|
| Base, markdown | about 10,000 tokens | standing context, in every prompt about the company |
| Brief, markdown | about 50,000 tokens | one deep task on one company, on a model that reads long context well |
| Sections, JSON rows | about 2,000 tokens a row | the retrieval corpus, for full-text and vector search |

There is no 200,000-token prompt file. Open-weight models recall poorly from the
middle of a long context, and the destination has retrieval for that depth. The
full record ships as section rows instead.

## Where to get it

`/datasets/briefcase`, a tab of the Data Portal, and the band at the top of
`/datasets`. One card per company with three download buttons. Key-gated: the
registry is private, so a guest sees the explainer and the unlock and never a
company name.

By URL (the same key gate as every key-gated dataset, cookie or header):

```
/api/datasets/context-pack?format=md&company=<slug>&size=base
/api/datasets/context-pack?format=md&company=<slug>&size=brief
/api/datasets/context-pack?format=json&company=<slug>&download=1
/api/datasets/context-pack/handoff
```

`format=md` takes `company` and `size` only. The rows take the whole query
grammar. The handoff is the orientation document for the intake on the other
side; the page has a copy button for it.

## What a pack holds

| Section | Source | Deep | Light |
|---|---|---|---|
| How to read this file | fixed text | yes | yes |
| Profile | `intel_companies.public_profile`, cited sentences | yes | no |
| Timeline | `self_timeline` | yes | no |
| Public metrics | `intel_metrics`, the curated codes in `lib/savant/metric-codes.ts` | yes | yes |
| Peer comparison | latest period per company, seven codes | yes | yes |
| Extracted facts | `intel_facts` | yes | yes |
| Recent developments | `intel_items`, one row per article | yes | yes |
| The public record, by source | `self_record` | yes | no |

A deep pack has a backfilled public record behind it (`self_record` rows exist
for the company). A light pack is built from the Intel Desk's recent news, facts
and metrics, and says so in its first section. Deep is derived from the data; no
flag can drift from it.

## Rules the code enforces

- **Public fields only.** `lib/context-pack/load.ts` selects `public_blurb` and
  `public_profile` from the registry and never `notes` or `dossier`. The pure
  input type has no field for either, and a test reads the source to check.
- **The company's name comes from the row.** No name appears in code, tests or
  this document.
- **Figures come from code.** Every number is formatted from a metric row by
  the unit in its metric definition (FDIC and Y-9C report thousands of dollars,
  EDGAR dollars). Series reported year to date, or mixing annual and quarterly
  facts, are labeled so a reader does not difference them.
- **Every statement carries its URL.** Tier documents number references in
  reading order and end with a Sources list. A section row carries its own list
  and a `cite_urls` column.
- **Deterministic.** The same rows render the same bytes. Packs are rendered on
  download; nothing but the briefs is stored.
- **Budgets hold.** `fitTier` gives every section an allowance, fills from the
  top of each section's list, never splits a line, and hands leftover budget out
  in a fixed order. The token estimate is characters / 4 x 1.3, a ceiling:
  measured against an exact o200k count, the base pack estimates 9.6k and
  counts 9.0k.

## The briefs, the one model-written part

`lib/context-pack/briefs.ts`, cron `/api/cron/context-pack`, Mondays 17:40 UTC.
For each deep company, one paragraph of 120 words or fewer per briefable
section: timeline, facts, recent developments, SEC filings, research papers,
news coverage. Feature `context_pack_brief`, `claude-haiku-4-5` by default
(`CONTEXT_PACK_BRIEF_MODEL`), capped per issue week by
`CONTEXT_PACK_WEEKLY_BUDGET_USD` (default 1). Measured: about one cent a
section.

The gate (`gateBrief` in `core.ts`), before anything is saved:

1. A link survives only when its URL is one of that section's own sources.
2. A sentence is dropped when it states a figure the section's lines never
   state. Integers up to ten are exempt.
3. The brief is cut at 140 words on a sentence boundary.
4. A brief with no surviving link is refused. The section renders without it.

**No brief is written for the metrics or peers sections.** The first live run
wrote them, and the model compared two different asset series as one and gave
causes the data does not give. Tables of figures stay with code.

A brief renders under the line "Model-written brief. The records below are the
source." In the section rows it is its own row with `provenance = model`, so a
retrieval index can rank it below the records.

What the gate does not catch: a sentence that cites a real source and misstates
it. That is why briefs are short, labeled, and few enough to read each week.

## Check questions

Each pack's section rows end with about ten rows of kind `check`: questions with
known answers, generated by code from the same metric rows, timeline events and
record counts, each saying which file can answer it. They never appear in a
markdown document. Run them with no context, with base, with brief, and with base
plus retrieval, to score a model before trusting it with the pack.

## Deep records for more companies

`scripts/history-backfill.mts` takes `--company=<slug>` on every `self-*` phase.
A company other than the reader organization gets checkpoint keys prefixed with
its slug, and records are unique per company, so one article can be a record of
two companies. Run `--dry-run` first and read the matched patent applicant and
OpenAlex institution: both match on a name, and the registry name is the brand
while the applicant is usually a legal entity. Overrides:
`--applicant="..."`, `--institution="..."`, `--institution-id=I123`.
`--skip-summarize=patent,paper` files those sources by rule with no model call.

Per company: 184 Tavily credits (45 months x 4 queries, plus 4 regulator
searches) and the model spend of three legs (filing summaries, a timeline call
per year, one profile call).

## Files

| File | Role |
|---|---|
| `lib/context-pack/core.ts` | pure: blocks, tiers, section rows, check questions, the brief gate |
| `lib/context-pack/load.ts` | the one DB reader, injected query function |
| `lib/context-pack/briefs.ts` | the weekly model leg |
| `lib/mutations/context-pack.ts` | the one writer |
| `app/datasets/briefcase/page.tsx`, `components/briefcase/*` | the page and the hub band |
| `app/api/datasets/[slug]/route.ts` | the `format=md` branch |
| `scripts/render-context-pack.mts` | local render with exact token counts |
| `scripts/context-pack-briefs.mts` | write briefs by hand |
| `scripts/test-context-pack.mjs` | the pure tests |
