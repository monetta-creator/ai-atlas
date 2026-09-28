# Field Report

Field Report is Ask's research-report mode (2026-09-28): an imprint under The AI Atlas that turns a question into a researched, cited, labeled report. It is the deep research of other platforms rebuilt on the Atlas: it reads the Atlas's own records first, goes to the web for what the Atlas does not hold, and says in every paragraph where the words came from.

## The flow

1. **Ask with Field Report on.** A toggle in the Ask composer (admin and per-person access keys; the legacy shared key cannot, because caps and ownership hang off the key id).
2. **The plan** (`POST /api/field-report/plan`, `lib/field-report/plan.ts`). One structured call, after a quick Atlas scan so the plan names what the Atlas actually holds, returns a title, a sharpened objective, 3 to 5 sub-questions, considerations the person did not raise, the Atlas material it will read, the web gaps it will search, what is out of scope, a recommended size, and an estimate for both sizes. The person edits any line and presses Run.
3. **The run** (`POST /api/field-report/run`, `lib/field-report/run.ts`). The route answers at once with a job id and runs in `after()`, which Next keeps alive for the route's `maxDuration` (800 s on Vercel Pro). Progress is a `ui_jobs` row of kind `field_report`, so the Ask card, the rail indicator and the completion toast all follow it, and it survives a closed tab. Each finished leg is parked in `field_report_runs.legs`; a run that nears its deadline pauses, and the same route resumes it from the next leg.
4. **The report** is saved as `generated_reports` kind `field_report` (draft, `created_by` set), shown as a card in the Ask thread, read at `/field-reports/<id>`, and downloaded as a PDF at `/field-reports/<id>/pdf`.

## The legs

| Leg | What it does | Feature slug |
|---|---|---|
| atlas | one research track per sub-question with the Ask tools (search the Atlas, read records, search the article corpus); adaptive thinking; Full runs three tracks at a time; each track ends in a findings memo citing records by tag | `field_report_research` |
| web | one gap-fill pass with `web_search` (Brief 4, Full 12) aimed at the plan's web gaps and what the Atlas tracks found thin; every result URL is captured as W1, W2...; then a web memo citing those ids, with a "New considerations" paragraph | `field_report_web` |
| write | the writer turns the memos into the fixed outline (Summary, one section per track, New considerations, Where the evidence disagrees, What would change this view, Open questions); its own reasoning goes in `:::analysis` fences | `field_report_write` |
| editor (Full) | deterministic checks, then an editor review (verdict, required edits, cuts, a signed note) | `field_report_editor` |
| revise (Full) | one revision applying the edits; a revision that adds a number the draft never stated is thrown out | `field_report_revise` |
| figures (Full) | after the text is final, Savant's figure vocabulary (entity cards, a two-axis map, a relation diagram, a timeline, compare bars, steps) planned over this report's own sections; the catalog is only what the text cites; a figure naming any other href is dropped whole; a compare chart must take every bar from ONE source, and each bar's number must appear in the text that source's footnote covers (the run since the previous link), because the first live run charted three benchmark scores its own text called incomparable; a failed figure leg costs the report its figures, never the report | `field_report_figures` |
| save | tags become numbered links, every paragraph is labeled, the citation gate runs, the report is saved | none |

Thinking: the Claude 5 models take `thinking: {type: 'adaptive'}` plus `output_config.effort` (measured 2026-09-28: a fixed thinking budget is refused; adaptive works with client tools, web search and forced tools). Older model ids run without thinking.

## Provenance

Every paragraph carries one of four labels, shown as a chip and summed into a bar across the report:
- **Atlas**: cites Atlas records only.
- **Web**: cites web sources only.
- **Mixed**: cites both.
- **Analysis**: the Atlas's own reasoning. This covers anything the writer fenced as analysis, and also any paragraph with no citation at all, so nothing unsourced ever reads as sourced.

## Access and money

- **Runs:** the admin and per-person keyholders can run Field Reports. Admin is uncapped. A keyholder is capped at `field_report_prefs.key_daily_usd` ($5) a day, and all keys together at `all_keys_daily_usd` ($20). Both are summed from `ai_cost_log` rows `field_report_%` carrying `metadata.portal_key_id`. A keyholder over a cap mid-run skips the web and editor legs and still gets a report.
- **Research scope:** keyholder runs research in portal mode, so no admin-only material reaches their report.
- **Reading:** the creator and admin can read a draft. Once admin publishes, every keyholder can read it. Guests never can.
- **Not embedded:** Field Reports never enter Ask's shared corpus.
- **Cost per run:** every call carries `metadata.field_report_run`, so a run's cost is exact even when two runs overlap.

## Reading it

- **Read view** `/field-reports/<id>`: paper-white contour cover, the plan's sub-questions as contents, a provenance bar, one chip per paragraph, figures after the paragraph they illustrate, the editor's note, Appendix A (per sub-question: searches, records read, the distinct queries; the full step log folds away) and Appendix B (every cited source under its own title; record titles are looked up when the run resolves its links).
- **PDF** `/field-reports/<id>/pdf`: the same, Letter. Each section heading travels with its first paragraph, and every unbreakable group is a direct child of the page (nested `wrap={false}` views made react-pdf draw a moved group over the figure after it). The bundled fonts carry no Greek, so letters like τ are spelled out.
- **Follow-ups** in the same Ask conversation send the report ids; the Ask routes add the report's summary and sections as context (`lib/field-report/followup.ts`), under the same read rule.
- **Desk** `/field-reports/desk` (admin): the enabled switch, model pickers per role and size (research, writer and editor call the Messages API directly, so those pickers offer Anthropic models only), effort, web searches, both caps, a live estimate, and recent runs.

Measured 2026-09-28: a Brief ran 227 s for $0.66; a Full ran 341 s for $1.72, plus about $0.05 for figures.

## Files

| Area | Files |
|---|---|
| Engine | `lib/field-report/core.ts` (pure, tested by `scripts/test-field-report.mjs`), `store.ts`, `access.ts`, `plan.ts`, `research.ts`, `write.ts`, `figures.ts`, `followup.ts`, `run.ts`, `allowlist.ts`, `contour.ts` |
| Routes | `app/api/field-report/{plan,run,[runId]}` |
| Reading | `app/field-reports/*`, `components/field-report/*`, `lib/pdf/field-report-doc.tsx` |
| Ask cards | `components/ask/FieldReport*` |
| Publishing | `lib/actions/field-reports.ts` |

Migrations `0078`-`0079`.
