# Day-one runbook (inside the corporate environment)

Goal: from an unzipped repo to a running Strategy Atlas on a corporate machine, with
zero outbound network traffic except (optionally) the LLM endpoint.

## 0. Prerequisites

- Node 20+ (`node -v`). Next.js 16 requires it.
- npm able to install dependencies. If the corporate registry is a mirror, set it:
  `npm config set registry <internal-registry-url>`. If installs are fully blocked,
  bring `node_modules` in with the zip (install outside on the same OS/arch first) or
  use `npm ci --offline` against a vendored cache.

## 1. Database: walk the ladder, stop at the first rung that works

The app needs any Postgres 15+ reachable by a `DATABASE_URL`. Try in order and record
the outcome in `DECISIONS.md`:

1. **IT-provisioned Postgres** (a server or sanctioned local install). Best option.
   `DATABASE_URL=postgresql://user:pass@host:5432/strategy_atlas`
2. **Docker**, if Docker Desktop / a sanctioned runtime is allowed:
   `docker run -d --name atlas-pg -e POSTGRES_PASSWORD=... -p 5432:5432 -v atlas-pg:/var/lib/postgresql/data postgres:16`
3. **`embedded-postgres`** (npm package shipping real Postgres binaries; runs as a child
   process, no admin rights): add a small `scripts/db-embedded.mjs` that starts it and
   prints the connection string. Binaries download at install time; if the proxy blocks
   that, vendor the platform package in the zip.
4. **PGlite** (`@electric-sql/pglite`, Postgres compiled to WASM, file-backed): the deep
   fallback. Requires bridging to the `pg` pool (pglite-socket) or a small adapter in
   `lib/db.ts`. Only take this rung if 1-3 all fail; record what failed.

Break-glass: SQLite. Not wired; it is a schema+query rewrite (FTS, enums, arrays,
jsonb). If the environment truly forbids all four rungs, stop and discuss with the
operator before starting that project.

Password note: URL-encode special characters in `DATABASE_URL` (`@` → `%40`).

## 2. Environment file

Copy `.env.example` → `.env.local` and set:

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | From step 1. (The discrete `SUPABASE_DB_*` fallback vars may still exist in `lib/db.ts`; `DATABASE_URL` takes precedence and is the supported path.) |
| `AUTH_SECRET` | yes | ≥ 32 random chars. App refuses to start auth without it (fails closed). |
| `ADMIN_PASSWORD` | yes | Strong; it is the operator login. |
| `ANTHROPIC_API_KEY` | no | Leave unset until the LLM endpoint exists; AI features disable themselves. |
| `ANTHROPIC_BASE_URL` | no | Set only if going through a corporate gateway. |
| `DB_POOL_MAX` | no | Default is fine for a local server (no serverless constraint). |

Never commit `.env.local`.

## 3. Initialize

```
npm install        # or the offline variant from step 0
npm run db:migrate # applies the baseline schema (tracks in _migrations)
npm run db:seed    # loads the starter structure; all confidences start at 0.50
npm run db:verify  # sanity-checks the seed
npm run dev        # http://localhost:3000
```

Log in with `ADMIN_PASSWORD` at `/login`.

## 4. Verify the install (smoke tests)

1. **The gate loop:** open a hypothesis, move its confidence with a rationale, confirm
   the move appears in `/calibration` (snapshot + move log).
2. **Manual intake:** create a source, turn it into a draft signal, publish it, confirm
   evidence materialized on the touched hypothesis and the signal shows on the board.
3. **/ask retrieval:** ask a question that should hit the seeded/created records;
   confirm citations resolve and peek panels open. (Without an API key this is the one
   surface that stays dark; that is expected.)
4. **Zero-outbound check:** with dev tools' network tab open (or a local proxy), click
   through the main surfaces and confirm no request leaves localhost. Any external
   request is a bug; fix before regular use.

## 5. First working session checklist (for the work-side Claude)

- [ ] Read `transition/` end to end.
- [ ] Walk the DB ladder; record the rung in `DECISIONS.md` (OQ-11).
- [ ] Run §3 and §4; fix anything environment-specific and log it.
- [ ] With the operator: resolve OQ-1 (claims tier) and OQ-3 (questions tier) if the
      remodel left them open; they gate the baseline schema's final shape.
- [ ] Ask the operator for the OQ-2 samples (encoding-system output, a real CSV).
- [ ] Set up whatever session-journal convention the operator wants inside the walls
      (the old repo kept `private/SESSION-LOG.md`, untracked; it did not travel).
