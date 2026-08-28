import type { DatasetDef } from '../datasets/core';
import type { ScanTopic } from '../types';

// Builds the copy-paste importer handoff the /scan console renders: everything
// a coding agent on the OTHER side of a firewall needs to build an importer
// against the external-scan dataset, generated from the live registry def and
// topic rows so it can never drift from the real schema. No secrets: the
// portal key travels as a placeholder the admin fills in themselves.

export interface CronEntry {
  path: string;
  schedule: string;
}

// '0 9 * * *' -> '09:00 UTC daily'; anything fancier renders raw.
export function cronLabel(schedule: string): string {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m) return schedule;
  return `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')} UTC daily`;
}

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
    .map((c) => `| ${c.key} | ${c.type} | ${c.def} |`)
    .join('\n');
  const schedule = crons.map((c) => `${cronLabel(c.schedule)} (${c.path})`).join(', then ');

  return `# External Scan import contract

Generated ${opts.generatedOn} from the live dataset registry at ${host}/scan.
Audience: the importer being built inside the firewall. This file plus one
daily download is the whole interface; nothing else crosses.

## What this is

One JSON (or CSV) file per day: items from an automated external news scan
across financial services and technology topics. Discovery is public press
feeds plus per-topic web searches; each item carries the full fetched page
text plus a small-model enrichment (summary, taxonomy tags, named entities,
an advisory relevance score). The scan makes no signal-or-not judgment: that
is the importer's downstream triage. Expect roughly 30 to 80 rows per day.

## Getting the file

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; get the key from the scan's operator).
2. Download the latest completed day:
   ${host}/api/datasets/external-scan?format=json&download=1
   A specific day: append &day=YYYY-MM-DD. CSV instead: format=csv.
   (download=1 forces a saved file; without it the browser renders the JSON
   inline. Scripted fetches can drop it.)
3. Fresh data lands daily: scheduled runs at ${schedule}. Download any time
   after the second run; the default always serves the latest COMPLETED day,
   so a mid-flight run never produces a partial file.

## JSON envelope

{
  "dataset": {
    "slug": "external-scan", "title": "...", "description": "...",
    "methodology": "...", "category": "scan",
    "lens": null,
    "day": "2026-08-28 or null",
    "row_count": 43,
    "columns": [ { "key": "...", "label": "...", "type": "...", "def": "..." } ]
  },
  "rows": [ ... ]
}

dataset.day echoes the ?day= filter and is null when the latest-completed
default was used; read the per-row run_day for the actual day either way.

## Row fields

| key | type | definition |
|---|---|---|
${columns}

Notes: every cell is string, number, or null. tags and entities are lists
joined with "; " (an empty string means none). summary and relevance are null
whenever enrich_status is not done. full_text is capped at 24,000 characters.
CSV downloads use the same keys as headers, UTF-8 BOM, CRLF rows, RFC-4180
quoting.

## Status semantics

- fetch_status: done (text retrieved), failed (fetch failed; row still ships
  with discovery metadata), skipped, pending (rare: an unfinished run).
- enrich_status: done, skipped (budget cap or no text), error (model call
  failed; text still present), pending.
- discovered_via: the discovering topic's slug when the item came from that
  topic's press feed, or the literal string web_search.
- fetched_via: direct (plain fetch) or jina (reader-service fallback).

## Taxonomy codes in use

${codes}

## Importer guidance

- Key on item_id (a stable UUID) or normalized_url (stable across
  rediscovery of the same story; host + path + sorted query, tracking
  params stripped).
- Import EVERY row, including enrich_status != done: those still carry the
  discovery metadata and usually full text; only the model annotations are
  missing.
- Treat tags and relevance as advisory inputs to your own triage, never as
  verdicts.
- Dedupe across days on normalized_url if you re-download history: the scan
  itself suppresses repeats within a trailing 14-day window, so cross-day
  duplicates are rare but possible after that window.

## Example row (representative values)

{
  "item_id": "3f2a9c9e-1d2b-4c8a-9f10-8e7d6c5b4a39",
  "run_day": "2026-08-28",
  "url": "https://www.example.gov/newsroom/press-releases/example",
  "normalized_url": "example.gov/newsroom/press-releases/example",
  "headline": "Agency finalizes example rule",
  "source_domain": "example.gov",
  "published_on": "2026-08-27",
  "discovered_via": "prudential-regulation",
  "topic_slug": "prudential-regulation",
  "topic_code": "2.1",
  "summary": "Two to three factual sentences on what happened and why it matters.",
  "tags": "2.1; 2.2",
  "entities": "Example Agency; Example Bank",
  "relevance": 0.85,
  "enrich_status": "done",
  "fetch_status": "done",
  "fetched_via": "direct",
  "text_chars": 11412,
  "full_text": "The complete fetched page text..."
}
`;
}
