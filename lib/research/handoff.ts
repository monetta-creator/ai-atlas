import type { DatasetDef } from '../datasets/core';
// Explicit .ts extension: this chain is loaded by plain Node in
// scripts/test-datasets.mjs (type stripping), which resolves no extensionless
// specifiers for real (non-type-only) imports.
import {
  buildRowJsonSchema, cronLabel, describeFieldType, envelopeJsonSchema,
} from '../datasets/handoff-shared.ts';
import type { CronEntry } from '../datasets/handoff-shared.ts';

// The research-export orientation doc, mirroring lib/scan/handoff.ts's
// buildSignalsExportHandoff: generated from the live registry def so the
// schema half can never drift from what the download actually serves. No
// secrets: the portal key travels as a placeholder.

export function buildResearchHandoff(opts: {
  def: DatasetDef; // the research-export registry def
  crons: CronEntry[]; // the research pair + the Friday roundup
  host: string;
  generatedOn: string; // YYYY-MM-DD
}): string {
  const { def, crons, host } = opts;
  const columns = def.columns
    .map((c) => `| ${c.key} | ${describeFieldType(c.key, c.type)} | ${c.def} |`)
    .join('\n');
  const schedule = crons.map((c) => cronLabel(c.schedule)).join(', then ');
  const schemaJson = JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);

  return `# Research export: import orientation and contract

Generated ${opts.generatedOn} from the live dataset registry. Audience: the
assistant building the INTAKE on the other side of a firewall. This document
plus one full-corpus file is the whole interface; design the intake from what
is written here, and treat the file's own dataset.columns array as the
runtime source of truth if the two ever disagree.

## 1. What this system is

An arXiv research funnel runs INSIDE the Atlas, outside this firewall: a
daily pull from arXiv (cs.AI, cs.LG, cs.CL) is triaged for relevance against
the Atlas argument map, a recommend-only model agent proposes track / note /
dismiss for the pending queue, a HUMAN makes the actual review decision, and
only then does a deeper per-paper pass extract a structured finding (a
claim-shaped reading, not a summary) from the paper's full text.

The division of labor is deliberate:
- arXiv pull and triage: relevance filtering, mostly mechanical.
- The agent: a recommendation only, never the decision.
- The human review: the actual track / note / dismiss call, with a private
  why that never leaves the Atlas (see review_note below).
- Finding extraction: a bounded model read of the paper's full text, run only
  on papers the human already put on the shelf.

This file is the finished output of that whole funnel: every paper currently
on the reviewed shelf (tracked or noted), with its extraction and retained
text. Papers never write evidence directly inside the Atlas; the only road
from a paper into its own Argument Map is promotion to a Signal Board signal
(promoted_signal_id, set only after a human publishes that signal). Treat the
rows here as strong drafts for your own internal promotion, not verdicts.

## 2. The file, formally (JSON Schema, draft 2020-12)

The JSON download is one envelope object: dataset (metadata + the runtime
column schema) and rows (the papers). Validate rows against this schema;
quarantine a failing row rather than rejecting the whole file.

\`\`\`json
${schemaJson}
\`\`\`

## 3. Field semantics

Every key is present on every row; absence of a value is null, never a
missing key. Cells are only ever string, number, or null.

| key | type | definition |
|---|---|---|
${columns}

Additional guarantees:
- id is a stable UUID, unique across the whole file: the natural primary key.
  A paper edited after export keeps its id; a later re-import updates it in
  place (upsert on id).
- Rows are ordered by reviewed_on descending (the review decision date), then
  id: deterministic for a given corpus state.
- headline_claim, the_test, effect_size, limitations, counterpoint,
  econ_implication, and who_cares all come from ONE model extraction pass and
  are all null together until a paper has been through it; a paper can be
  reviewed (tracked or noted) without yet having an extraction.
- full_text is the RETAINED arXiv text (the LaTeXML HTML render when it
  exists, the PDF otherwise), uncapped. It is null for a paper whose fetch
  never succeeded; fall back to abstract for those.
- who_cares is a JSON-encoded array (parse the string): objects of
  {lens, note}, one entry per audience lens the paper genuinely speaks to.
  Lenses are the Signal Board's six: market, labor, geopolitics, regulatory,
  capability, society. A paper may speak to only one or two, or (rarely,
  before extraction) none.
- thread_slugs and advisory_claim_touches are flat strings joining a list
  with "; " (empty string means none). thread_slugs lists only CONFIRMED
  placements into a research thread; advisory_claim_touches is ADVISORY
  ONLY, never evidence.
- review_note, the human reviewer's private why for the track/note decision,
  is EXCLUDED from this file and every other Atlas dataset. rigor_prior (the
  reviewer's own methodological-rigor number) rides only because this file
  requires the team portal key.

## 4. Status semantics

- review_status: tracked (actively followed; the stronger signal) or noted
  (worth knowing, not actively followed). Both are human decisions; the
  funnel never exports a pending or dismissed paper.
- analyzed_by names the model that produced the extraction; null when the
  paper has not been through the extraction pass yet.

## 5. Weekly rhythm

The funnel runs on its own daily cron independent of this export; re-download
whenever you want the current state of the reviewed shelf. A parallel Friday
cron additionally auto-publishes a guest-safe "weekly research roundup" on
the Atlas itself (papers tracked/noted plus thread updates that week), which
is editorial narrative, not a machine feed: this file remains the only
structured export of the research library. Scheduled activity: ${schedule}.

## 6. Intake design guidance

- Upsert keyed on id; the intake must be IDEMPOTENT (re-importing the same
  file changes nothing; re-downloading later picks up edits and new papers).
- A row disappearing from a later download means the paper's review status
  moved off tracked/noted (a requeue); treat your copy as historical rather
  than deleting, unless you mirror that state.
- Ignore unknown row fields (the contract is additive: new columns may
  appear) and diff the envelope's dataset.columns against your expectations
  to detect schema drift early, loudly, and without failing the import.
- Do not re-judge inside what the Atlas already encoded: store review_status,
  rigor_prior, and the extraction fields verbatim as inputs to your own
  process, not as something to re-derive.
- The CSV variant is the same contract flattened: identical keys as headers,
  UTF-8 BOM, CRLF rows, RFC-4180 quoting, lists pre-joined with "; ". Prefer
  JSON; it needs no quoting rules, and who_cares parses cleanly as JSON only
  in that form (the CSV cell is the same JSON text, just quoted).

## 7. Transport (the least stable section; mechanics may change)

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; the key comes from the research operator, never this doc).
2. Download the full corpus:
   ${host}/api/datasets/research-export?format=json&download=1
   CSV instead: format=csv. No day parameter; it is always the full corpus.
   (download=1 forces a saved file; scripted fetches can drop it.)
3. Re-download whenever you want the current reviewed shelf; there is no
   day-by-day archive for this file, unlike the daily scan.
`;
}
