# The Atlas Agent

The resident operator (`/agent` + the rail orb, migration `0056`). All four layers are admin-only.

## Sensors
- `lib/agent/checks/{queues,engines,editorial}.ts`: about 26 deterministic SQL checks.
  - queues: draft backlog, tooling/scout/research queues, tickets, unpublished reports, stale gap recs, coverage misses.
  - engines: daily-job failures, missed days, paused engines, budgets near cap, Tavily quota, retained-text coverage, zero-yield domains, missing roundup/entrants reports, run-note errors.
  - editorial: claims with evidence outrunning their confidence, one-sided claims, dangling touch codes, stale question summaries, sources without priors, stale gap scans.
- `runChecks` (`lib/agent/runner.ts` + pure `lib/agent/reconcile.ts`) files findings into `agent_findings`: upsert by key, auto-resolve when a check stops firing, snooze/ack states.
- A throwing check is not a quiet check: `runChecks` catches and logs it, records its key in a `failed` set, and the reconciler leaves that check's existing findings alone instead of resolving them. The checks carry no try/catch; the runner is the one boundary.

## Hands (`lib/agent/remedies.ts`)
- An allow-list of remedies mapped to existing library functions, in three tiers:
  - `auto`: reversible, no guest-visible change, never creates a run. Archive no-touch drafts older than 3d, promotion sweep, refetch missing text, dedupe scan, resume a FAILED run in weekday engine hours.
  - `propose`: the maintainer taps Do it or asks in chat. Archive low/stale, kick or enable an engine, generate the missed roundup/entrants report, regenerate a question summary, gap diagnoses, research/scout agent chunks, resolve a ticket.
  - `never`: confidence, publishing outside the policy, merges, deletes.
- `executeRemedy` guards tier, actor, the 00:00-09:00 UTC blackout for run creation, `checkAgentBudget`, and a 12h per-finding cooldown. It logs every call to `agent_actions`.
- Budget: `agentCapUsd()` in `lib/agent/budget.ts`, env `AGENT_DAILY_BUDGET_USD` default 0.25, floor 0.05.
- Today's spend is defined ONCE in `getAgentSpendToday`: `ai_cost_log` rows tagged `agent_brief`/`agent_chat` plus `agent_actions.cost_usd`, because remedies log under their callees' own features.

## Brain
- GLM by default; `agent_prefs.chat_model` / `brief_model`. `lib/agent/prompt.ts` holds the persona and standing rules.
- `lib/agent/brief.ts` `runDailyBrief`: one `routedStructured` memo per UTC day into `agent_briefs`. Falls back to `buildDeterministicMemo` (pure `lib/agent/brief-core.ts`) when the budget is spent or the model fails. Emailed via Resend when `RESEND_API_KEY` + `AGENT_EMAIL_TO` are set (`lib/agent/email.ts`).
- `lib/agent/chat.ts`: provider-agnostic JSON step loop, at most 4 steps, 11 tools including `run_remedy` for propose tier only. NDJSON from `POST /api/agent/chat`.

## Surfaces
- `AgentOrb` in the rail's bottom island: badge = unread open findings, polls `GET /api/agent/pulse` every 60s. Opens `AgentDrawer` (Today / Findings / Activity / Chat + prefs).
- High-severity toasts, the mobile menu row, and `/agent` (`adminGate`) with the check registry and briefs archive.
- State comes from one `GET /api/agent/state`.
- Styles `.ag-*` in `app/styles/agent.css`.

## Crons
- `/api/cron/agent` hourly (`45 * * * *`).
- `/api/cron/agent/brief` at 12:30 UTC.

## Tests
- `scripts/test-agent.mjs`, `scripts/test-agent-brain.mjs`
