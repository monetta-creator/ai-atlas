# Ask workspace

Ask is the chat surface over the whole corpus, with citations. Public page in the main nav; the app's ONE viewport-height layout (`.ask-*` CSS block). Retrieval internals (embeddings, fusion, sim bars) live in `lib/embed/CLAUDE.md`.

## Surface and modes
- `ask/page.tsx`, `AskWorkspace` + `components/ask/*`.
- Mode by auth: `admin` uses the research loop at `/api/ask/deep` on EVERY turn; `portal` uses `/api/portal/ask` (the quick path, budget reasons); `locked` gets an inline unlock.
- Quick `/api/ask` stays for the per-signal widget (`AskAtlas` on `/signals/[id]`, shared renderer `components/ask/answer.tsx`, `/api/signals/[id]/ask`).
- Conversations: localStorage is the working copy (`components/ask/store.ts`), mirrored to the server for admin and access keys (`lib/conversations/store.ts`, migration 0087, debounced PUT snapshots).
- The multi-turn wire contract lives in `lib/ask/history.ts`. Signal-tag offsets prevent cross-turn citation mislinks.

## Access
- `/api/ask`, `POST /api/ask/deep` (`maxDuration = 300`, NDJSON), `POST /api/ask/verify`: admin-gated, OFF the proxy allow-list.
- `/ask`, `/api/ask/peek`, `/api/ask/doc`: ON the allow-list.
- `GET /api/ask/peek` is public, guest-safe payloads from `lib/ask/search.ts`. Citation chips open `AskPeek`.
- `GET /api/ask/doc` (`AskDoc`, the document viewer on signal peeks) is allow-listed but `isPortal()`-gated in-route. Retained text with question-term highlights, admin/portal only.
- `/api/ask/verify` backs the "Check this answer" button on quick-Ask answers.
- Deep route has an always-on two-layer faithfulness check on every answer.

## Web search
- The one composer toggle, wired into BOTH paths. The deep loop takes the raw `web_search_20250305` tool (max_uses 3).
- `askSystem(web)` in `lib/ask/prompt.ts` REPLACES the records-only scope paragraph rather than appending a contradiction. `queryBlock`/`deepQueryBlock` carry web-aware closing instructions (without them: a silent no-search bug).
- Capture server-tool result blocks for the sources strip. Drop pre-search narration: only text after the last `web_search_tool_result` block is the answer.
- With web on, missing-figure checks soften: searched page text arrives encrypted, so `VerifyReport.webSearched` marks them possibly-web-sourced instead of flagged.
- Web sources are collected once by `createWebSourceCollector` in `lib/ask/history.ts` (stream events AND finished-message blocks).

## Cost report
- Every turn ends with an `AskCost` footer (USD, tokens in/out, searches, model calls, expandable token explainer).
- Quick routes ride an `@@ASK_COST@@` sentinel line before the web-sources one. The deep route sends an NDJSON `cost` event.
- Priced by `priceUsage` in `lib/cost.ts` (same frozen rate-card math as `recordApiCall`).

## Rendering and leans
- Kind-tinted citation pills `.ask-cite[data-kind]`. Answers render as a Markdown subset (`lib/ask/md-blocks.ts`, `.ask-md-*`): paragraphs, `#`-`###` headings, bullet and numbered lists, GFM tables, rules, inline `**bold**`; citation chips work inside every block, table cells included. Raw HTML, links and images stay literal. The old quick/deep prompts still ask for bold-only; v2 lets the model pick the shape (`SHAPE` + `FORM_REMINDER` in `lib/ask/prompt-v2.ts`).
- The deep prompt requires a "One reading:" prefix plus the strongest opposing record. The verifier's `verdict_language` field surfaces unlabeled verdicts as caution lines.

## Retrieval (Ask side)
- `expandVocabulary` in `lib/ask/history.ts` maps street terms to Atlas terms ("open source" to "open-weight", "beating" to "parity").
- Length-normalized: `ts_rank(..., 1)` on the long-document legs.
- Signal/evidence-weighted: 2 round-robin slots each, `MAX_DETAIL` 11k, claim to evidence expansion on the FTS path, relevance-ordered signal expansion.
- The shared `ORQ` tsquery lives in `lib/pack-shared.ts` (one copy for retrieve/search/thesis-pack).

## Lanes
- Every turn is classified in parallel with retrieval: `classifyQuestion` in `lib/ask/classify.ts`, feature `ask_classify` on the utility model. The classifier sees the previous user turn too, so a bare follow-up classifies on-beat.
- `decideLane` (`lib/ask/lanes.ts`) combines the beat with retrieval's `hitCount`/`maxRank`/`explicit` into `covered` / `thin` / `adjacent` / `unrelated`.
- Rank bars: `STRONG_RANK` 0.06 covers alone, `MID_RANK` 0.03 covers when the beat is atlas, `WEAK_RANK` 0.02 is the noise floor below which an off-beat question declines. Hit counts are noise (pasta matched 24 blocks), never use them alone.
- A thin or adjacent answer orients from the records (or says plainly the Atlas does not track this), then writes an `@@BEYOND@@` marker on its own line before anything from the model's own knowledge or the web (labeled as such). The verifier only checks the text above the marker.
- The marker instruction rides in the system prompt AND as a `laneReminder` in the user turn: Haiku ignores the system-prompt copy alone.
- Thin/adjacent lane with web on: the deep route routes the answer through its forced final (one extra call), because an answer written in the same turn as the searches puts web findings above the marker.
- Lane transport: quick routes use an `X-Ask-Lane` response header; the deep route emits a `lane` NDJSON event first.
- An opening question declines only when the classifier says unrelated AND retrieval is under the MID bars (was STRONG until 2026-11-12: the classifier flips on short vague on-beat prompts like "agents and banks").
- `unrelated` short-circuits to a coded decline (`composeDecline`, no model call, no cost row): `@@ASK_DECLINE@@` sentinel on quick routes, a `decline` NDJSON event on deep.
- A fresh, non-covered question auto-enables web search for that turn even with the toggle off.

## Shared plumbing
- `resolveLane(msgs, { mode, tagStart?, classifyFeature? })` in server-only `lib/ask/resolve-lane.ts`: namespace + retrieval + classifier in parallel, then `decideLane`, auto-web, decline. `laneHeaders` for quick-route headers.
- `streamQuickAnswer` in `lib/ask/quick-stream.ts`: the quick routes' whole stream leg (web tool, cost sentinel, web-sources sentinel, `recordApiCall`). Also used by `/api/signals/[id]/ask`.
- Pure lane helpers (`beatDescriptionFrom`, `questionLinksFrom`, `cleanTopic`, `parseLane`, the rank bars) live import-free in `lib/ask/lanes.ts` so the test can load them.
- The one `deDash` for streamed text is exported from `lib/voice.ts`.

## Landmines
- Stream accumulator (resolved 2026-11-11): the old pinned SDK (0.100.1) collapsed `finalMessage().content` to bare text on a `messages.stream` call with `web_search`. On `@anthropic-ai/sdk` 1.8.0 `finalMessage()` keeps `server_tool_use` and `web_search_tool_result` blocks (`scripts/check-sdk-stream.mts`, one live call). The deep route still reads web sources from the RAW `streamEvent`s, which works on both. SDK 1.x sends API version `2026-10-21`: `temperature`/`top_p`/`top_k` now 400 on every model; nothing in the Ask paths sends them.

## Tests
- `scripts/test-ask-lanes.mjs`
- `scripts/test-md-blocks.mts` (the Markdown block grammar)
- v2 (redo): `scripts/test-ask-v2.mts`, `test-ask-loop.mts`, `test-ask-chips.mts`, `test-ask-budget.mts`, `test-conversations.mts`; live smokes `smoke-ask-loop.mts`, `smoke-skills.mts`, `probe-v2-timing.mts`

## v2 prompt (redo)
- v2 reuses `askSystem` but `v2Grounding()` swaps its orientation-desk form rules (persona, "open with what the Atlas maps", "weave every kind", "end with adjacent records", the dataset pointer). Each swap's source string is asserted present in `test-ask-v2.mts`: edit `prompt.ts` and the test tells you a swap stopped applying.
- Per-turn instructions ride the user turn (`turnGuidance`: `FORM_REMINDER` + depth + clarify); Haiku follows them there, not deep in the system prompt.
- The capability roster must not invite closing suggestions: the UI already shows next-step chips, and the judge scores "/brief would serve" endings as flattery.
- Measure prompt changes on the test set (`private/answer-gold/dev-ids.txt`, about $0.80 a run) before the full 52.
