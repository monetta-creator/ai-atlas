<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.2.6) has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing routing/config code. Heed deprecation notices. Notably: middleware lives in `proxy.ts` (exports `proxy`, not `middleware`); `params`/`searchParams` are Promises you must `await`. There is no `middleware.ts`.
<!-- END:nextjs-agent-rules -->

# Maintainer note

- Session journal: `private/SESSION-LOG.md` (untracked; `private/` holds all maintainer-only material). Read it at session start and append each session's summary there, never here. Backlog: `private/docs/TODO.md`, top item = next step.
- **Cheap-execution mode**: Fable/Opus plans and reviews in the main session; well-specified implementation tasks go to the untracked `.claude/agents/executor.md` subagent (pinned `model: sonnet`). Keep gnarly debugging in the main session. There is no native `fableplan` split; re-check on CLI upgrades.
- **Operational rule**: never smoke-test `/api/cron/*` between 00:00 and 09:00 UTC (20:00-05:00 ET). Day-keyed engines (scan, intel, research) treat that hit as the next day's run. Use each console's manual run instead.

# How this file is organized

This root holds only cross-cutting rules and the surface index. **Each surface's rules, files, and landmines live in a `CLAUDE.md` inside its directory** (table below); Claude Code loads it when you read a file there. Before editing a surface's `app/` or `components/` files, read its rules file first.

**Growth rule**: a new surface gets ONE row in the index and its own nested `CLAUDE.md` (plus `docs/<surface>.md` for a long write-up). Never append narrative, history, or measurements to this file; history goes in `private/SESSION-LOG.md`.

# The AI Atlas

**An intelligence system for the AI economy, built on a map of the argument** (`ATLAS_ONE_LINER` in `lib/brand.ts`). Engines collect what happens in AI every weekday (news, filings, research, the tool market) and place each development on the **Argument Map** (`/map`: open questions, stances, falsifiable claims, bridge-claims, evidence). The Signal Board, Daily Edition, and Savant read that record; Ask answers over the whole corpus with citations. Written for people carrying AI transformation inside regulated financial institutions. A private **personal layer** (confidence, rationales, source priors) sits on a public **share view**. The goal is orientation, not proof: **the model proposes, the human commits.**

## Stack & how to run
- Next.js 16.2.6 (App Router, Turbopack; root pinned via `turbopack.root` in `next.config.ts`) · React 19.2.4 · TypeScript strict · Tailwind v4 (CSS-first, `@theme` in `app/globals.css`, no `tailwind.config`) · Supabase Postgres via the `pg` pool (no Supabase JS client).
- AI: `@anthropic-ai/sdk` plus OpenRouter for open-weight models. `unpdf` for PDF text (browser-side on upload forms; files are never stored). `three` for `/traceroute` only.
- Styles: `app/styles/*.css`, imported in cascade order from `app/globals.css`; the import order IS the cascade. See `app/styles/CLAUDE.md`.
- Setup: `npm install` → copy `.env.example` to `.env.local` → `npm run db:migrate` → `npm run db:seed` (resets every confidence to 0.50) → `npm run dev`.
- Scripts: `dev`, `build`, `start`, `lint`, `db:migrate` (`scripts/migrate.mjs`, tracks `_migrations`), `db:seed`, `db:seed:concepts` (separate because `db:seed` resets confidences), `db:seed:scan|intel|tooling` (overlay untracked `private/*.json` registries), `db:verify`. `scripts/test-*.mjs` run with plain `node`; anything importing `lib/*` (extensionless imports) runs via `npx -y tsx`. `scripts/test-loop.mjs` is a rollback-only smoke test of evidence → confidence → rationale → snapshot. All `.mjs` scripts load `.env.local` and use the direct `SUPABASE_DB_*` connection.
- The bar is a zero-warning `npm run lint`.

## Conventions
- **All DB access is server-side.** `lib/db.ts` owns a global `pg.Pool` as a role that bypasses RLS and throws if imported in the browser. Helpers `q()`, `one()`, `exec()`, `withTx()`. Never import `lib/db` into a client component. Postgres `numeric` parses to a JS number; `date`/`timestamptz` come back as `Date` (cast with `to_char` when a string is needed).
- **Auth** (`lib/auth.ts`): admin = signed HMAC cookie `atlas_admin` (`admin.<hmac>`; `checkPassword()` compares fixed-length HMAC digests, false when `ADMIN_PASSWORD` is unset); `isAdmin()` (`timingSafeEqual`) is the real security boundary, re-checked in components and server actions. `secret()` fails closed unless `AUTH_SECRET` is ≥ 32 chars. `atlas_guest`, `isPreview()`, `isEditMode()` are unsigned UX flags. `shareToken()`/`verifyShareToken()` back `/share`. Keyholder identity (`isPortal()`, `getPortalIdentity()`, `identityFromRequest()`) is in `lib/portal/CLAUDE.md`.
- **Gating pages**: every page renders sessionless and gates itself. An admin page's FIRST work is `const gate = await adminGate(pathname, title); if (gate) return gate;` (`lib/admin-gate.tsx`, renders `<AdminOnly>` with a link to `publicParentFor()`). Never an inline `isAdmin()` + `redirect` pair. The four Header-less pages (`/costs/deck`, `/ingestion/deck`, `/research/digest`, `/signals/digest`) redirect to `publicParentFor(pathname).href` instead. Route handlers check `isAdmin()` inline. `requireAdminPage()` exists for a caller that can't render a component; nothing uses it today.
- **`proxy.ts`** is open for pages. It fences only `/api/*` routes off the allow-list (`PUBLIC_API_PATHS` + `PUBLIC_API_PREFIXES` in `lib/route-shapes.ts`) without an `atlas_admin`/`atlas_guest` cookie, and rewrites malformed detail URLs to a real 404 (`isMalformedDetailPath`; a new `[id]` route's static siblings go in `UUID_ROUTES`). An in-page `notFound()` renders with status 200 + `noindex` because the root `loading.tsx` locks the status. A new public API route needs an allow-list entry AND a gate marker (`isAdmin(` / `cronGate(` / `identityFromRequest(` / `getPortalIdentity(` / `isPortal(`) or an EXEMPT entry with a reason in `scripts/test-api-gates.mjs`.
- **Personal layer stripped server-side** (`lib/data/*`, barrel `@/lib/data`; strippers in `lib/data/shared.ts`): `strip()` nulls `confidence`/`confidence_label`, `stripClaim()` also `domain_note`, `getEvidenceFor()` nulls `reliability_prior`/`note` for guests, `getQuestions(personal)` zeroes `contested_count`/`last_moved`, rationales are admin-only. **Guest mode IS the share view.** Page pattern: `const personal = (await isAdmin()) && !(await isPreview()); const data = await getX(slug, personal);`.
- **Guest-safety invariants**: the model's per-touch reason (`signals.touch_details`, copied into `evidence.excerpt` on publish) is admin-only everywhere: `getEvidenceFor` and `buildEvidenceLedger` null signal-anchored excerpts for guests, and only the key-gated `signals-export` ships it. Source-anchored excerpts (quoted passages) stay public; a touch's direction is public. Intel-registry company names never reach guests (key-gated surfaces, `scrubSentences` in Ask/widgets). Agent/scoring layers on Scout and Tooling are never SELECTed for guests.
- **Server actions** (`lib/actions/*`, one `'use server'` module per domain + a directive-less `index.ts` barrel + `shared.ts` for guards/parsers, never re-exported or client-imported): call `requireAdmin()` first, validate input (allow-listed enums, `UUID_RE`, `safePath()` against open redirects), write through `lib/mutations/*` (the only writer, barrel `@/lib/mutations`), then `revalidatePath('/', 'layout')`. Some AI actions are typed-arg and return data instead of redirecting (pipeline step actions, `prepareSignalFromSourceAction` / `overrideAndApproveAction`).
- **Model calls**: non-web structured calls go through `runStructured` in `lib/dossier.ts` (one forced-tool call returning validated JSON; default `claude-sonnet-4-6`, thinking off; `opts.model` overrides; callers include the source dossier + PDF metadata + claim recs in `lib/dossier.ts`, `lib/summary.ts`, `lib/lens.ts`, `lib/concepts.ts`, `lib/argument-gaps.ts`, `lib/argument-nodes.ts`). Non-Anthropic picks route through `routedStructured` (`lib/model-route.ts`) / `lib/scan/llm.ts` (OpenRouter, needs `OPENROUTER_API_KEY`). AI features are **recommend-only**: the model proposes, a form submit or a human tap commits. Every call logs through `recordApiCall` (`lib/cost.ts`) to `ai_cost_log` with a feature slug, priced by `ai_rate_cards` at call time; budget guards sum those rows by feature. Every model-call button registers a `ui_jobs` run (`lib/jobs/CLAUDE.md`).
- **The human gate** (`moveConfidence` in `lib/mutations/core.ts`, one `withTx`): reads the old confidence, writes the new one, inserts a required `rationales` row (optionally citing an `evidence_id`), and writes a `post_commit` snapshot of every confidence. A confidence never moves without its why, and no model ever moves one. Pipelines only create **draft** signals; publishing materializes evidence (`app/signals/CLAUDE.md`).
- **Confidence**: `numeric(3,2)` 0-1, shown as a word via the generated `confidence_label` (`conf_label()`): `<0.40 thin`, `<0.60 contested`, `<0.80 leaning`, else `settled`. `components/ConfidenceEditor.tsx` mirrors the thresholds; words/colors render via `lib/format.ts`.
- **Rendering & durations**: every page reading cookies/DB sets `export const dynamic = 'force-dynamic'`. A page hosting an AI server action declares `maxDuration` (60 by default; per-surface exceptions are in each rules file); page-level `maxDuration` covers its server actions. Pages must NOT render `<Header>`: the chrome renders once in `app/layout.tsx` (`docs/navigation.md`). Page tops use `PageTop`.
- **Public copy truth rules**: never name the employer or a person ("the maintainer"); never hard-code portal/dataset/table counts (derive from `NAV_TREE`, `portalGroups()`, `DATASETS`); say "access key", never "team key". When automation changes (a new auto-publishing kind, search leg, or processor), update `/about/data-handling` and the About set in the same commit.
- **No em dashes in user-facing text** (UI strings, prompts' output, PDFs): use a comma, colon, period, ` · ` for label separators, `–` for null placeholders. Every user-visible prompt carries a "never use an em dash" instruction; keep it when editing prompts. Code comments are exempt.
- Path alias `@/*` → repo root.

## Data model (`supabase/migrations/`)
- Add a schema change as a new numbered file after the highest existing one; the runner skips applied files and never diffs edited ones. RLS is enabled with no public policies on every table (deny-by-default; the app role bypasses). `_migrations` is created in `scripts/migrate.mjs` and gets its RLS there. `lib/migrations.ts` (`getPendingMigrations` / `applyPendingMigrations`) applies the same rules from the app (each file in its own transaction, stopping at the first failure); the files ship with a route only through `outputFileTracingIncludes`.
- **`edges`**: the polymorphic argument graph, `(from_type, from_id) → (to_type, to_id)` with `relation` `supports`/`contradicts`/`depends_on`/`organizes`, types `stance`/`claim`/`bridge_claim`. No FK, so writers must refuse dangling edges. Stance↔stance `contradicts` encodes the strongest-opposing guardrail.
- **`claims`** need `test` + `domain` unless `is_frame=true`. Frames have no domain/test/confidence, `organizes` other claims, and are quarantined from evidence. **`bridge_claims`** are first-class inter-domain objects (`domain_from`/`domain_to`, own `test`/`confidence`), not edges.
- **`evidence`** targets a claim or bridge (`target_type`/`target_id`) with provenance `source_id` (manual) and/or `signal_id` (materialized on publish), CHECK at least one, both `on delete cascade`, plus an optional `lens`. Writers: `addEvidence`/`addEvidenceMany` (source-anchored), `syncSignalEvidence` (signal-anchored). Sourceless signal evidence shows on claim pages but not in source-centric views (`getEvidenceGraph`, `getLandscape`). `sources.url` is unique (partial index, `0050`); `ensureSource` relies on it for a single-statement upsert.
- **`signal_lens_t` ≠ `lens_t`**: the Signal Board's six audience lenses are a separate enum from the map's seven.
- Personal layer: `rationales` (append-only), `snapshots` (read by `/calibration`), `positions_crosscutting` + `position_components` (edited at `/worldview`), `sources.reliability_prior`, `question_summaries`. `content_blocks` holds per-key copy overrides (`Editable`, admin edit mode via the `atlas_edit` cookie; a missing key falls back to the code default). `node_lenses` tags map nodes with `lens_t` lenses (edited by `LensTagger` on `/data`).
- Scaffolded but unwired: `extraction_queue`, `sources.storage_path`, the digest sender (`digest_snapshots`).
- Every other table belongs to a surface; its rules file names them.

## Surface index
| Surface | Routes | Rules | Long doc |
|---|---|---|---|
| Lobby + widget boards | `/`, `/ops` | `lib/widgets/`, `lib/ops/` | |
| Signal Board + drafts desk + promotion | `/signals/*` | `app/signals/` | |
| Claims & Theses (map page, theses workflow) | `/map`, `/theses/*`, `/thesis-report/*` | `lib/thesis/` | |
| Concepts | `/concepts/*` | `app/concepts/` | |
| Daily Edition | `/blotter/*` | `lib/edition/` | |
| Savant (weekly report) | `/savant/*` | `lib/savant/` | `docs/savant.md` |
| Field Report | `/field-reports/*`, Ask toggle | `lib/field-report/` | `docs/field-report.md` |
| Reports | `/reports/*` | `lib/reports/` | |
| Ask | `/ask` | `lib/ask/`, `lib/embed/` (retrieval) | |
| Data Portal + access keys | `/datasets/*`, `/access` | `lib/datasets/`, `lib/portal/` | `docs/data-portal.md` |
| Briefcase (context packs) | `/datasets/briefcase` | `lib/context-pack/` | `docs/context-pack.md` |
| Research | `/research/*` | `lib/research/` | `docs/research-section.md` (original design) |
| Startup Scout | `/scout/*` | `lib/scout/` | |
| Tooling Monitor | `/tooling/*` | `lib/tooling/` | `docs/tooling-monitor.md` |
| External Scan | `/scan` | `lib/scan/` (+ Tavily) | `docs/external-scan.md` |
| Intel Desk + intel deck | `/intel`, `/intel/deck/*` | `lib/intel/` | `docs/intel-desk.md` |
| Discovery pipeline | `/pipeline` | `lib/pipeline/` | `docs/discovery-pipeline-2.md` |
| Crons, schedules, hosting limits | `/api/cron/*` | `lib/cron/` | |
| Atlas Agent | `/agent`, rail orb | `lib/agent/` | |
| Model runs (`ui_jobs`) | every model button | `lib/jobs/` | |
| History backfill + company record | `/savant/record`, scripts | `lib/history/` | `docs/history-backfill.md`, `docs/self-record.md` |
| Traceroute (3D) | `/traceroute` | `lib/traceroute/` | `docs/traceroute.md` |
| Education | `/education/*` | `lib/education/` | |
| About + site metadata | `/about/*` | `app/about/` | |
| Navigation, rail, PageTop, chrome | everywhere | | `docs/navigation.md` |
| Styles | `app/styles/*.css` | `app/styles/` | |
| PDFs | `*/pdf` routes | `lib/pdf/` | |

Small surfaces with no rules file:
- `/q/[slug]` (question: stances, `QuestionMap`, claims, bridges; admin "Summarize state"), `/q/[slug]/summary` (admin question-state summaries, `lib/summary.ts`: metrics in code, the model only narrates), `/claim/[code]` (frames render a distinct organize-only view), `/bridge/[code]`, `/bridges`.
- **Add-node authoring** (admin, `q/[slug]/claim/new` + `bridge/new`, `maxDuration = 60`): `ClaimForm` shows a live ghost preview on the real `QuestionMap` (dashed `[data-proposed]` node + edges), `BridgeForm` a proposed-styled card. The submit (`createClaimAction`/`createBridgeAction` → `createClaimWithEdges`/`createBridgeWithEdges`) is the only writer; it resolves codes in one transaction and refuse a dangling edge; a claim must bear on ≥ 1 stance; new nodes start at 0.50. "✦ AI suggest" (`recommendClaimEdgesAction`/`recommendBridgeFeedersAction`) is recommend-only. `?gap=<code>` prefills server-side from the persisted `argument_gap_scan` (only the code travels in the URL). The proposer (`lib/argument-gaps.ts`) is report-grounded and restraint-biased: every rec cites its grounding or is dropped, cap 3, nothing is a normal outcome.
- Redirect stubs: `/lens` → `/map`, `/landscape` → `/blotter`, `/supply-chain` → `/traceroute` (its `supply_chain_node_meta`/`supply_chain_node_signals` tables remain), `/report` → `/reports/period`.
- Admin consoles: `/calibration` (snapshot slider, trajectories, move log, "Capture snapshot now" = `snapshotAction('manual')`), `/costs` (`ai_cost_log` × `ai_rate_cards`), `/worldview`, `/data` (domain-text editor + `LensTagger`), `/sources`, `/ingest`, `/source/[id]` (dossier, evidence, `TurnIntoSignalButton` routes the source through the pipeline as a pre-approved candidate, `origin='manual'`).
- Feedback box: `components/feedback/FeedbackButtons.tsx` (rail island; `variant="menu"` rows in the mobile sheet must `stopPropagation` or the sheet's close-on-click unmounts the open dialog) → `FeedbackDialog.tsx` (`.fb-*`) → public `POST /api/tickets` (`createTicket`, the one public write: honeypot, per-IP limiter, caps, email regex, image magic-byte sniff, 2MB). Screenshots live in `ticket_images` (bytea), served by the admin-gated `/api/tickets/image/[id]`. Admin desk `/tickets` (`TicketRow`, badge from `getNavCounts().tickets`).
- `/showcase`: public but unlisted demo deck (`noindex`, chromeless, `.show-*`). Screen grabs live in `public/showcase/*.png`, captured via `scripts/capture-showcase.mjs`; grabs on public pages are captured as a GUEST. The proxy matcher excludes `.png`/`.jpg`/`.svg` so they load sessionless. Runbook: `private/docs/demo-runbook.md`.
- `/login` (`loginAdmin`, `enterAsGuest`, `logout`), `/share?t=<token>` (sets a guest session).

## Deploy (Vercel Pro + Supabase)
- `lib/db.ts` uses `DATABASE_URL` if set, else discrete `SUPABASE_DB_*`. Production MUST set `DATABASE_URL` to the Supabase **pooler** (`aws-0-<region>.pooler.supabase.com:6543`); the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from Vercel. Migrate/seed scripts always use direct `SUPABASE_DB_*`.
- On Vercel (`VERCEL` set), `lib/db-pooler.ts` (`toTransactionPoolerUrl`, tested by `scripts/test-db-pooler.mjs`) moves a `*.pooler.supabase.com` host on `:5432` or no port to 6543 unless `DB_POOL_MODE=session`: session mode caps clients at 15 and fills after a few warm instances (`EMAXCONNSESSION`). Nothing relies on session state; `withTx` keeps a transaction on one client. `DB_POOL_MAX` defaults to 3; use 1 behind the pooler.
- Required: `AUTH_SECRET` (≥ 32 chars), a strong `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY` (server-only), `CRON_SECRET` (`lib/cron/CLAUDE.md`). Every other env var, with defaults, is in `.env.example`; per-surface budgets live in each rules file. Env changes need a redeploy.
- Never commit `.env.local`.

## Gotchas (cross-cutting)
- Do NOT run `npm run build` while `npm run dev` runs: it clobbers `.next` and 500s dev. A long-running `next dev` can serve a CSS bundle missing a newly imported sheet; restart before judging styles.
- URL-encode `@` in a DB password as `%40` inside `DATABASE_URL`.
- **React Compiler lint rules are errors** (`react-hooks/refs`, `set-state-in-effect`, `immutability`, `purity`): never read `ref.current` during render, never `setState` synchronously in an effect body (use `useSyncExternalStore` or a callback), keep mutation of external objects in module-scope functions called from effects.
- **`ai_cost_log.pipeline_run_id` is FK'd to `pipeline_runs`** and `recordApiCall` swallows insert errors: a non-pipeline feature passing its own run id there loses the cost row silently and blinds its budget guard. Put other provenance in `metadata` (`scan_run`, `scout_run`, `tooling_run`, `week_end`, `portal_key_id`).
- **`claude-haiku-4-5` rejects `effort`** (400). `runStructured` omits `thinking` + `output_config` whenever `opts.model` is set; keep that.
- **Anthropic tool schemas**: strict tools need `additionalProperties: false` on every object; the validator rejects `minimum`/`maximum` on integer properties (put ranges in descriptions and clamp in the writer); a large multi-shape strict schema can fail as "too large a compiled grammar" (pass the variable body as a JSON string).
- **Structured batch calls truncate silently**: a too-low `maxTokens` or too-large chunk looks like the model being harsh or skipping items. Keep chunks small (≈ 10-25 items), leave token headroom, and ask for a keep-list rather than a verdict on every item.
- **Generated columns need IMMUTABLE functions**: `array_to_string` is only STABLE, so `search_tsv` columns wrap it (`atlas_touch_text()` on `signals.search_tsv`, `tooling_array_text()` on tooling).
- **`enforceCitations` counts a surviving link as cited ONLY through `tagByHref`.** With no S/P tags, map every href to itself, or a caller that drops "sentences with no surviving link" drops everything.
- Function timeouts are measured, not assumed: Pro allows up to 800s. Most routes keep `maxDuration = 60` and engines stay decomposed into DB-checkpointed units for resumability (`lib/cron/CLAUDE.md`).
