# Strategy Atlas: target architecture

This is the design the strip and remodel aim at. Where something is still open it points
at `OPEN-QUESTIONS.md` rather than pretending to be settled.

## 1. The object model

```
HYPOTHESIS                  the top-line unit: a strategic statement under test
                            (flat list in v0, D-013; the ONLY belief-object, D-016)
  ├── statement       what we believe / are testing
  ├── test            what evidence would move it (falsifiability, kept from claims)
  ├── conviction      0..1, human-committed only through the gate, word-labeled (D-017)
  ├── status          active / retired / resolved
  └── EVIDENCE LINKS  n per hypothesis; many-to-many (one item can bear on several
        │             hypotheses at different confidence)
        ├── confidence   low / medium / high, set at attach time, editable (D-017)
        ├── direction    supports / cuts against / complicates
        ├── note         why it bears
        ├── actor        who attached it (multi-user hedge, D-012)
        └── → SIGNAL or SOURCE (provenance)

SIGNAL   a tracked development, published by a human
  ├── context: INTERNAL | EXTERNAL      (replaces the audience-lens enum as the primary axis)
  ├── significance (kept)
  ├── touches → hypotheses (kept mechanism: codes on the row, materialized to evidence on publish)
  └── origin: manual | document-intake

SOURCE   an ingested artifact (document, CSV, note) with retained extracted text, FTS-indexed
```

What this keeps from the AI Atlas: the human gate (conviction never moves without a
rationale; a snapshot is written on every move), publish-materializes-evidence, FTS
retrieval for /ask, the calibration/snapshot history, reports.

What it drops: stances, bridge claims, the claims tier (absorbed into hypotheses,
D-016), the audience-lens taxonomy as the organizing axis (internal/external context
replaces it; whether a secondary tag set survives is OQ-4), web discovery, Startup
Scout.

### Hypotheses = evolved theses, absorbing claims (D-016)

The `theses` subsystem is the ancestor: statement, mapped support, gap scan, reports,
workflow page. The remodel promotes it to the top of the tree and folds the claims tier
into it: hypotheses take the falsifiable `test`, the gated judgment, and the rationale
history; evidence attaches directly. Hypotheses are the ONLY belief-object; a recurring
load-bearing sub-statement is promoted to its own narrower hypothesis and related by
link (no sub-claim tree, no polymorphic edges graph in v0). Guards against mushy
hypotheses: the required `test`, and the gap-diagnosis machinery flagging a hypothesis
whose evidence points too many ways.

### Conviction and confidence (D-006, D-014, D-017)

Two words, two levels, deliberately assigned:

- **Conviction** is the hypothesis-level judgment: 0..1, word-labeled, movable ONLY by
  a human through the gate (rationale required, snapshot written). Conviction is what a
  person holds about a thesis; models do not have conviction. Calibration becomes the
  conviction history.
- **Confidence** is the evidence-link weight: **low / medium / high**, chosen at attach
  time, editable after, alongside direction and a why-it-bears note. Coarse and human
  on purpose; precision theater is a known failure mode and the AI Atlas already
  learned this with words over numbers.
- Confidence lives on the LINK, not the item: the same document can bear on one
  hypothesis at high confidence and another at low.
- Confidence ≠ the source `reliability_prior` (kept): the prior is trust in the source
  generally; confidence is the read on this item bearing on this hypothesis.
- Display: a hypothesis page shows its evidence sorted by confidence × recency, with a
  rollup line (e.g. "balance leans supportive, driven by 2 high-confidence items").
- The rollup NEVER writes conviction. The operator reads it, then moves conviction
  through the gate. This preserves calibration integrity: the snapshot history stays a
  record of human judgment.

## 2. Intake (the artifact pipeline)

The discovery pipeline's spine survives: `signal_candidates` → triage → analyze →
draft signal → human reviews and publishes. Only the intake end changes.

**v0 (ships with the transition):** manual, exactly today's workflow. The operator or
the corporate librarian pastes/creates sources and signals by hand. The source-backed
candidate path (`origin='manual'`, `cadence='source'`) already runs webless.

**v1 (first post-transition build):** in-platform artifact deconstruction.

```
upload (PDF / DOCX / PPTX / TXT / MD)
  → extract text in the browser or server (unpdf already does PDF; docx/pptx TBD)
  → create a SOURCE with retained text (the file itself: OQ-5)
  → FTS-index it (search_tsv pattern already exists on sources)
  → it is now in the /ask retrieval corpus
  → optionally: run the analyze step against it → draft signal(s) → human gate
```

**v1.5: CSV / structured data.** Two different shapes, keep them distinct (OQ-2):
- *Evidence-shaped CSV*: rows that are really a list of facts/events. Deconstruct like a
  document (row → text rendering → FTS) or hand-curate into signals.
- *Dataset-shaped CSV*: a table the operator wants to query/explore. The Data Portal's
  dataset registry pattern (`lib/datasets/registry.ts`, explorer, CSV/JSON download)
  is the natural home; it would need an upload-backed registry instead of code-defined.

**The operator's encoding system** (their existing document-encoding workflow) is a
known unknown: OQ-2. Reserve the seam: intake produces (source row, retained text,
structured annotations jsonb). Whatever the encoding system emits should map into that
triple without schema surgery.

## 3. Retrieval and /ask

Kept: FTS over sources/signals (+ hypotheses), the multi-turn ask workspace, peek
panels, the citation-tag machinery, cost metering. Changed:
- The web-search toggle and the deep loop's `web_search` tool are removed.
- The retrieval corpus legs for stances/bridges/papers are removed or remapped
  (papers/research portal fate: OQ-6).
- The deep research loop itself (bounded tool-use over internal records) is MORE
  valuable inside the walls, since it is records-only by construction there.

## 4. Platform

- **Runtime:** Node + `next start`, localhost or an internal host. No serverless
  assumptions; `maxDuration` exports removed (they are inert off Vercel).
- **DB:** Postgres dialect, portable runtime (the RUNBOOK ladder, D-007). One
  `DATABASE_URL`. Pool sizing goes back to normal (no per-serverless-instance limits).
- **LLM:** `@anthropic-ai/sdk` with `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` from env
  (D-009). All calls stay behind the existing chokepoints (`runStructured`, the ask
  routes). Fail-soft when unset: AI buttons render disabled with a "no endpoint
  configured" note; nothing throws at page load.
- **No outbound network, verified:** the transition includes an audit (INVENTORY §5) of
  every outbound call; the corporate build must pass "zero external requests" with the
  LLM endpoint as the sole configured exception. Fonts local, no CDN, no external
  iframes (the arXiv PaperReader iframe dies with the research portal decision, OQ-6).
- **Hosting candidate: Posit Connect (OQ-13).** Connect supports Node.js content
  (2026.x); the fit is `output: 'standalone'` + a Connect vanity URL baked into
  `basePath`, deployed pre-built via rsconnect-python. If it pans out it also supplies
  the multi-user gate (D-012) via Connect auth. Plain `next start` on a sanctioned
  host remains the fallback; the code assumes neither.
- **Auth:** v0 keeps the admin HMAC cookie + gated read view; that is already a
  two-tier multi-user read model. Multi-user is the destination (D-012): writes carry
  an actor from day one, and if Posit Connect hosts the app, its authenticated-user
  headers are the likely successor to the password login (OQ-7/OQ-13).

## 5. Roadmap after day one

1. Wire environment (RUNBOOK), verify baseline schema + seed, smoke-test the gate loop.
2. Finish the hypothesis remodel if any of it was deferred (the model itself is
   settled: D-013/D-016/D-017).
3. Build intake v1 (document deconstruction).
4. Intake v1.5 (CSV) + the encoding-system integration (OQ-2).
5. Revisit reports/digest for the internal audience (the librarian workflow may want a
   weekly internal digest; the digest renderer exists, the sender was never built).
