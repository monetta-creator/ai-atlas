# Open questions

Deliberately unresolved. Each has a recommendation from the pre-transition design
session, but the operator decides; a work-side Claude session must not resolve these
silently. When one is settled, record it in `DECISIONS.md` and delete it here.

---

## OQ-1 · Do claims survive as a tier under hypotheses?

Options:
- **A. Absorb (recommended):** hypotheses take over `test` + gated confidence; evidence
  attaches directly to hypotheses. Flattest model, matches the operator's stated
  hierarchy (hypothesis → evidence → signal). Claims table dies; its good ideas
  (falsifiable test, confidence words, rationale history) move onto hypotheses.
- **B. Keep as sub-claims:** a hypothesis decomposes into smaller falsifiable claims,
  each with own confidence; evidence attaches at the claim level and rolls up. More
  structure, more upkeep; the AI Atlas thesis→mapped-claims mechanism already looked
  like this and the operator used it lightly.

Decide before the baseline schema is squashed; it changes 2-3 tables and the map SVG.

## OQ-2 · CSV uploads and the operator's encoding system

The operator has an existing document-encoding workflow that may come inside. Unknown:
its output format, whether it runs pre-upload or should run in-platform, and whether CSV
uploads are evidence-shaped or dataset-shaped (see ARCHITECTURE §Intake). **Action for
the work session:** get one real sample of the encoding system's output and one real CSV
the operator wants in, then design the mapping into (source, retained text, annotations
jsonb). Do not build speculatively before seeing samples.

## OQ-3 · Do questions survive as the grouping tier?

Recommendation: keep a light grouping tier renamed to strategic questions or themes;
strategy work naturally clusters hypotheses ("China exposure", "pricing power"...). If
the operator prefers flat, a text tag on hypotheses is enough. Cheap either way; decide
at remodel time.

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

## OQ-7 · Colleague access

v0 stays single-operator with the guest/share view (server-stripped personal layer).
If colleagues get real accounts later: per-user conviction? shared hypotheses with one
owner? That is a product fork, not a feature; do not drift into it. Recommendation:
guests browse the published/public layer; the librarian gets a named intake path only if
manual handoff becomes a bottleneck.

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
