# Datasets portal: pre-mapped upgrade paths

## Measured function-duration ceiling (2026-08-13)

The long-standing "hard ~60s Vercel Hobby cap" assumption is DEAD, measured, not guessed:
`/api/probe/duration` (admin-gated, kept as a standing regression probe) declares
`maxDuration = 300`, which the build accepted, and streamed heartbeats survived
60s, 90s, 150s, and 290s (twice, cold and warm) against production, region iad1,
with the final SURVIVED line intact every run. Raw wall times: 60004 / 90009 /
150010 / 290017 / 290018 ms.

Consequences: routes may declare up to ~300s when they genuinely need it. The
agentic deep-research loop this unlocked SHIPPED the same day: `/api/ask/deep`
(`maxDuration = 300`, the app's first) runs a bounded tool-use loop
(search_atlas / fetch_record / search_articles over `lib/ask/search.ts`, guards
in `lib/ask/deep.ts`) behind the workspace's Deep research toggle, admin-first.
The pipeline's short, DB-checkpointed
decomposition remains good architecture for resumability and cheap retries, but
it is a design choice now, not a platform constraint. Vercel Pro's remaining
value is crons, bandwidth, and an 800s ceiling, not basic headroom (see entry 3).

Written 2026-08-13 alongside the v1 ship. The portal deliberately runs on the current stack
(Vercel Hobby + Supabase, no new services). Each entry below is a deferred option with what
it unlocks, the trigger that should reopen it, and implementation notes captured while the
context was fresh. Work top-down when a trigger fires; several entries depend on each other.

## 1. DuckDB-WASM SQL workbench (v2 of the portal, first in line)

- **Unlocks**: real SQL for colleagues, in the browser, over the dataset endpoints;
  zero server attack surface; no 60s constraints.
- **Trigger**: planned v2; ship when a colleague first asks for joins/aggregations beyond the
  explorer's group-by.
- **Notes**: `@duckdb/duckdb-wasm` is roughly 2.5 to 4 MB gzipped of WASM. Mirror the three.js
  precedent exactly: own route (`/datasets/sql`), `next/dynamic({ ssr: false })`, instantiate
  only after an explicit "Launch workbench" click, capability probe with a graceful fallback.
  Load bundles via `selectBundle` from jsDelivr (pin the version); if corporate networks block
  jsDelivr, vendor into `public/duckdb/`. Register tables from
  `/api/datasets/<slug>?format=csv` via `registerFileURL` + `read_csv_auto`; preload the small
  datasets, lazy-load `articles-full-text` with a size warning (and it needs the portal cookie,
  which the browser sends automatically). Add `examples?: string[]` to the registry and surface
  per-dataset example queries.

## 2. Read-only Postgres role + `portal` schema of views

- **Unlocks**: server-side SQL, live freshness, and the connection any hosted BI tool
  (Metabase, Superset) or pandas/Sheets live connector needs.
- **Trigger**: colleagues need cross-dataset joins at live freshness, row counts pass ~100k
  (beyond comfortable browser extracts), or a BI tool gets approved.
- **Notes**: this is the repo's first-ever role/grant migration against a database where RLS
  is enabled with zero policies and the single app role bypasses it. Sketch: migration creates
  role `portal_ro` (password from env, login), a `portal` schema of `security_barrier` views
  selecting EXACTLY the registry builders' columns (port them; the test suite's banned-column
  assertions apply verbatim), `grant usage on schema portal` + `grant select` on the views
  only, `alter role portal_ro set statement_timeout = '5s'`, and a separate `pg.Pool`
  (max 1) beside `lib/db.ts`. Watch pool contention with the app's `DB_POOL_MAX=1` through
  the transaction pooler (see entry 9). The blast radius of a wrong GRANT is the personal
  layer; audit against `lib/data.ts`'s strip list before granting anything.

## 3. Vercel Pro tier

- **Unlocks**: cron jobs, more bandwidth, `maxDuration` up to 800s (1800s in beta).
  NOTE (2026-08-13): 300s is already available on Hobby, measured; see the ceiling
  section at the top. Pro is about crons and bandwidth now, not basic duration headroom.
- **Trigger**: the first request for scheduled delivery of anything, or a single
  unit genuinely needing more than ~290s.
- **Notes**: the digest sender is pre-scaffolded (`digest_snapshots` table exists,
  `/signals/digest` and `/research/digest` render); a cron makes it real. Heavy dataset
  downloads become pre-baked snapshot files written on publish instead of built per request.

## 4. Custom domain

- **Unlocks**: stable share links that survive project renames; avoids the warning pages
  some managed networks show for `*.vercel.app` login forms.
- **Trigger**: a share link hitting a block page on a managed network (the public reader
  surface was the workaround).
- **Notes**: pure Vercel config plus DNS; no code. Refresh any previously shared links after.

## 5. Hosted BI (Metabase Cloud or Superset)

- **Unlocks**: true drag-and-drop dashboards, saved questions, scheduled alerts.
- **Trigger**: three or more colleagues asking for saved dashboards, or a standing exec
  reporting need. Depends on entry 2 (needs the read-only PG connection).
- **Notes**: point it at the `portal` schema only. Metabase Cloud is the low-ops option;
  self-hosted Superset needs its own infra decision. Embedding into the Atlas is optional;
  linking out is fine for internal use.

## 6. First chart dependency (Observable Plot or Perspective)

- **Unlocks**: richer explorer charts without hand-rolling each type.
- **Trigger**: the third bespoke chart type requested for dataset pages; Perspective
  specifically if pivot-grid demand appears.
- **Notes**: this reverses a deliberate house stance (every chart is hand-rolled SVG/CSS,
  stated repeatedly in file headers), so treat it as a design-system decision, not a casual
  install. Observable Plot is the lighter fit for the Broadsheet look; Perspective brings a
  full pivot grid plus its own WASM weight.

## 7. Embeddings / pgvector retrieval

- **Unlocks**: semantic matching where FTS misses paraphrase ("layoffs" vs "workforce
  reduction") across article text and signals.
- **Trigger**: recurring false "Not in the Atlas" refusals on questions the corpus does cover
  (watch `portal_ask` zero-hit rates in `ai_cost_log` metadata if instrumented, or just
  colleague reports).
- **Notes**: pgvector is available on Supabase. Embed `signals.summary` + article chunks
  (the 0029 `left(..., 200000)` boundaries chunk naturally); hybrid-rank with the existing
  FTS rather than replacing it. The 0020 rationale (namespace fits in prompt) still holds for
  records; embeddings only earn their keep on the long-text corpus.

## 8. Real multi-user auth (Supabase Auth)

- **Unlocks**: per-user keys and revocation, per-team budgets, usage attribution, saved
  queries per person.
- **Trigger**: more than ~20 regular users, a leaked shared key incident, or a request for
  per-team spend reporting.
- **Notes**: nothing in the schema has a `user_id` today; this is a real migration plus an
  actor column on `ai_cost_log` (its `metadata` jsonb can carry an actor sooner, cheaply).
  `@supabase/ssr` is already a dependency (currently unused). The single-admin HMAC model
  stays for the author; multi-user applies to portal consumers first.

## 9. DB headroom (Supabase paid tier / read replica)

- **Unlocks**: pool contention relief once portal traffic competes with the app for the
  single pooled connection.
- **Trigger**: observed pool wait times or connection errors after entry 2 ships, or portal
  traffic growing past hobby scale.
- **Notes**: before paying, try `DB_POOL_MAX=2` and measure; the transaction pooler multiplexes
  more than one serverless instance fine at this scale.

## 10. Model escalation for portal Ask

- **Unlocks**: deeper cross-domain answers on hard multi-record questions.
- **Trigger**: recurring shallow answers where the records clearly support more; budget room
  in the daily cap.
- **Notes**: `MODEL` in `app/api/portal/ask/route.ts` is a one-line change to
  `claude-sonnet-4-6` (rate card already seeded in 0014). Raise `PORTAL_DAILY_BUDGET_USD`
  accordingly: Sonnet is roughly 3x input / 3x output cost versus Haiku.
