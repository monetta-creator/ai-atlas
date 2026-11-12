# Reports (Report Portal and period reports)

Report Portal at `reports/page.tsx` (public) plus the admin period-report generator. Guests see published items only; admin also sees drafts.

## Pages and routes
- `reports/page.tsx`: the Report Portal, `maxDuration = 60`.
- `reports/period/page.tsx`: admin period-report generator (`ReportGenerator` + `ReportPreview`), `adminGate`, `maxDuration = 60`. `/report` is a param-preserving redirect stub.
- `reports/sheet/[id]/page.tsx` + `.../pdf/route.ts`: generated-report read view + branded PDF. Public once published, admin as draft, else 404.
- `reports/[id]/page.tsx` + `.../pdf/route.ts`: PUBLIC read-only view of a saved period report (`ReportReadView`, HTML re-sanitized on render) + branded period PDF (`lib/pdf/period-doc.tsx`). Period reports have no publish gate.
- `thesis-report/[id]/pdf/route.ts`: public branded thesis PDF, linked from the report header's primary Download button, the console's save-success line, and each Saved-runs row.

## Period report generation
- Pick a date range + lenses. `buildReportData` assembles the data half.
- `lib/report-generate.ts` runs one `runStructured` narrative call per lens plus a synthesis pass (analyst voice, markdown to HTML via `marked`).
- Admin edits, then saves (`saveReportAction` into the `reports` table) or exports to PDF (`ReportPrint`).

## Cover grid
- ONE five-wide grid for every report family: generated sheets (incl. roundup + `tooling_*`), period reports, thesis reports, and decks. `components/reports/ReportGrid.tsx` (client), 4/3/2/1 columns at 1279/1023/767/479px, 15 per page.
- Each card is a cover-page preview, `ReportCover`: a CSS miniature of `PdfCover` in `lib/pdf/shell.tsx`. Paper-white in both themes because it previews a PDF, `cqw`-scaled inside a `container-type: inline-size` box, DRAFT ribbon for unpublished.
- Savant previews as its cobalt cover (`SavantCover`, issue number from the `issue_number` meta projection). The company intel deck previews as an inverted dark 16:9 slide (`IntelDeckCover`).
- Card content: kind kicker, title, subject, stat chips, date, PDF button; admin publish/unpublish/delete beneath.
- Search (title/subject/kind/abstract/chips substring), kind chips (All · Claim · Bridge · Lens · Executive briefing · Research roundup · Tooling · Period · Thesis, plus Drafts for admin) and the pager run client-side over the server-assembled card set. Mirrored to `?q=&kind=&page=` via `history.replaceState`; the page reads the same params to seed SSR.
- Admin's SheetConsole generator sits in a "Generate a report" `<details>` (open when `?generate=` is present). `SheetRow` survives only on the single-sheet read view.

## Data and guest safety
- Projection is pure: `lib/reports/cards.ts` (`toSheetCard`, `toPeriodCard`, `toThesisCard`, `filterCards`, `paginate`).
- `listGeneratedReports` projects only `narrative->>'bottomLine'` + `pack->'stats'`/`'health'` (guest-safe). Keep it that way.
- `listGeneratedReports(..., { toolingDraftsForPortal })` lets keyholders see tooling drafts here.

## Decks (fourth family)
- `lib/reports/decks.ts`: a static registry. Admin-only: cost deck `/costs/deck`, ingestion "1000x" deck `/ingestion/deck` (numbers rebuild on open). Public: the education guide decks.
- `visibleDecks(admin)` filters admin decks server-side.
- `toDeckCard` gives kind `deck`, a landscape dark-framed `DeckCover` title-slide preview with a "16:9 deck" tag, an Open button beside PDF, a "Decks" chip, and `sortDate ''` so `sortCards` places them after every dated report.

## Styles and tests
- Styles `.rp-*` in `app/styles/reports.css`.
- Test: `scripts/test-reports-cards.mjs`
