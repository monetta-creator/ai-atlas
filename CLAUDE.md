# Start here

**Read `transition/README.md` first.** This codebase is the **Strategy Atlas**: the AI Atlas transformed for a corporate deployment. The `transition/` folder is the authoritative record of the remodel — the decisions (`DECISIONS.md`), the object model (`ARCHITECTURE.md`), the vocabulary (`GLOSSARY.md`), what is unresolved (`OPEN-QUESTIONS.md`), and the day-one setup (`RUNBOOK.md`).

# This is NOT the Next.js you know

This version (16.2.6) has breaking changes — APIs, conventions, and file structure may differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing routing/config code. Heed deprecation notices. Notably: middleware lives in `proxy.ts` (exports `proxy`, not `middleware`); `params`/`searchParams` are Promises you must `await`. There is no `middleware.ts`.

---

# The Strategy Atlas

## What this is
A tool for an operating team to **track its strategic hypotheses**: falsifiable statements → evidence (weighted per link) → signals (the tracked internal/external developments that carry the evidence in). Two public surfaces over one body of material: the **Hypothesis Board** (`/map` + `/hypothesis/[code]`) and the **Signal Board** (`/signals`), fed by a manual **intake pipeline** (`/pipeline`). A private **personal layer** (conviction, rationales, source priors) sits on top of a public **share view**. The goal is **orientation, not proof**: the model proposes, the human commits.

**Terminology (transition D-017):** CONVICTION is the hypothesis-level gated judgment (0–1, word-labeled, human-moved only, rationale required). CONFIDENCE is the per-evidence-link weight (high/medium/low, operator-set). Never conflate them.

## Stack & how to run
- **Next.js 16.2.6** (App Router, Turbopack; workspace root pinned in `next.config.ts`) · **React 19** · **TypeScript** (strict) · **Tailwind v4** (CSS-first, `@theme` in `app/globals.css`; no `tailwind.config`) · **Postgres 15+** via the raw `pg` pool (`lib/db.ts`), one `DATABASE_URL`.
- **Zero outbound network by default**: fonts are vendored (`app/fonts`, `next/font/local`), there is no web search anywhere, and the only external call is the optional AI endpoint.
- **AI layer**: `lib/ai.ts` is the ONE Anthropic client factory (`ANTHROPIC_BASE_URL` for a gateway, `ATLAS_AI_MODEL`/`ATLAS_AI_FAST_MODEL` overrides, fail-soft when no key). `runStructured` in `lib/dossier.ts` is the shared forced-tool, non-web call every recommend-only feature routes through. `unpdf` does browser-side PDF→text on the add-source form (text only, file never stored).
- **Console design system**: `app/styles/*.css`, imported in cascade order from `app/globals.css` (`tokens` → `base` → `components` → per-surface sheets → `home` → …). The import ORDER is the cascade.
- Setup: `npm install` → copy `.env.example` → `.env.local` → `npm run db:migrate` (applies `db/migrations/*.sql`) → `npm run db:seed` (3 sample hypotheses, all convictions 0.50) → `npm run dev`. `npm run db:verify` sanity-checks the seed; `node scripts/run-tests.mjs` runs the read-only/rollback test suite.

## Architecture & conventions
- **All DB access is server-side.** `lib/db.ts` owns a global `pg.Pool` (bypasses RLS; RLS is deny-by-default underneath). Helpers: `q()`, `one()`, `exec()`, `withTx()`. Never import `lib/db` into a client component. `numeric` (OID 1700) parses as a JS number; `date`/`timestamptz` come back as JS `Date` — cast to text in SQL when a string is needed.
- **Admin/Guest gate** (`lib/auth.ts`): admin session is a signed HMAC cookie (`atlas_admin`); guest is a non-privileged flag. `AUTH_SECRET` (≥32 chars) is required or the app throws. `proxy.ts` does cookie-presence routing only (public allow-list covers the whole reader surface); it is NOT authorization — every admin page/action re-checks.
- **Personal layer stripped server-side** (`lib/data/*`, barrel `@/lib/data`): `strip()` nulls `conviction`/`conviction_label`/`last_moved` for guests; rationales are admin-only; guests see published signals only; a touch's direction is public, the model's per-touch reason is admin-only. **Guest mode IS the share view.**
- **Server actions** (`lib/actions/*`, barrel `@/lib/actions`): every action calls `requireAdmin()` first and validates input (allow-listed enums, `UUID_RE`, `safePath()`). They call into `lib/mutations/*` (the only writer) and revalidate.
- **The human gate** (`moveConviction` in `lib/mutations/core.ts`): transactional — old value read, new value written, a REQUIRED rationale inserted (optionally citing an evidence row), and a `post_commit` snapshot of all convictions. A conviction can never move without its why. **Publishing a signal is the second gate**: `syncSignalEvidence` materializes one evidence row per touched hypothesis on publish; unpublish/delete removes them. Intake (`prepareSignalFromSourceAction` → triage → analyze) only ever creates drafts.
- **Conviction storage**: `numeric(3,2)` 0–1, generated `conviction_label` via `conf_label()` (`<0.40 thin`, `<0.60 contested`, `<0.80 leaning`, else `settled`). `ConvictionEditor` mirrors the thresholds client-side.
- **Dynamic rendering**: every page that reads cookies/DB sets `export const dynamic = 'force-dynamic'`. Admin-only pages gate with `const admin = await requireAdminPage();` as their FIRST await.
- Path alias `@/*` → repo root.

## Routes (`app/`)
- `page.tsx` — the Lobby: greeting, the `LobbyAsk` launcher, six portal tiles, admin desk row.
- `map/page.tsx` — **the Hypothesis Board** (public): admin draft box (statement + test → create), the atlas-wide gap-diagnosis panel (`ArgumentGapPanel`, recommend-only, create-commit inline), the active/retired ledger (`HypothesisRow` with conviction chips), the recent-moves panel.
- `hypothesis/[code]/page.tsx` — one hypothesis (public; personal layer stripped): statement + test, the `ConvictionEditor` gate, evidence list, signals touching it, hypothesis links (D-016 promote-and-link), conviction history, the per-hypothesis gap scan, and the report console (`HypothesisConsole`: deterministic pack → cited narrative → bottom line → save mints `/hypothesis-report/<id>`).
- `hypothesis-report/[id]` + `/pdf` — public read view + branded PDF of a saved run (narrative re-gated against the frozen pack at render).
- `signals/*` — the feed (context + significance filters), detail, new/edit/drafts/digest (admin authoring gated).
- `blotter/page.tsx` — the broadsheet dashboard (public).
- `reports/*` — the portal shelf (public), `reports/period` the admin generator (per-context sections + synthesis), `reports/[id]` + `/pdf` public period-report views.
- `pipeline/page.tsx` — admin intake console over `pipeline_runs` + `signal_candidates` (triage → analyze → review; resumable, DB-checkpointed).
- `concepts/*` — the semantic scaffold (public; admin authoring + gap scan).
- `research/*` — the paper library (public reading; `research/console` admin).
- `datasets/*` + `/api/datasets/[slug]` — the Data Portal (public catalog; `articles-full-text` key-gated).
- `ask/page.tsx` + `/api/ask*` — the chat workspace (admin deep loop, portal quick path, guests locked).
- `sources`, `ingest`, `source/[id]`, `calibration`, `costs`, `tickets` — admin.
- `about/*` — the public explainer set.

## Data model (`db/migrations/0001_baseline.sql`)
One squashed baseline (transition D-010). Core: `hypotheses` (code `H<n>`, statement, REQUIRED test, conviction + generated label, status active/retired/resolved, per-hypothesis `gap_scan` jsonb), `hypothesis_links`, `evidence` (hypothesis_id FK, direction, confidence weight, provenance CHECK: source_id and/or signal_id), `sources`, `signals` (context internal/external, `touches text[]`, `touch_details` jsonb, publish gate), `pipeline_runs`/`signal_candidates` (intake staging + checkpoint), `rationales`, `snapshots`, concepts trio (`concepts`/`concept_edges`/`concept_links`), research set (`papers`, threads, revisions, links), `reports`, `hypothesis_reports` (insert-only frozen runs), `ai_rate_cards`/`ai_cost_log`, `content_blocks`, `tickets`/`ticket_images`, scan singletons. RLS enabled, no public policies, app role bypasses. After a schema change, add a NEW numbered file in `db/migrations/` (the runner never re-runs edited files).

## Deploy
- Any Node host + any Postgres 15+. `DATABASE_URL` is the one connection path (TLS only with `sslmode=require` or `DB_SSL=1`; `DB_POOL_MAX` default 3, use 1 behind a shared pooler). `AUTH_SECRET` ≥32 chars required; set a strong `ADMIN_PASSWORD`. `ANTHROPIC_API_KEY` optional (AI features fail soft without it); `ANTHROPIC_BASE_URL` points at an internal gateway. Posit Connect is the flagged hosting candidate (transition OQ-13).
- **Never commit `.env.local`.**

## Gotchas
- **Do NOT run `npm run build` while `npm run dev` is running** — it clobbers `.next`.
- **React Compiler lint rules are errors, no opt-out** (`react-hooks/*` via eslint-config-next): never read `ref.current` during render, never `setState` synchronously in an effect body, keep external-object mutation in module-scope functions called from effects. Zero-warning bar.
- **`proxy.ts`'s matcher does not exclude `/api`.** A new public API route needs its own allow-list entry or it 307s to `/login`.
- **The pinned Anthropic SDK (0.100.1) stream accumulator** collapses server-tool blocks; the ask routes capture raw stream events. Re-check on any SDK upgrade.
- **No em dashes in user-facing text.** UI strings use a comma/colon/period, ` · ` for label separators, `–` for null placeholders. Every user-visible AI prompt carries a "never use an em dash" instruction; keep it when editing prompts. (Code comments are exempt.)
- **Conviction ≠ confidence** (D-017): the hypothesis-level judgment vs. the evidence-link weight. Column names, UI copy, and prompts all observe the split.
