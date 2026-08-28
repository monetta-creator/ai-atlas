import type { DatasetDef } from '../datasets/core';
import type { ScanTopic } from '../types';

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

// Per-field facts the registry's display columns do not carry: JSON type,
// nullability, closed enum sets, formats. The row schema is generated from
// the registry column ORDER plus this map; a registry column missing here
// falls back to a permissive type so a new column can never break the
// generator (the intake is told to ignore unknown fields anyway).
const FIELD_FACTS: Record<string, { type: 'string' | 'number'; nullable: boolean; enum?: string[]; format?: string }> = {
  item_id: { type: 'string', nullable: false, format: 'uuid' },
  run_day: { type: 'string', nullable: false, format: 'date' },
  url: { type: 'string', nullable: false, format: 'uri' },
  normalized_url: { type: 'string', nullable: false },
  headline: { type: 'string', nullable: true },
  source_domain: { type: 'string', nullable: true },
  published_on: { type: 'string', nullable: true, format: 'date' },
  discovered_via: { type: 'string', nullable: false },
  topic_slug: { type: 'string', nullable: true },
  topic_code: { type: 'string', nullable: true },
  summary: { type: 'string', nullable: true },
  tags: { type: 'string', nullable: false },
  entities: { type: 'string', nullable: false },
  relevance: { type: 'number', nullable: true },
  enrich_status: { type: 'string', nullable: false, enum: ['done', 'skipped', 'error', 'pending'] },
  fetch_status: { type: 'string', nullable: false, enum: ['done', 'failed', 'skipped', 'pending'] },
  fetched_via: { type: 'string', nullable: true, enum: ['direct', 'jina'] },
  text_chars: { type: 'number', nullable: true },
  full_text: { type: 'string', nullable: true },
};

// JSON Schema (draft 2020-12) for one row, generated from the live registry
// columns in order. Exported for the test script's coverage check.
export function buildRowJsonSchema(def: DatasetDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const c of def.columns) {
    const f = FIELD_FACTS[c.key];
    if (!f) {
      properties[c.key] = { type: ['string', 'number', 'null'], description: c.def };
      required.push(c.key);
      continue;
    }
    const p: Record<string, unknown> = {
      type: f.nullable ? [f.type, 'null'] : f.type,
      description: c.def,
    };
    if (f.enum) p.enum = f.nullable ? [...f.enum, null] : f.enum;
    if (f.format) p.format = f.format;
    properties[c.key] = p;
    required.push(c.key); // every key is PRESENT on every row; nullability is in the type
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'external-scan row',
    type: 'object',
    properties,
    required,
    // Additive change policy: new fields may appear; intakes ignore them.
    additionalProperties: true,
  };
}

function envelopeJsonSchema(rowSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'external-scan download',
    type: 'object',
    required: ['dataset', 'rows'],
    properties: {
      dataset: {
        type: 'object',
        required: ['slug', 'day', 'row_count', 'columns'],
        properties: {
          slug: { const: 'external-scan' },
          title: { type: 'string' },
          description: { type: 'string' },
          methodology: { type: 'string' },
          category: { type: 'string' },
          lens: { type: 'null' },
          day: { type: ['string', 'null'], format: 'date', description: 'Echoes the ?day= filter; null when the latest-completed default served.' },
          row_count: { type: 'integer' },
          columns: {
            type: 'array',
            description: 'The authoritative runtime schema: key, label, type, def per column. Diff against expectations to detect drift.',
            items: {
              type: 'object',
              required: ['key', 'label', 'type', 'def'],
              properties: {
                key: { type: 'string' }, label: { type: 'string' },
                type: { enum: ['text', 'number', 'date', 'enum', 'longtext'] },
                def: { type: 'string' },
              },
            },
          },
        },
      },
      rows: { type: 'array', items: rowSchema },
    },
  };
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
    .map((c) => {
      const f = FIELD_FACTS[c.key];
      const type = f ? `${f.type}${f.nullable ? ' or null' : ''}${f.enum ? ` (${f.enum.join(' | ')})` : ''}` : c.type;
      return `| ${c.key} | ${type} | ${c.def} |`;
    })
    .join('\n');
  const schedule = crons.map((c) => cronLabel(c.schedule)).join(', then ');
  const schemaJson = JSON.stringify(envelopeJsonSchema(buildRowJsonSchema(def)), null, 2);

  return `# External Scan: import orientation and contract

Generated ${opts.generatedOn} from the live dataset registry. Audience: the
assistant building the INTAKE on the other side of a firewall. This document
plus one daily file is the whole interface; design the intake from what is
written here, and treat the file's own dataset.columns array as the runtime
source of truth if the two ever disagree.

## 1. What this system is

An external scanner runs once per UTC day OUTSIDE the firewall. It discovers
news items across financial services and technology topics (public press
feeds plus per-topic web searches), fetches each item's full page text, and
runs a light model enrichment per item: a two-to-three sentence summary,
taxonomy-code tags, named entities, and an advisory relevance score.

The division of labor is deliberate:
- OUTSIDE (this scanner): discovery, fetching, light annotation. It makes NO
  signal-or-not judgment and filters almost nothing.
- INSIDE (the intake you are building + its downstream): validation, storage,
  dedupe against internal state, and ALL triage judgment. Tags and relevance
  arrive as advisory hints, never verdicts.

One file per day, roughly 30 to 80 rows. A day's file is immutable once its
run completes; re-downloading the same day returns identical content.

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
3. Fresh data lands daily via scheduled runs at ${schedule}; the default URL
   always serves the latest COMPLETED day, never a partial one.
`;
}
