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

## D-012 · 2026-08-22 · Multi-user is the destination; gating is owned by corporate infra

**DECIDED (direction).** The Strategy Atlas will become multi-user inside the walls,
behind corporate gating the operator's team has already worked out (likely the hosting
platform's own authentication; see OQ-13 on Posit Connect, whose viewer-access controls
and user-identity headers fit this). Implications for the build:

- v0 ships with the current model (admin cookie + server-stripped guest view); that IS
  a working two-tier multi-user read model (operator writes, gated colleagues read).
- Do not paint single-user corners: conviction, confidence moves, and rationales stay
  attributed in the schema (an `actor` column costs nothing now and saves a migration
  later), even while only one writer exists.
- Per-user personal layers (own conviction, own confidence) are explicitly NOT in v0.
  What "multi-user write" means is settled by the operator when it arrives (OQ-7).

## D-013 · 2026-08-22 · No question tier in v0

**DECIDED.** Hypotheses are a flat top-level list in v0; the `questions` grouping tier
does not carry over. (Resolves former OQ-3.) If clustering pressure appears, a free-form
tag/theme column on hypotheses is the first move, not a resurrected tier.

## D-014 · 2026-08-22 · Conviction mechanics, settled

**DECIDED.** (Operator delegated the design; resolves the ARCHITECTURE placeholder.)
- Conviction lives on the evidence→hypothesis link, chosen at attach time, editable
  after: three words, **low / medium / high**. No numeric precision theater, matching
  the confidence-words philosophy.
- Each link also carries direction (supports / cuts against / complicates) and a short
  note on why it bears.
- The hypothesis page shows evidence grouped by conviction with a display-only rollup
  line. The rollup never writes confidence; the operator moves confidence through the
  gate (rationale + snapshot) as always.

## D-015 · 2026-08-22 · The prime directive: preserve the machinery, change the objects

**DECIDED (operator's words, paraphrased).** "The logic and brilliance of the tool must
remain; we are changing some of the analysis objects and focusing the tool for a v0."
This is the test every cut has to pass. Concretely, the following are the tool's logic
and are untouchable through the transition:

- The human gate and everything that enforces it (rationale-required moves, post-commit
  snapshots, draft→publish, publish-materializes-evidence).
- The recommend-only posture of every AI feature (the model proposes, the human commits).
- The retrieval architecture (FTS corpus, /ask with citations, peek panels, verify).
- The candidate → triage → analyze → draft → review spine.
- The calibration history, the cost meter, the report/pack machinery.
- The console design system and the word-not-number display philosophy.

Cuts are amputations of *objects and intake paths* (stances, bridges, web discovery,
scout), never of the mechanisms above. Where a mechanism is currently expressed through
a dying object (e.g. the tear-sheet's stance rollup, the QuestionMap SVG), the mechanism
is re-expressed against hypotheses, not deleted. "Focused v0" means fewer objects and
fewer surfaces, not a lobotomized engine.

## D-016 · 2026-08-22 · Claims are absorbed into hypotheses (resolves OQ-1)

**DECIDED.** One tier of belief-objects. Hypotheses take over what claims had (the
falsifiable `test`, the gated judgment, the rationale history); evidence attaches
directly to hypotheses; the claims tier does not carry over. Rationale: one mental
model for multi-user readers (statement → evidence → source), no filing decision per
piece of evidence, no double bookkeeping, one accountable judgment per hypothesis —
and the AI Atlas's own usage showed the thesis→mapped-claims layer used lightly.

The decomposition escape hatch: hypotheses are many-to-many with evidence (the same
item bears on several hypotheses at different confidence), and a recurring load-bearing
sub-statement is **promoted to its own (narrower) hypothesis** and related by link —
same object type, no tree. Guards against mushy hypotheses: the required `test` field,
and the kept gap-diagnosis machinery flagging a hypothesis absorbing evidence that
points too many ways. Engineering dividend: the polymorphic `edges` graph is no longer
needed for v0.

## D-017 · 2026-08-22 · Terminology swap: conviction is the hypothesis judgment, confidence is the evidence weight

**DECIDED (operator's proposal).** Supersedes the naming in D-006/D-014; mechanics are
unchanged, the words swap to where they natively belong:

- **Hypothesis → CONVICTION.** The gated, human-only, word-labeled 0..1 judgment
  (rationale required, snapshot on every move). "Conviction" is what a person holds
  about a thesis (investment usage: a high-conviction position); models do not have
  conviction, which makes the gate legible in the word itself. Calibration becomes the
  conviction history.
- **Evidence link → CONFIDENCE.** low / medium / high, chosen at attach time, editable;
  plus direction and a why-it-bears note (D-014 mechanics, renamed). It is an
  assessment of an input, not a commitment.
- **Confidence ≠ reliability prior.** The source-level `reliability_prior` survives as
  trust in the source generally; evidence confidence is the read on this item bearing
  on this hypothesis. Two numbers, two meanings, never merged.
- **Glossary duty:** AI Atlas "confidence" (node-level) maps to Strategy Atlas
  "conviction"; Strategy Atlas "confidence" is a NEW meaning at the evidence level.
  Old commits/docs must be read through that mapping.
- The four display words (thin/contested/leaning/settled) and their thresholds carry
  over to conviction for v0; the words may be re-picked at UI-copy time ("contested"
  reads odd for a personal conviction). Threshold logic (`conf_label()`) is unchanged.

## D-018 · 2026-08-22 · Execution record: the transformation is complete and verified

**EXECUTED.** Every decision above that called for code was carried out outside the
firewall and verified before handoff:

- **Amputations** (D-004, D-011, plus the web legs per D-002): stances, bridges,
  questions, claims-as-a-tier, Scout, traceroute, showcase, web discovery, arXiv pull,
  and the Ask web toggle are gone.
- **The remodel** (D-005, D-006, D-014, D-016, D-017): `hypotheses` is the top-line
  object (code `H<n>`, required test, gated conviction), evidence attaches directly
  with a per-link confidence weight + direction, signals carry `context`
  internal/external and `touches` of hypothesis codes. New surfaces: `/map` is the
  Hypothesis Board, `/hypothesis/[code]` the detail page (conviction editor, evidence,
  gap scan, report console), `/hypothesis-report/[id]` + PDF the public report views.
  The datasets portal, blotter, concepts, research library, reports, ask, calibration,
  and costs are all re-expressed against hypotheses.
- **The schema** (D-010): one squashed baseline at `db/migrations/0001_baseline.sql`
  (the folder moved from `supabase/migrations`).
- **The replatform** (D-007, D-008, D-009): `lib/db.ts` takes one `DATABASE_URL`
  (TLS opt-in, Supabase fallback removed); fonts are vendored in `app/fonts`
  (next/font/local; the build makes zero outbound requests); `lib/ai.ts` is the one
  Anthropic client factory (`ANTHROPIC_BASE_URL`, `ATLAS_AI_MODEL`/`ATLAS_AI_FAST_MODEL`,
  fail-soft without a key); every Vercel-ism (maxDuration exports, pooler notes) is
  scrubbed; `.env.example` is rewritten.
- **Verification**: `tsc` zero errors, ESLint zero warnings, `next build` clean, and a
  real Postgres 16 bring-up in the build container: migrate + seed + verify green,
  every guest and admin route returning 200, the rollback test suite
  (`scripts/run-tests.mjs`) 5/5, fonts confirmed served from the app itself.

What was NOT done, on purpose: the open questions in `OPEN-QUESTIONS.md` (encoding-system
intake, multiuser write semantics, Posit Connect verdict, and the rest) await the
operator inside the walls.
