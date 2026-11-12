# Cron routes, schedules and hosting limits

Every `/api/cron/*` route gates on `CRON_SECRET`, not the admin cookie. Tavily/OpenRouter facts live in `lib/scan/CLAUDE.md`.

## Gate (`lib/cron/shared.ts`)
- Every cron route opens with `const denied = cronGate(req); if (denied) return denied;`. It checks the Bearer header (Vercel sends it) and fails closed when `CRON_SECRET` is unset: the routes refuse everything.
- `pingDeadman` (same file) sends the optional `HC_PING_URL_*` dead-man ping (e.g. `HC_PING_URL_TOOLING`). Tested by `scripts/test-cron-gate.mjs`.
- Never add a public API route without a gate marker or a `scripts/test-api-gates.mjs` EXEMPT entry.

## Schedule (`vercel.json`, 29 entries)
- Engines (scan, pipeline, intel, research), each with `/sweep` + `/sweep2` siblings and a 15:xx `/sweep3`: four weekday windows per engine.
- Single-shot Friday `roundup` (`/api/cron/roundup`, Fri 21:00 UTC).
- Tooling trio, Monday only: `/api/cron/tooling` 07:00, `/sweep` 08:20, `/sweep2` 17:00 UTC; `?kind=pull` advances a console-started pull headlessly.
- `/api/cron/context-pack` Mondays 17:40 UTC.
- `/api/cron/savant` weekdays 17:15 UTC; Friday `/api/cron/savant/issue` + `/sweep` + `/sweep2` at 20:00 / 20:20 / 20:40 UTC.
- `/api/cron/agent` hourly (`45 * * * *`); `/api/cron/agent/brief` 12:30 UTC.
- `/api/cron/edition` 16:45 UTC weekdays; `/api/cron/feeds` 20:30 UTC weekdays; `/api/cron/intel-deck` 16:20 UTC weekdays.
- The sixteen engine/roundup routes run weekday-daily; the tooling three run Monday-only.
- Registry of jobs: `lib/ops/registry.ts` derives from a bundled `vercel.json` import; `scripts/test-ops-registry.mjs` fails when a cron path is unlisted.

## Why four windows per engine
- 2 x 700s of function time is the real daily budget, not dollar caps. Scan and research overran two windows on ordinary volume (a Wednesday), and the Monday 3-day lookback overran earlier ones. Don't cut windows to save invocations.

## Durations and budgets
- Engine cron routes declare `maxDuration = 800` with a 700s work budget; agent/brief/edition/feeds/roundup routes 300. Scan route `maxDuration = 300`. Most other routes keep `maxDuration = 60`.
- Hosting is Vercel Pro: up to 40 crons, 800s fluid-duration ceiling.
- Env vars: `CRON_SECRET` (required for all cron subsystems); `SCAN_DAILY_BUDGET_USD` (default 1.50; past the cap the run completes unenriched); `RESEARCH_DAILY_BUDGET_USD` (default 1.00); `TOOLING_WEEKLY_BUDGET_USD` (default 4); `TOOLING_PULL_BUDGET_USD` (default 12); optional `PRODUCTHUNT_TOKEN` (API terms restrict commercial use; unset = source skipped); optional `GITHUB_TOKEN` (raises search rate limit); optional `HC_PING_URL_TOOLING`.

## Function-timeout rules
- Don't assume a hard ~60s Vercel cap: `maxDuration = 300` deploys and 290s streamed responses work (standing probe `/api/probe/duration`, admin-gated; results in `docs/data-portal-upgrade-paths.md`).
- Keep engine decomposition into short, DB-checkpointed steps anyway: it buys resumability and cheap retries, not platform compliance.
- When a single longer function is simpler, declare `maxDuration` up to ~300 and keep the SDK timeout below it.
- `runStructured` (`lib/dossier.ts`) stays single and non-web for latency and cost reasons.

## Operational rule
- Never smoke-test `/api/cron/*` between 00:00 and 09:00 UTC (20:00 to 05:00 ET). Day-keyed engines (scan, intel, research) treat any hit in that window as the new day's run and consume the next morning's run key. The pipeline's 06:00 UTC day boundary exists because of one such smoke test.
- Use each console's manual run instead (the pipeline's is cadence `manual`).
