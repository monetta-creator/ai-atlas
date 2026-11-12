# Claims & Theses (/map) and the theses workflow

`/map` is the lobby's Claims & Theses page, layered thesis-first as the deal workflow. `/theses/*` is the admin workflow.

## /map (`app/map/page.tsx`)
- Theses: admin sees the `ThesisStrip` desk (every ACTIVE thesis via `getThesisDesk()`, mapped or not, with gap flags + latest-run splits, each linking `/theses/[id]`). The section head carries `ThesisDraftBox` (statement + Create thesis; creates it unmapped and lands on its workflow page with the mapping form open). Guests get the report-anchored `ThesisTracker` (limit 8, links `/thesis-report/[id]` only).
- Claims ledger: `TopClaimsPanel` at limit 10 (evidence counts public, confidence word admin-only) beside admin `ConfidenceMovementPanel` (`getCalibration().moves`).
- The frame: six question cards, Bridges/Concepts chips in the section head, and (admin) the map-wide gap panel `ArgumentGapPanel` with prop-injected actions + `diagnoseArgumentGapsAction`. The page sets `maxDuration = 60`.
- Both thesis blocks sit in `.bs` wrappers; their styles are `.bs`-scoped in `home.css`.
- `home.hero.title` / `home.hero.lede` Editable defaults read "Claims & Theses"; code is the truth. `ShareNotice` for guests.

## Theses workflow
- `theses/page.tsx` (admin index), `theses/new`, and `theses/[id]` (admin, `maxDuration = 60`), a four-step arc:
  1. Edit the thesis: `ThesisForm`, "Map to Atlas claims" is recommend-only.
  2. Logic tree: `ThesisLogicTree` SVG (thesis, mapped claims/bridges with confidence bands, question chips; gap recs as dashed ghosts linking Start draft; narrow-screen list fallback). Data: `getThesisTreeData`.
  3. Thesis-scoped gap diagnosis: `theses.gap_scan` (mig `0036`); shared `ArgumentGapPanel` with `.bind(null, id)` actions. `diagnoseThesisGapsAction` grounds on `buildThesisPack` signals that touch no mapped claim. Gate: `validateGapRecommendations` in `lib/gaps-core.ts` with `requireRef: false`.
  4. Reports: `ThesisConsole`.
- Start draft rides `?gap=<code>&thesis=<id>`. The claim/bridge forms post a hidden `thesis_id`, and the create actions `appendThesisCode` so the rec self-clears.
- Claim/bridge pages carry "Theses tracking this claim" (`getThesesForTarget`). Guests link the latest public report only.
- Public thesis PDF: `thesis-report/[id]/pdf/route.ts`.
