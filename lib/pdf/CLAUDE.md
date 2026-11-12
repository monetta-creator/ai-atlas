# PDF rendering (react-pdf)

Shared PDF chrome is `lib/pdf/shell.tsx` (`PdfCover`).

## Rules
- Registered font families are `Anton`, `Schibsted`, `JetBrains` (in `lib/pdf/shell.tsx`), not the Google names. An unregistered family 500s the whole PDF.
- Every PDF route must be listed in `next.config.ts` `outputFileTracingIncludes`, or its fonts 500 in production.
- Unwrap `<code>` before rendering: the shell sets it in JetBrains and the fontkit ligature crash applies.
- A `flex: 1` child inside the content-sized page body measures 0 tall (every row paints on one line, the page spills onto a second one). 16:9 slides need fixed heights + `overflow: 'hidden'`.
