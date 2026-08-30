import type { DatasetDef } from '../datasets/core';
import type { ScanTopic } from '../types';
// Explicit .ts extension: this chain is loaded by plain Node in
// scripts/test-scan.mjs (type stripping), which resolves no extensionless
// specifiers for real (non-type-only) imports.
import {
  buildRowJsonSchema, cronLabel, describeFieldType, envelopeJsonSchema,
} from '../datasets/handoff-shared.ts';
import type { CronEntry } from '../datasets/handoff-shared.ts';

// Builds the importer handoff the /scan console renders: an orientation
// document for the coding assistant on the OTHER side of a firewall that
// will build the intake by hand. It is generated from the live registry def
// and topic rows so the schema half can never drift from what the download
// serves. No secrets: the portal key travels as a placeholder.
//
// Purpose order matters: system overview first (what the file IS and what
// judgment stays downstream), then the formal JSON Schema (the thing an
// intake validates against), then semantics, invariants, and design
// guidance. Transport mechanics come last; they are the least stable part.
//
// The per-field type/nullability/enum facts, the JSON Schema generator, the
// cron-label helper, and the CronEntry shape live in
// lib/datasets/handoff-shared.ts (shared with the Intel Desk's
// lib/intel/handoff.ts); re-exported here so scripts/test-scan.mjs keeps
// importing buildRowJsonSchema and cronLabel from this module.
export { buildRowJsonSchema, cronLabel };
export type { CronEntry };

export function buildScanHandoff(opts: {
  def: DatasetDef;
  topics: ScanTopic[];
  crons: CronEntry[];
  host: string; // e.g. https://example.vercel.app
  generatedOn: string; // YYYY-MM-DD
}): string {
  const { def, topics, crons, host } = opts;
  const codes = topics
    .filter((t) => t.active)
    .map((t) => `- ${t.taxonomy_code}  ${t.name}${t.description ? `: ${t.description}` : ''}`)
    .join('\n');
  const columns = def.columns
    .map((c) => `| ${c.key} | ${describeFieldType(c.key, c.type)} | ${c.def} |`)
    .join('\n');
  const schedule = crons.map((c) => cronLabel(c.schedule)).join(', then ');
  const schemaJson = JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);

  return `# External Scan: import orientation and contract

Generated ${opts.generatedOn} from the live dataset registry. Audience: the
assistant building the INTAKE on the other side of a firewall. This document
plus one daily file is the whole interface; design the intake from what is
written here, and treat the file's own dataset.columns array as the runtime
source of truth if the two ever disagree.

## 1. What this system is

An external scanner runs once per UTC WEEKDAY outside the firewall (weekends
are scheduled off; Monday's run looks back three days, so it collects the
weekend's news and its file is correspondingly larger). It discovers news
items across financial services and technology topics (public press feeds
plus per-topic web searches), fetches each item's full page text, and runs a
light model enrichment per item: a two-to-three sentence summary,
taxonomy-code tags, named entities, and an advisory relevance score.

The division of labor is deliberate:
- OUTSIDE (this scanner): discovery, fetching, light annotation. It makes NO
  signal-or-not judgment and filters almost nothing.
- INSIDE (the intake you are building + its downstream): validation, storage,
  dedupe against internal state, and ALL triage judgment. Tags and relevance
  arrive as advisory hints, never verdicts.

One file per weekday, roughly 30 to 80 rows (Monday larger). A day's file is
immutable once its run completes; re-downloading the same day returns
identical content.

## 2. The file, formally (JSON Schema, draft 2020-12)

The JSON download is one envelope object: dataset (metadata + the runtime
column schema) and rows (the items). Validate rows against this schema;
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
- item_id is a stable UUID, unique across all days: the natural primary key.
- normalized_url is the dedupe identity: lowercased host (www stripped) +
  path (no trailing slash) + query with tracking params removed and the rest
  sorted; scheme ignored. Unique within a file, and the scanner suppresses
  re-discoveries of the same normalized_url for a trailing 14-day window.
- run_day is constant within one file and matches the file it was downloaded
  as; dataset.day in the envelope is the REQUESTED filter and is null when
  the latest-completed default served.
- Rows are ordered published_on descending (nulls last), then
  normalized_url, then item_id: deterministic for a given day.
- tags and entities are flat strings joining a list with "; " (empty string
  means none). Split on "; " to recover the lists.
- summary and relevance are null whenever enrich_status is not done.
- relevance is clamped to [0, 1] with two decimals.
- full_text is capped at 24,000 characters; text_chars is its length (null
  when no text was retained).
- topic_code values come from the taxonomy list below, but treat the set as
  OPEN: topics get added and edited over time; an unknown code should be
  stored, not rejected.

## 4. Status semantics

- fetch_status: done (text retrieved), failed (fetch failed; the row still
  ships with its discovery metadata), skipped, pending (rare: a day that
  never finished).
- enrich_status: done, skipped (budget cap or no text), error (model call
  failed; text still present), pending.
- discovered_via: the discovering topic's slug when the item came from that
  topic's press feed, or the literal string web_search.
- fetched_via: direct (plain fetch) or jina (reader-service fallback); null
  when nothing was fetched.

## 5. Taxonomy codes currently in use

${codes}

## 6. Intake design guidance

- Upsert keyed on item_id; the intake must be IDEMPOTENT (re-importing a
  file, or overlapping files, changes nothing).
- Import EVERY row, including fetch failures and unenriched items: they
  carry discovery metadata (and usually text) the downstream triage wants.
  Store the two status fields so downstream can filter.
- Ignore unknown row fields (the contract is additive: new columns may
  appear) and diff the envelope's dataset.columns against your expectations
  to detect schema drift early, loudly, and without failing the import.
- Do not re-judge inside what the scanner already encoded: store tags,
  relevance, and entities verbatim as advisory inputs to your own triage.
- Cross-day dedupe on normalized_url if you import history: rare after the
  scanner's own 14-day window, but possible beyond it.
- The CSV variant is the same contract flattened: identical keys as headers,
  UTF-8 BOM, CRLF rows, RFC-4180 quoting, lists pre-joined with "; ".
  Prefer JSON; it needs no quoting rules.
- A reasonable staging table is simply the row fields verbatim plus your own
  imported_at; resist normalizing on intake, since the contract can grow.

## 7. Transport (the least stable section; mechanics may change)

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; the key comes from the scan's operator, never this doc).
2. Download the latest completed day:
   ${host}/api/datasets/external-scan?format=json&download=1
   A specific day: append &day=YYYY-MM-DD. CSV instead: format=csv.
   (download=1 forces a saved file; scripted fetches can drop it.)
3. Fresh data lands via scheduled runs at ${schedule}; the default URL
   always serves the latest COMPLETED day, never a partial one.
`;
}

// The companion handoff for the signals-export dataset: the whole published
// Signal Board corpus, deliberately shaped as external-scan rows so the SAME
// intake ingests both files. Orientation for the far-side assistant on what
// differs (full corpus vs one day; the appended signal-native columns; the
// composed full_text) and how to use it (import, then promote inside).
export function buildSignalsExportHandoff(opts: {
  def: DatasetDef; // the signals-export registry def
  host: string;
  generatedOn: string; // YYYY-MM-DD
}): string {
  const { def, host } = opts;
  const columns = def.columns
    .map((c) => `| ${c.key} | ${describeFieldType(c.key, c.type)} | ${c.def} |`)
    .join('\n');
  const schemaJson = JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);

  return `# Signals export: import orientation and contract

Generated ${opts.generatedOn} from the live dataset registry. Audience: the
assistant that built (or is building) the external-scan intake on the other
side of a firewall. This file is that contract's sibling: SAME row shape,
different corpus. Treat the file's own dataset.columns array as the runtime
source of truth if this document ever disagrees with it.

## 1. What this file is

The complete corpus of PUBLISHED signals from the Atlas Signal Board: every
tracked development a human reviewed and published, with its editorial
writeup and its links into the Atlas argument map. Where the daily
external-scan file is raw discovery awaiting triage, these rows are the
FINISHED product of that judgment on the outside. The intended flow inside:
import every row through the same intake as the scan files, then promote
rows to signals (or your internal equivalent) on your own schedule; the
writeup gives you most of that work pre-done.

## 2. Relationship to the external-scan contract

- The leading columns are the external-scan row keys, in the same order,
  with the same types and nullability: a row here validates against the
  external-scan row schema unchanged. Reuse the intake as-is.
- The remaining columns are signal-native detail, appended: the additive
  policy already told the intake to tolerate (or store) unknown fields.
- Differences in semantics, not shape:
  - FULL CORPUS, not a day: every published signal, every download.
    run_day varies per row (the signal's editorial date). Re-import
    replaces; upsert on item_id makes that idempotent.
  - item_id is the signal's UUID (stable forever). A signal EDITED after
    export keeps its item_id: a later re-import updates it in place.
  - url falls back to the signal's Atlas page when no source article is
    linked, so normalized_url MAY repeat when two signals share one source.
    Key on item_id, never normalized_url, for this file.
  - discovered_via is always atlas_signal; tags carries the signal's
    audience lenses (an open set, like scan tags); entities is always
    empty; relevance encodes significance (high 0.9, medium 0.6, low 0.3).
  - full_text is ALWAYS present: a composed document with the title,
    summary, the brief (WHAT HAPPENED / WHY IT MATTERS / WHAT IS
    CONTESTED), the counterpoint, the argument-map touches with their
    reasoning, then SOURCE ARTICLE TEXT with the retained article when one
    exists. Capped at 24,000 characters.

## 3. The file, formally (JSON Schema, draft 2020-12)

\`\`\`json
${schemaJson}
\`\`\`

## 4. Field semantics

| key | type | definition |
|---|---|---|
${columns}

touch_details is a JSON-encoded array (parse the string): one entry per
touched argument-map node, {code, direction, reason, statement}. direction
is supports, contradicts, or neutral (null when untracked); reason is the
editorial why behind the touch; statement is the touched claim's own text,
resolved at export time. claim_touches is the same code list flattened with
"; " for quick filtering.

## 5. Intake design guidance

- Run it through the external-scan intake unchanged; store the appended
  columns (or at minimum touch_details and the brief fields) rather than
  dropping them, since they carry the promotion-ready editorial work.
- Idempotent upsert on item_id; a re-download is a full refresh, so an
  upsert also picks up post-publish edits.
- A row disappearing from a later download means the signal was unpublished
  or deleted; treat your copy as historical rather than deleting, unless
  you mirror publication state.
- The editorial judgments here (directions, reasons, significance) were
  made for the Atlas argument map; treat them as strong drafts for your
  internal promotion, not verdicts.

## 6. Transport

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; the key comes from the operator, never this doc).
2. Download: ${host}/api/datasets/signals-export?format=json&download=1
   (CSV instead: format=csv). No day parameter; it is always the full
   corpus. Re-download whenever you want the current state; new signals
   publish continually.
`;
}
