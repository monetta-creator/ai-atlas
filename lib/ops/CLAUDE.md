# Operations (`/ops`)

Admin-only: the ONE status page for everything that runs in the background. It is a widget board with `board = 'ops'`; the board mechanics (layouts, editor, Suspense slots, registries) are in `lib/widgets/CLAUDE.md`.

## Registry
- `lib/ops/registry.ts` derives the schedule list from a bundled `import vercelConfig from '../../vercel.json' with { type: 'json' }`. Never an fs read: `vercel.json` is not in the serverless bundle.
- Groups the 29 cron paths into 14 jobs (family engine/publisher/sweep/agent/maintenance, day boundary, pause pref, dead-man env, console link).
- `scripts/test-ops-registry.mjs` fails when a `vercel.json` path lacks a registry entry or vice versa, so a new cron cannot ship unlisted.

## Data (`lib/data/ops.ts`)
- `getOpsStatus`, `getOpsHistory`, `getOpsBackground`: each job's latest run row (or generated report), today's fires in ET, spend vs cap (each engine's own budget checker), a 14-day grid, and the cron-less work (embedding hooks, promotion sweep, agent checks, late feed sweep).
- `getOpsStatus`, `getOpsBackground` and `getDailyJobStatus` are React `cache()`d because several widgets read them in one render. Uncached, four `getOpsStatus` calls made the page take 10s in dev.
- `countMissingEmbeddings` is one id-only anti-join over `EMBED_SOURCES` (`lib/embed/sources.ts`, the per-kind FROM/WHERE shared with the text fetchers). Empty text is excluded with `<> ''`, which never detoasts. Never pull embeddable records' full text for the count (about 93 MB, 6-7 s per load and per hourly agent tick).
- `getTavilyQuota().capHit` reads only each engine's latest run. Month-long reads kept an old outage flagged as "cap hit".
- `GET /api/ops/status` stays for scripts.

## Widgets (`components/ops/widgets/*`)
- `cron-tracker`
- `ops-timeline` (hourly jobs collapse to one line)
- `ops-model-runs` (active + recent `ui_jobs`)
- `ops-agent` (open findings by severity + the last brief)
- `ops-jobs` (job cards by family)
- `ops-spend` (`getSpendByFeature(7)` + budgets vs caps)
- `desk-counts`, `todays-spend`, `tavily-quota`
- `ops-savant-week` (notebook rows, week spend via `getSavantWeekSpend`, last issue)
- `ops-history` (14-day grid + recent run-note issues)
- `ops-background`
- The board never polls: it reads fresh on each page load. Don't reintroduce a `router.refresh()` interval.
- Component map: `OPS_WIDGET_COMPONENTS` in `components/ops/widgets/registry.tsx`.

## Tests
- `scripts/test-ops-registry.mjs`
