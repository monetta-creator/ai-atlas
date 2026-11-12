# Field Report (/field-reports/*)

Ask's research-report mode, an imprint under The AI Atlas, toggled in the Ask composer. For the admin and per-person keyholders. Migs `0078`-`0079`.
Full write-up: docs/field-report.md

## Access & guest safety
- Admin and per-person keyholders only. Never the legacy shared key: caps and ownership hang off the key id.
- Guests get a lock plate on `/field-reports/[id]`.
- A keyholder reads their own drafts and admin-published reports (`PORTAL_ONLY_KINDS`, `listGeneratedReports(..., { portal, keyId })`). Only admin publishes.
- Caps: $5 a key a day, $20 across keys (`field_report_prefs`, summed from `ai_cost_log` `field_report_%` rows); admin uncapped.

## Flow
- Composer toggle → `POST /api/field-report/plan` (`lib/field-report/plan.ts`): a quick Atlas scan, then one structured call returns an editable plan (title, objective, 3-5 sub-questions, considerations, Atlas focus, web gaps, out of scope, recommended size, Brief/Full estimate).
- Run → `POST /api/field-report/run`: answers at once and works in `after()`, `maxDuration = 800`. Progress on a `ui_jobs` row of kind `field_report` that the thread card polls.
- Each leg parks in `field_report_runs.legs`; a run near its deadline pauses and resumes.
- Legs in `lib/field-report/run.ts`:
  - atlas: one tool-loop track per sub-question over the Ask tools, portal mode for keyholders, adaptive thinking (Claude 5 refuses a fixed thinking budget).
  - web: `web_search`, Brief 4 / Full 12; result URLs captured as W ids.
  - write: fixed outline; the writer's own reasoning goes in `:::analysis` fences.
  - Full only: editor → one revise → figures.
  - save: `generated_reports` kind `field_report`, a draft with `created_by` (mig `0079`).
- Figures (`lib/field-report/figures.ts`): Savant's figure vocabulary; `validateFigures` is given this report's section keys. A compare chart must take every bar from one source and each number must sit in that source's footnote span (`checkCompares` in the pure core).
- Every paragraph carries a provenance label (Atlas / Web / Mixed / Analysis); any uncited paragraph is Analysis.
- Follow-ups in the same conversation send `fieldReportIds`; the Ask routes add the report as context (`lib/field-report/followup.ts`).

## Reading
- `/field-reports/[id]`: paper-white contour cover, deep-green accent, chips per paragraph, Appendix A per sub-question, Appendix B by title.
- `/pdf` route must stay in `outputFileTracingIncludes`.
- Desk `/field-reports/desk` (admin): models per role and size (research/writer/editor Anthropic-only), effort, web searches, caps, live estimate, recent runs.

## Tests
- `scripts/test-field-report.mjs`.
