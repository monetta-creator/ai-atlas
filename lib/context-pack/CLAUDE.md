# The Briefcase: company context packs

Everything public the Atlas holds about one tracked company, packed for a model that runs where the Atlas cannot reach (the firewalled internal app, on open-weight models). Lives at `/datasets/briefcase`, the Briefcase tab of the Data Portal. Migs `0080`-`0081`.
Full write-up: docs/context-pack.md

## Outputs
- Three downloads per company from ONE input:
  - Base: markdown, 10k-token budget, standing context.
  - Brief: markdown, 50k, one deep task.
  - Sections: JSON rows of about 2k tokens, the retrieval corpus.
- No 200k prompt tier: the destination has FTS + vector retrieval and open-weight models recall poorly mid-context.
- Dataset `context-pack`: key-gated, heavy, `markdown: true`, `filters.company`; one row per section.
- Also `?format=md&company=<slug>&size=base|brief` on the datasets route. It is the only `markdown` dataset; an unknown format on any other dataset is still CSV.
- `company-record` takes `?company=`.

## Files
- `lib/context-pack/core.ts` (pure): `buildBlocks` → `fitTier` (priority fill that never splits a line) → `renderTier` (numbered references + a Sources list); `buildSections` (groups by year/month/dimension, splits at `CORPUS_ROW_TOKENS`); `buildChecks` (about ten code-generated questions with known answers per company, rows of kind `check`, never in a prompt file); `gateBrief`; `estimateTokens` = chars / 4 x 1.3 (9.6k estimate vs 9.0k exact o200k on the base pack).
- `lib/context-pack/load.ts` (DB half): injected `Q`, seven batched queries for any number of companies. Selects `public_blurb`/`public_profile` and NEVER `notes`/`dossier`. `intel_metrics` only by curated code + company.
- `lib/context-pack/briefs.ts`: weekly section briefs.
- Styles `.bc-*` in `app/styles/briefcase.css`.

## Deep vs light
- Derived, not configured: a company is deep when `self_record` rows exist for it. Light packs come from intel items/facts/metrics and say so.
- Deep records for peers: `scripts/history-backfill.mts --company=<slug>` on every `self-*` phase. Checkpoint keys are prefixed with the slug for any company but the reader organization (whose bare keys are unchanged). `self_record` is unique on `(company_slug, url)` (mig `0081`).
- Flags: `--applicant`, `--institution`, `--institution-id` (USPTO and OpenAlex match on a legal name and OpenAlex types some banks `other`); `--skip-summarize=patent,paper` files by rule.
- Every reader of `self_record`/`self_timeline` must filter on `company_slug`, so a peer's record cannot enter Savant's reader-organization block.

## Weekly section briefs (the one model-written part)
- Feature `context_pack_brief`, Haiku, table `context_pack_briefs`, `CONTEXT_PACK_WEEKLY_BUDGET_USD` 1, about one cent a section. Deep companies only.
- Cron `/api/cron/context-pack` Mondays 17:40 UTC; by hand `scripts/context-pack-briefs.mts`.
- Gate: keeps only links to the section's own URLs, drops any sentence stating a figure the section's lines do not state (checked against the lines with their URLs removed), caps at 140 words, refuses a brief with no surviving link.
- Rendered under a fixed label and shipped as `provenance = model` rows.
- Never write a brief for `metrics` or `peers`: a model compared two different asset series as one and invented causes. Figures stay with code (test-asserted).

## Access & guest safety
- Key-gated downloads. Nav leaf `Briefcase` under Data Portal is `access: 'public'`: guests get the explainer + unlock, never a company name.

## Tests and tools
- `scripts/test-context-pack.mjs`.
- Local render with exact token counts: `npx -y tsx scripts/render-context-pack.mts <slug | self | all>` (writes to the untracked `private/out/context-pack/`).

## Landmines
- A long-running `next dev` can keep serving a CSS bundle that lacks a newly imported sheet; restart it before judging styles.
