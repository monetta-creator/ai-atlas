# Widget boards (lobby and /ops)

Two admin-customizable widget boards: the lobby (`board = 'home'`, leans public) and `/ops` (`board = 'ops'`, admin). Layout is global, not per viewer.

## Files
- `lib/widgets/catalog.ts`: widget metadata (key, name, desc, `access`, `span`, `boards`), `DEFAULT_BOARD_WIDGETS`, `catalogFor(board)`, `isWidgetOnBoard`. `DEFAULT_WIDGETS` is the fallback when the row is empty or missing.
- `components/lobby/WidgetBoard.tsx` and `components/lobby/CustomizeWidgets.tsx` (client; drag, up/down, add, remove). Both take `board` and pass it to each widget.
- Component maps: `HOME_WIDGET_COMPONENTS` in `components/lobby/widgets/registry.tsx`, `OPS_WIDGET_COMPONENTS` in `components/ops/widgets/registry.tsx`, joined in `components/widgets/all.tsx`. Ops widgets live in `components/ops/widgets/*`.
- Lobby page `app/page.tsx` (`force-dynamic`, no `maxDuration`): greeting, `LobbyAsk` launcher (client; routes `?q=` into `/ask`; `ExamplePill` typewriter), then the board.
- Styles: `.lw-*` / `.lwc-*` block in `app/styles/lobby.css`.

## Data
- Table `board_prefs` (mig `0075`), one row per board `home` | `ops`. It replaced the `home_prefs` singleton (mig `0045`), which seeded it.
- `getBoardWidgets` / `setBoardWidgets` / `saveBoardWidgetsAction(board, keys)`.
- Legacy `home_prefs` singleton accessors `getHomeWidgets` / `setHomeWidgets` / `saveHomeWidgetsAction` remain in the data layer; new work goes through the board functions.
- Widgets with `access:'admin'` are hidden from guests. Bare tile chrome uses `.lobby-tile`.
- A drift guard drops keys no longer in the catalog (the eight `tile-*` widgets are retired).

## Home catalog
- `edition-front` (latest edition lead + three more), `savant-latest` (`SavantCover` miniature + title), `portal-tiles` (one compact row over `PORTAL_GROUP_KEYS`, Savant included, plus All portals), `fresh-across-portals` (new tools, papers, signals), `hypotheses-ledger` (Savant's open hypotheses, statement + status), `atlas-stats`, `add-document`, latest-signals.

## Ops catalog
- `cron-tracker`, `ops-timeline`, `ops-model-runs`, `ops-agent`, `ops-jobs`, `ops-spend`, `desk-counts`, `todays-spend`, `tavily-quota`, `ops-savant-week`, `ops-history`, `ops-background`.
- Daily-jobs tracker: `getDailyJobStatus` in `lib/data/readiness.ts` (not `handoff.ts`: `lib/*/handoff.ts` already means importer orientation docs). Per-job state over today's scan/pipeline/intel runs: the row wins, then paused / off (weekend) / pending. ET finish times; the ready headline counts only jobs that ran; firewall dataset download chips when ready.
- `todays-spend` uses `getSpendWidgetData`. Forecast is a 14-day zero-filled mean x 30, NOT `computeForecast` (import cycle).

## Access & guest safety
- Guests get the same order minus `access: 'admin'` widgets. Filter in `WidgetBoard` BEFORE their data is fetched.
- `savant-latest`: guests see the teaser only.
- `hypotheses-ledger`: scrub intel-registry names for guests.

## Rendering rules
- Every widget streams in its own Suspense slot in `WidgetBoard` (`.lw-skel` placeholder), so one slow widget delays only itself.
- Boards never poll; they read fresh on page load. Don't add a `router.refresh()` timer.
- `getOpsStatus`, `getOpsBackground`, `getDailyJobStatus` are React `cache()`d because several widgets read them in one render. Uncached, four `getOpsStatus` calls made the page take 10s in dev.
- `countMissingEmbeddings` is one id-only anti-join over `EMBED_SOURCES` (`lib/embed/sources.ts`); excluded empty text uses `<> ''` (never detoasts). Don't pull record text for a count (it was ~93 MB, 6-7 s).
- `getTavilyQuota().capHit` reads only each engine's latest run; month-long reads kept an old outage flagged.
- `GET /api/ops/status` stays for scripts.
