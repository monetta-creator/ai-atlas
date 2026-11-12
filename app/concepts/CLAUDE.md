# Concepts (the semantic scaffold)

A layered dependency graph of AI terminology. Public to read; admin authors.

## Pages
- `concepts/page.tsx`: `ConceptGraph`, a hand-rolled SVG DAG (foundational at the bottom, hover tooltip, narrow-screen layer-list fallback).
- `concepts/[slug]/page.tsx`: settled/contested panel, prerequisites / builds-toward, linked claims. Guests get confidence stripped.
- `concepts/new/page.tsx` and `concepts/[slug]/edit/page.tsx`: `ConceptForm` with AI-suggest for prerequisites and claim wiring. Recommend-only; the admin confirms each, and the form submit is the only writer. Both use `adminGate`, `maxDuration = 60`.

## Gap diagnosis (admin, on `/concepts`)
- `ConceptGapPanel` + `diagnoseConceptGapsAction`; the page sets `maxDuration = 60`.
- One bounded model call (`timeoutMs 55s`, `maxRetries 0`) reads the scaffold + the Argument Map and argues for missing concepts.
- The scan persists in the `concept_gap_scan` singleton (mig `0018`, mirrors `dedupe_scan`) and is reconciled against live slugs on read.
- Each rec's Start draft opens `/concepts/new?gap=<slug>`, which pre-fills server-side from the persisted scan. Only the slug travels in the URL.

## Data (mig `0017`)
- `concepts`: slug, name, short_definition, explanation, `status` (`concept_status_t` settled/contested).
- `concept_edges`: "understand `prerequisite_id` before `concept_id`". Unique pair, no-self-loop CHECK. Kept a DAG by the writer's in-transaction cycle walk in `lib/mutations/concepts.ts`.
- `concept_claims`: concept to claim/bridge by stable text code, resolved at read time like `signals.claim_touches`. Dangling codes are drift-flagged for admins.
- Both link tables carry `concept_link_status_t` (suggested/confirmed). The app writes only `'confirmed'` rows and public reads filter on it.
- Seed: `db:seed:concepts` (31 concepts, 51 edges; claim wiring left to the admin). The last ten are transformer internals that `/traceroute` links its 3D captions to.
