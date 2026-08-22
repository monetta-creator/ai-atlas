# Open questions

Deliberately unresolved. Each has a recommendation from the pre-transition design
session, but the operator decides; a work-side Claude session must not resolve these
silently. When one is settled, record it in `DECISIONS.md` and delete it here.

---

## OQ-1 · RESOLVED → D-016 (and D-017)

Claims are absorbed into hypotheses; one tier of belief-objects, promote-and-link as
the decomposition escape hatch. Terminology settled alongside it (D-017): conviction =
the gated hypothesis judgment, confidence = the evidence-link weight. (Tombstone kept
so numbering stays stable.)

## OQ-2 · CSV uploads and the operator's encoding system

The operator has an existing document-encoding workflow that may come inside. Unknown:
its output format, whether it runs pre-upload or should run in-platform, and whether CSV
uploads are evidence-shaped or dataset-shaped (see ARCHITECTURE §Intake). **Action for
the work session:** get one real sample of the encoding system's output and one real CSV
the operator wants in, then design the mapping into (source, retained text, annotations
jsonb). Do not build speculatively before seeing samples.

## OQ-3 · RESOLVED → D-013

Questions do not survive in v0; hypotheses are flat. (Kept as a tombstone so numbering
stays stable.)

## OQ-4 · Secondary tagging beyond internal/external

Internal/external context replaces audience lenses as the primary axis (D-005/D-004).
Does the operator want a secondary tag set (e.g. competitor / market / regulatory /
org-internal)? Recommendation: ship v0 with internal/external only; add a free-form tag
column later if the feed gets noisy. Avoid re-inventing the lens enum on day one.

## OQ-5 · Store uploaded files, or text-only?

AI Atlas never stored the PDF (text-only, a privacy stance). Inside the walls the
calculus flips: storing the original file is convenient and the data never leaves.
Recommendation: store extracted text always (required for FTS); store the original file
as bytea or on-disk path behind a size cap, admin-download only. Confirm against
corporate data-handling policy first.

## OQ-6 · Research portal / papers

As built it is arXiv-shaped: alphaXiv-adjacent metadata, the PaperReader iframe to
arxiv.org (an outbound dependency that cannot ship), P-tag citations in /ask.
Options: drop wholesale; or re-point "papers" at internal research documents (analyst
notes, commissioned studies) which is close to what intake v1 produces anyway.
Recommendation: drop the portal, keep the finding-extraction pattern in mind for intake
v1; delete the iframe either way.

## OQ-7 · What multi-user WRITE means when it arrives

Multi-user is decided direction, gating owned by corporate infra (D-012); v0 ships the
current two-tier read model (operator writes, gated colleagues see the public layer).
Still open, for when write access widens: whose conviction is displayed (one shared
house view vs per-user layers), whether confidence stays single-owner (recommended:
yes, one accountable owner per hypothesis, others comment), and how identity reaches
the app (if hosted on Posit Connect, its authenticated-user headers can replace the
password login entirely; see OQ-13). Schema hedge already decided: attribute writes
with an actor column from day one (D-012).

## OQ-8 · A webless Scout successor?

Scout (acquisition-target funnel) was dropped as web-dependent (D-011). If the company
wants an entity-tracking funnel (targets, competitors, partners), the profile + facts +
events + verdict model resurrects cleanly with librarian/manual intake instead of web
discovery. Not in scope until asked for.

## OQ-9 · Concepts scaffold

The DAG mechanism (concepts, prerequisite edges, claim wiring, gap diagnosis) is
content-agnostic; the seeded content is AI pedagogy. Options: drop; keep empty as a
strategy-vocabulary scaffold; keep with new seed. Recommendation: keep the mechanism,
ship with an empty/minimal seed, let it grow from real use. Low cost to keep.

## OQ-10 · Traceroute

The 3D transformer explainer is AI-pedagogy, off-mission for a strategy tool, and is the
sole consumer of the `three` dependency. Recommendation: drop route, components,
`lib/traceroute/*`, the tokenize API, and the `three` dependency. Keep only if the
operator wants it as a demo piece.

## OQ-11 · Which corporate DB rung actually works

RUNBOOK.md has the ladder (IT Postgres → Docker → embedded-postgres → PGlite). Unknown
until tried on the real corporate machine: admin rights, Docker availability, npm
registry access, binary-execution policy. The work session's first hour is walking this
ladder top-down and recording the outcome in DECISIONS.md.

## OQ-12 · LLM endpoint reality

"Can use Claude eventually" is the current state. Unknowns: direct Anthropic API vs a
corporate gateway (Bedrock? internal proxy?), which models are approved, spend
controls. The code path is env-configured (D-009) and fails soft, so this can stay
unresolved without blocking day one. When it lands, verify the cost console's rate
cards match the models actually served.

## OQ-13 · Posit Connect as the host

The company may be able to host on **Posit Connect**. Researched 2026-08-22 against the
current Connect docs (2026.x): Connect now supports **Node.js content** natively
(Express and generic Node HTTP servers), so a Next.js app is plausible there. This is
attractive because Connect would solve the two hardest environment problems at once:
**gating/auth** (Connect's own login + viewer permissions, satisfying D-012) and
**hosting** (no bespoke server to argue for). Its presence also implies a corporate
Postgres exists (Connect itself runs on one), strengthening RUNBOOK rung 1.

What the work session must verify on the real instance:

1. **Connect version** ≥ the release that added Node.js content, and Node runtimes
   installed/configured by the admin (per-content Node versions are supported).
2. **Deploy path:** `rsconnect-python` (≥ 1.29.0) deploys Node content; the bundle
   needs `package.json` + `package-lock.json`, and Connect installs production deps at
   build time, so the Connect server needs npm registry (or internal mirror) access.
3. **Entrypoint + port:** Connect launches a JS/TS file that starts an HTTP server
   reading `process.env.PORT`. For Next.js the clean fit is `output: 'standalone'` in
   `next.config.ts`: `next build` then emits `.next/standalone/server.js`, which honors
   `PORT`/`HOSTNAME` env, and the standalone bundle carries its own pruned
   `node_modules` (reducing the registry-access dependency). Pre-build locally; do not
   expect Connect to run `next build`.
4. **Path prefix:** Connect serves content under a URL path. Next.js `basePath` is
   build-time, so claim a stable vanity URL on Connect (e.g. `/strategy-atlas/`) and
   bake it into `basePath` (and check cookie paths + the proxy allow-list logic).
5. **User identity:** Connect can pass the authenticated user to content via trusted
   headers; if verified on this instance, the app's password login can collapse to
   header-trust (admin = allow-listed usernames), which is the natural D-012 endgame.
6. **Long-running processes:** the AI actions run 30-60s; check Connect's request
   timeout / process-idle settings cover that.

Recommendation: treat Connect as the leading deployment candidate; keep plain
`next start` on a sanctioned host as the fallback. Nothing in the codebase should
assume either (the D-008 "deliberately basic" rule already guarantees this). Sources:
[Connect Node.js docs](https://docs.posit.co/connect/admin/nodejs/) ·
[content overview](https://docs.posit.co/connect/user/content-overview/).
