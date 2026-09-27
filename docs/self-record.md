# The reader organization's public record

The Atlas is written for people doing AI transformation inside one regulated financial institution: the intel registry's `self` tier. Its name comes from the database and never appears in code, docs or public copy. This record, built once on 2026-09-27 by `scripts/history-backfill.mts` (Part B), gathers what is publicly available about that organization since ChatGPT's launch (2022-11-30), so Savant and its readers can talk about it from cited public sources rather than a one-line description.

**Public data only.** Every row links a public document. Nothing internal, licensed or confidential enters it, and every sentence built from it must cite a row.

## What it holds

| Source | Phase | How | Key |
|---|---|---|---|
| SEC filings (10-K, 10-Q, 8-K, proxy, annual report) | `self-sec` | the full submissions history since 2022-11-30; AI paragraphs extracted deterministically into `ai_passages` | none |
| Press releases | `self-sec` | the exhibit 99 attached to each 8-K | none |
| Merger filings (S-4, 425) | `self-sec` | recorded as `merger` | none |
| News and newsroom | `self-news` | Tavily news per month with the exact quoted name, plus the company's own domain; URL-deduped against the intel engine's items | Tavily |
| Research | `self-research` | OpenAlex works credited to the institution (resolved from the name) since 2022-11-30 | none |
| Patents | `self-patents` | the USPTO Open Data Portal's patent search by first applicant and grant date (PatentsView's API moved there on 2026-03-20; the ODP carries title, grant date, applicant and CPC codes but no abstract); AI patents flagged by CPC G06N or AI terms in the title and recorded one row each, all grants counted per quarter | `PATENTSVIEW_API_KEY` (an ODP key) |
| Enforcement and merger orders | `self-regulatory` | searches restricted to regulator domains (OCC, Federal Reserve, FDIC, CFPB, DOJ, FTC); a page must name the organization to be kept | Tavily |
| Comment letters | `self-regulatory` | regulations.gov comments whose title starts with the organization's name (a plain name search returns hundreds of consumer comments that only mention it), each with its docket title and the attached letter's text | `DATA_GOV_API_KEY` |
| Congressional hearings | `self-regulatory` | govinfo, collection CHRG only (court opinions are dominated by consumer suits), naming the organization alongside AI; the filing pass then drops hearings that only mention it | `DATA_GOV_API_KEY` |
| CFPB complaint history | `scripts/backfill-intel-metrics.mjs --months=46 --only-source=cfpb` | extended back to late 2022 in `intel_metrics`, same table and code as the live engine | none |

`self-summarize` then files every row with the utility model: whether it is really about the organization (off-topic news is deleted; filings, papers and patents are kept), whether it concerns AI, an intel dimension, and a one- or two-sentence factual summary.

## What it produces

- **The AI timeline** (`self_timeline`, phase `self-timeline`): per year, Sonnet reads every non-patent AI record (up to 140, spread across the year) plus an even sample of 24 AI patents and the year's patent count by quarter, and writes 8 to 25 dated events, each citing at least one record; the patent stream gets at most two events. A thin year from a rich record set is retried once. Events whose citations do not resolve are dropped (`validateTimeline`). (Feeding the first 160 rows by date let a thousand patents crowd out everything after spring.)
- **The cited profile** (`intel_companies.public_profile`, phase `self-profile`): 8 to 15 sentences over the timeline and the latest annual report's AI passages, each with its record ids (`validateProfile`). Savant reads it in place of the empty one-line `public_blurb`; `public_blurb` stays the maintainer's own line.
- **The page** `/savant/record` (keyholders and admin): the profile, the timeline by year, and the filterable record list.

## How it connects to the other paths

| Path | Holds | Relationship to the record |
|---|---|---|
| The registry row (`intel_companies`, tier `self`) | identifiers (ticker, CIK, FDIC cert, RSSD id), aliases, domain | the key every record source queries by |
| The intel engine (daily since 2026-08-30) | news, filings and extracted facts in `intel_items` / `intel_facts` | the record covers the years before the engine; news is URL-deduped against it, nothing is copied |
| `intel_metrics` | FDIC and Y-9C since 2016, SEC XBRL since 2006, CFPB complaints | numbers stay there; the record holds documents and events |
| `intel_companies.dossier` | a model-written summary, refreshed Mondays | admin and the key-gated intel dataset only, never in a prompt; `public_profile` is the cited successor for prompts |
| Savant | the peer table and the reader-organization context in its prompts | reads the profile and the latest timeline events; its citation allow-list admits every record URL, so a sentence about the organization can link its source (which the editor check already requires) |
| The Daily Edition, Ask, datasets | self news via the intel engine | unchanged; the record is not embedded for Ask and is not a dataset |

## Rebuilding

Every phase is idempotent; a unit skipped for a missing key runs once the key exists. To refresh the synthesis after adding sources: run the source phase, then `self-summarize`, `self-timeline`, `self-profile`. The two keys are needed only where the script runs (locally), never on Vercel. The timeline phase replaces the organization's events wholesale; the profile phase overwrites `public_profile`.
