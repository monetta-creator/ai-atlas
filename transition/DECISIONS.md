# Decision log

Append-only. Newest at the bottom. Each entry: date, decision, why, and status
(DECIDED / EXECUTED / DEFERRED). "Operator" is the tool's single user and owner.

---

## D-001 · 2026-08-22 · Do the transformation outside the firewall, not from instructions

**DECIDED.** The strip/remodel is executed in the pre-transition Claude Code session on
branch `claude/current-capabilities-me6h7r`, verified by build + lint there, and carried
inside as a finished repo. The `transition/` folder documents decisions and the
environment-specific runbook; it is not a build manual. Rationale: a verified diff beats
prose instructions re-derived by a second agent in a more constrained environment.

## D-002 · 2026-08-22 · The web-discovery leg dies; the pipeline spine survives

**DECIDED.** No outbound web access inside the walls, so discovery-by-web-search, the
candidate URL fetcher, the jina reader fallback, the breaking-events sweep, the coverage
check, and the zero-yield-domain learning loop are removed. The **candidate → triage →
analyze → draft → human-publishes spine is kept** and becomes the engine for
document/artifact intake (it already runs webless for `origin='manual'` candidates via
the source-backed path).

## D-003 · 2026-08-22 · Signal intake is manual-first

**DECIDED.** v0 intake is the existing manual workflow (the operator, plus material from
the corporate librarian who pulls external signals). External context arrives as manual
uploads. In-platform "artifact deconstruction" (upload a document, strip it to text,
index it, run the analyze step against it) is the first post-transition feature, built on
the kept pipeline spine. See ARCHITECTURE §Intake and OQ-2 (CSV / encoding system).

## D-004 · 2026-08-22 · Stances and bridge claims are removed

**DECIDED.** The stance layer and bridge_claims (with their routes, components, edges
usage, seed data, and /ask corpus legs) do not carry over. The polymorphic `edges` and
`evidence` target types shrink accordingly.

## D-005 · 2026-08-22 · Hypotheses are the top line, evolved from theses

**DECIDED (design detail in ARCHITECTURE).** The AI Atlas `theses` subsystem (statement
under test, mapped support, gap scans, reports) is the closest ancestor of the Strategy
Atlas **hypothesis** and becomes the top-level object. The target hierarchy is:

> **Hypothesis** → **Evidence** (each link weighted by operator **conviction**) →
> **Signal** (carrying **internal** or **external** context)

The exact fate of `claims` (fold into hypotheses vs survive as sub-units) is OQ-1.

## D-006 · 2026-08-22 · Evidence carries conviction

**DECIDED (mechanics in ARCHITECTURE §Conviction).** Conviction is set by the operator on
the evidence→hypothesis link. Hypothesis confidence remains human-committed through the
existing gate (rationale required, snapshot written); conviction-weighted evidence is a
displayed input to that judgment, not a formula that moves confidence by itself.

## D-007 · 2026-08-22 · Keep the Postgres dialect; make the runtime portable

**DECIDED.** The schema stays Postgres (enums, generated columns, jsonb, arrays,
tsvector/GIN full-text search are load-bearing; SQLite would force a rewrite of FTS,
enums, array columns, and jsonb queries for zero product gain). Portability comes from
the runtime ladder in RUNBOOK.md: corporate Postgres instance → Docker Postgres →
`embedded-postgres` (real Postgres binaries via npm, child process, no admin install) →
PGlite (WASM Postgres) as deep fallback. SQLite is break-glass only, and is a real
project if triggered. The app code is indifferent: `lib/db.ts` takes any `DATABASE_URL`.

## D-008 · 2026-08-22 · No Vercel; deployment is deliberately basic

**DECIDED.** Target is `next build && next start` (or `npm run dev`) on whatever Node
host the corporate environment allows: the operator's own machine is the default
assumption. All Vercel-specific machinery (maxDuration budgeting, pooler/IPv4 notes,
serverless pool sizing) is removed or reduced to comments. Nothing in the app may assume
a public URL.

## D-009 · 2026-08-22 · LLM endpoint is configurable, and the app degrades without it

**DECIDED.** Keep `@anthropic-ai/sdk`. All model calls already route through a small
number of chokepoints (`runStructured` in `lib/dossier.ts` + the ask/pipeline callers);
endpoint and key come from env (`ANTHROPIC_BASE_URL` honored by the SDK, plus
`ANTHROPIC_API_KEY`), so a corporate gateway or future endpoint swap is an env change,
not a code change. Every AI feature must fail soft when no key is configured: the app is
useful for browsing/recording on day one even before the endpoint exists.

## D-010 · 2026-08-22 · Squash migrations to a fresh baseline

**DECIDED.** The Strategy Atlas ships a new `0001` baseline schema (post-strip,
post-remodel) plus a new seed, instead of 37 migrations of AI Atlas archaeology. The
migration runner and its `_migrations` tracking stay.

## D-011 · 2026-08-22 · Startup Scout does not carry over

**DECIDED.** The scout subsystem is discovery-of-web-entities by web search; it has no
role inside the walls. Removed wholesale. (Its patterns worth keeping are already
generalized elsewhere: chunked agent runs, fill-only-null fact writes, monotone jsonb
merges.)
