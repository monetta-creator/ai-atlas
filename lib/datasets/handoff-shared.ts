import type { DatasetColumn, DatasetDef } from './core';
// Explicit .ts extension: a real (non type-only) import of SIGNAL_LENSES, so
// plain Node (scripts/test-dataset-handoff.mjs, type stripping) resolves it
// the same way filter.ts and registry.ts already resolve their own runtime
// imports from this module chain. core.ts itself imports nothing, so this
// stays dependency-light.
import { SIGNAL_LENSES } from './core.ts';

// Shared machinery behind every importer handoff doc (lib/scan/handoff.ts's
// buildScanHandoff/buildSignalsExportHandoff, lib/intel/handoff.ts's
// buildIntelHandoff): the per-field type/nullability/enum facts the registry's
// display columns don't carry, the JSON Schema generator built from them, and
// the cron-schedule label helper. Moved out of lib/scan/handoff.ts so a second
// domain (Intel) can reuse it without importing scan-specific code.
//
// Dependency-light on purpose: no lib/db, no SDK, so plain Node (the
// scripts/test-*.mjs suite, type stripping) loads this directly.

// One vercel.json cron entry, filtered to the ones a given route drives.
// Shared shape for every domain's handoff (scan, intel): only path + schedule.
export interface CronEntry {
  path: string;
  schedule: string;
}

// '0 9 * * *' -> '09:00 UTC daily'; '0 9 * * 1-5' -> '09:00 UTC weekdays';
// '0 7 * * 1' -> '07:00 UTC Mondays' (a single day-of-week digit, 0 = Sunday
// through 6 = Saturday, the tooling monitor's once-a-week cron); anything
// fancier renders raw.
const CRON_DOW_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export function cronLabel(schedule: string): string {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(schedule.trim());
  if (!m) return schedule;
  const cadence = m[3] === '1-5' ? 'weekdays' : m[3] === '*' ? 'daily' : CRON_DOW_NAMES[Number(m[3])];
  return `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')} UTC ${cadence}`;
}

// Per-field facts the registry's display columns do not carry: JSON type,
// nullability, closed enum sets, formats. A row schema is generated from a
// def's column ORDER plus this map; a registry column missing here falls back
// to a permissive type so a new column can never break the generator (the
// intake is told to ignore unknown fields anyway) -- but every test-*.mjs
// coverage check turns that fallback into a failure, so a new column must be
// added here.
//
// ONE map serves every domain's exports. The external-scan and signals-export
// firewall files share their first nineteen keys byte for byte (that sharing
// is the point: the same intake validates both files); the Intel Desk's
// intel-items file mirrors external-scan's twenty keys the same way. Keys
// shared across domains keep one entry; each domain's own extra columns are
// appended in their own block below.
const FIELD_FACTS: Record<string, { type: 'string' | 'number'; nullable: boolean; enum?: string[]; format?: string }> = {
  // ---- shared by external-scan, signals-export, and intel-items -----------
  item_id: { type: 'string', nullable: false, format: 'uuid' },
  run_day: { type: 'string', nullable: false, format: 'date' },
  // Widened nullable (2026-09-17, the Tooling Monitor) for tooling-products/
  // tooling-catalog/tooling-events, where a discovered product can lack a
  // confirmed homepage; every other domain sharing this key always sets a
  // URL, so the widening is additive and changes nothing for them.
  url: { type: 'string', nullable: true, format: 'uri' },
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
  enriched_by: { type: 'string', nullable: true },
  // ---- source reliability (0052): trailing columns shared by external-scan
  // and intel-items only, never signals-export (a signal is human-edited
  // editorial work, not a source-scored collected item) ---------------------
  source_tier: { type: 'number', nullable: true },
  source_kind: {
    type: 'string', nullable: true,
    enum: [
      'regulator', 'primary', 'research', 'wire', 'major', 'trade', 'tech_press',
      'general', 'aggregator', 'pr_wire', 'blog', 'social', 'promo', 'unknown',
    ],
  },
  content_kind: {
    type: 'string', nullable: true,
    enum: ['news', 'analysis', 'data', 'press_release', 'marketing', 'opinion', 'other'],
  },
  priority: { type: 'number', nullable: true },
  // ---- relevance ensemble (0053): external-scan only, trailing after priority ----
  relevance_spread: { type: 'number', nullable: true },
  relevance_votes: { type: 'string', nullable: true },
  // ---- signals-export extras (appended after the shared scan-shaped columns) ----
  significance: { type: 'string', nullable: false, enum: ['high', 'medium', 'low'] },
  lenses: { type: 'string', nullable: false },
  // Union of every domain's origin values (signals-export: manual/pipeline;
  // scout-companies: discovery/manual, unmapped before now; tooling-products:
  // tavily/hn/producthunt/github/enumeration/manual/feed). Widening the enum
  // to the union is additive: no domain's actual values fall outside it, and
  // each domain's data never produces another domain's values anyway.
  origin: {
    type: 'string', nullable: false,
    enum: ['manual', 'pipeline', 'discovery', 'tavily', 'hn', 'producthunt', 'github', 'enumeration', 'feed'],
  },
  claim_touches: { type: 'string', nullable: false },
  touch_details: { type: 'string', nullable: false },
  brief_what_happened: { type: 'string', nullable: true },
  brief_why_it_matters: { type: 'string', nullable: true },
  brief_whats_contested: { type: 'string', nullable: true },
  counterpoint: { type: 'string', nullable: true },
  atlas_url: { type: 'string', nullable: false, format: 'uri' },
  source_title: { type: 'string', nullable: true },
  // evidence_type (0065): what KIND of evidence a signal is, not what it is about.
  // Shared by the public `signals` dataset and the key-gated `signals-export`.
  evidence_type: {
    type: 'string', nullable: true,
    enum: ['experiment', 'statistics', 'survey', 'projection', 'announcement', 'analysis', 'other'],
  },
  // ---- intel-items extras (appended after the mirrored scan-shaped columns) ----
  doc_type: { type: 'string', nullable: false, enum: ['news', 'press', 'filing', 'transcript', 'report'] },
  company_slugs: { type: 'string', nullable: false },
  // tier: nullable here because an intel-items row's primary company can be
  // null (an item not linked to one registry company); intel_companies.tier
  // itself is never null, which this permissive nullable does not contradict.
  tier: { type: 'string', nullable: true, enum: ['self', 'card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'] },
  // ---- intel-companies ------------------------------------------------------
  slug: { type: 'string', nullable: false },
  name: { type: 'string', nullable: false },
  niche: { type: 'string', nullable: true },
  ticker: { type: 'string', nullable: true },
  cik: { type: 'string', nullable: true },
  rssd_id: { type: 'string', nullable: true },
  fdic_cert: { type: 'string', nullable: true },
  lei: { type: 'string', nullable: true },
  domain: { type: 'string', nullable: true },
  aliases: { type: 'string', nullable: false },
  active: { type: 'string', nullable: false, enum: ['yes', 'no'] },
  dossier_summary: { type: 'string', nullable: true },
  dossier_initiatives: { type: 'string', nullable: false },
  dossier_segments: { type: 'string', nullable: false },
  dossier_updated_at: { type: 'string', nullable: true, format: 'date-time' },
  created_at: { type: 'string', nullable: false, format: 'date' },
  updated_at: { type: 'string', nullable: false, format: 'date' },
  // ---- intel-facts / intel-metrics (company_slug shared by both) -----------
  company_slug: { type: 'string', nullable: false },
  company_name: { type: 'string', nullable: false },
  fact_id: { type: 'string', nullable: false, format: 'uuid' },
  dimension: {
    type: 'string', nullable: false,
    enum: ['strategy', 'products', 'tech_ai', 'financials', 'leadership', 'regulatory', 'ma_partnerships', 'brand', 'talent', 'risk'],
  },
  fact: { type: 'string', nullable: false },
  value_text: { type: 'string', nullable: true },
  as_of: { type: 'string', nullable: true, format: 'date' },
  source_url: { type: 'string', nullable: true, format: 'uri' },
  metric_code: { type: 'string', nullable: false },
  period: { type: 'string', nullable: false, format: 'date' },
  value: { type: 'number', nullable: true },
  unit: { type: 'string', nullable: true },
  source: { type: 'string', nullable: false, enum: ['edgar_xbrl', 'fdic', 'cfpb', 'y9c', 'ats'] },
  fetched_at: { type: 'string', nullable: false, format: 'date' },
  // ---- research-export (url, published_on, counterpoint, full_text shared above) --
  id: { type: 'string', nullable: false, format: 'uuid' },
  arxiv_id: { type: 'string', nullable: true },
  title: { type: 'string', nullable: false },
  review_status: { type: 'string', nullable: false, enum: ['tracked', 'noted'] },
  reviewed_on: { type: 'string', nullable: true, format: 'date' },
  rigor_prior: { type: 'number', nullable: true },
  citation_count: { type: 'number', nullable: true },
  author_hindex: { type: 'number', nullable: true },
  headline_claim: { type: 'string', nullable: true },
  the_test: { type: 'string', nullable: true },
  effect_size: { type: 'string', nullable: true },
  limitations: { type: 'string', nullable: true },
  econ_implication: { type: 'string', nullable: true },
  who_cares: { type: 'string', nullable: true },
  thread_slugs: { type: 'string', nullable: false },
  advisory_claim_touches: { type: 'string', nullable: false },
  promoted_signal_id: { type: 'string', nullable: true, format: 'uuid' },
  analyzed_by: { type: 'string', nullable: true },
  abstract: { type: 'string', nullable: true },
  // ---- Tooling Monitor (0054): tooling-products, tooling-events, --------
  // tooling-features, tooling-catalog. category/id/slug/name/url/title/
  // created_at/updated_at/enriched_by/dossier_summary above are shared keys,
  // reused as-is (compatible types/nullability); origin and url were widened
  // above. kind and source on tooling_events would collide with an unrelated
  // enum already claimed by another domain's use of those exact key names
  // (scout-events' kind, intel-metrics' source), so the exported columns are
  // named event_kind/event_source instead of overloading them.
  vendor: { type: 'string', nullable: true },
  vendor_domain: { type: 'string', nullable: true },
  category: { type: 'string', nullable: false },
  category_name: { type: 'string', nullable: false },
  secondary_categories: { type: 'string', nullable: false },
  one_liner: { type: 'string', nullable: true },
  description: { type: 'string', nullable: true },
  target_buyer: { type: 'string', nullable: false },
  deployment: { type: 'string', nullable: false },
  pricing_model: { type: 'string', nullable: true, enum: ['free', 'freemium', 'per_seat', 'usage', 'enterprise', 'unknown'] },
  pricing_note: { type: 'string', nullable: true },
  maturity: {
    type: 'string', nullable: false,
    enum: ['startup_early', 'startup_growth', 'scaleup', 'incumbent', 'big_tech', 'open_source_project', 'unknown'],
  },
  founded_year: { type: 'number', nullable: true },
  hq: { type: 'string', nullable: true },
  funding_note: { type: 'string', nullable: true },
  notable_customers: { type: 'string', nullable: false },
  integrations: { type: 'string', nullable: false },
  compliance_claims: { type: 'string', nullable: false },
  models_used: { type: 'string', nullable: false },
  features: { type: 'string', nullable: false },
  feed_url: { type: 'string', nullable: true },
  changelog_url: { type: 'string', nullable: true },
  github_repo: { type: 'string', nullable: true },
  status: { type: 'string', nullable: false, enum: ['candidate', 'cataloged', 'parked', 'dismissed'] },
  pinned: { type: 'number', nullable: false },
  agent_fit: { type: 'number', nullable: true },
  agent_relevance: { type: 'number', nullable: true },
  agent_enterprise_readiness: { type: 'number', nullable: true },
  agent_differentiation: { type: 'number', nullable: true },
  agent_momentum: { type: 'number', nullable: true },
  agent_build_difficulty: { type: 'number', nullable: true },
  agent_steal: { type: 'string', nullable: true },
  agent_reason: { type: 'string', nullable: true },
  agent_model: { type: 'string', nullable: true },
  customers: { type: 'string', nullable: true },
  sources: { type: 'string', nullable: true },
  deep_dive_summary: { type: 'string', nullable: true },
  deep_dived_at: { type: 'string', nullable: true, format: 'date' },
  found_url: { type: 'string', nullable: true, format: 'uri' },
  first_seen: { type: 'string', nullable: false, format: 'date' },
  last_seen: { type: 'string', nullable: false, format: 'date' },
  product_id: { type: 'string', nullable: false, format: 'uuid' },
  product_slug: { type: 'string', nullable: false },
  product_name: { type: 'string', nullable: false },
  event_date: { type: 'string', nullable: false, format: 'date' },
  event_kind: {
    type: 'string', nullable: false,
    enum: ['launch', 'funding', 'feature', 'pricing', 'partnership', 'news', 'changelog', 'note'],
  },
  event_source: { type: 'string', nullable: false, enum: ['feed', 'deepdive', 'discover', 'manual'] },
  feature: { type: 'string', nullable: false },
};

// The one-line human type description used in every handoff's field table
// ("string or null (direct | jina)"), shared so scan's and intel's handoff
// builders render columns identically. Falls back to the registry's own
// display type (text/number/date/enum/longtext) for an unmapped key.
export function describeFieldType(key: string, fallbackType: string): string {
  const f = FIELD_FACTS[key];
  if (!f) return fallbackType;
  return `${f.type}${f.nullable ? ' or null' : ''}${f.enum ? ` (${f.enum.join(' | ')})` : ''}`;
}

// The closed value set behind an enum column, when FIELD_FACTS carries one.
// Used by the filter grammar (lib/datasets/filter.ts) to reject an eq/ne/in
// value outside the set; undefined means FIELD_FACTS has no enum for this
// key, so the filter grammar validates it permissively (column-type only).
// A caller that has the registry's own DatasetColumn should prefer its
// `values` field first (it overrides a FIELD_FACTS collision on the same key
// from another domain, e.g. concepts.status vs tooling_products.status) and
// fall back to this lookup only when the column declares none.
export function fieldEnumValues(key: string): string[] | undefined {
  return FIELD_FACTS[key]?.enum;
}

// Same one-line type description as describeFieldType, but for a caller that
// has the registry's own DatasetColumn in hand and so can do what that
// function's own docstring says a caller should: prefer col.values over a
// FIELD_FACTS collision on the same key (concepts.status vs
// tooling_products.status is the one live example). Used by the generic
// per-dataset handoff (lib/datasets/handoff-generic.ts), which renders every
// registry column, including the ones the four hand-written domain handoffs
// never touch.
export function describeColumnType(col: DatasetColumn): string {
  const f = FIELD_FACTS[col.key];
  const enumValues = col.values ?? f?.enum;
  if (!f) return enumValues ? `${col.type} (${enumValues.join(' | ')})` : col.type;
  return `${f.type}${f.nullable ? ' or null' : ''}${enumValues ? ` (${enumValues.join(' | ')})` : ''}`;
}

// JSON Schema (draft 2020-12) for one row, generated from the live registry
// columns in order. Exported for the test scripts' coverage checks.
export function buildRowJsonSchema(def: DatasetDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const c of def.columns) {
    const f = FIELD_FACTS[c.key];
    const enumValues: string[] | undefined = c.values ?? f?.enum;
    if (!f) {
      const p: Record<string, unknown> = { type: ['string', 'number', 'null'], description: c.def };
      if (enumValues) p.enum = [...enumValues, null]; // the permissive type already allows null
      properties[c.key] = p;
      required.push(c.key);
      continue;
    }
    const p: Record<string, unknown> = {
      type: f.nullable ? [f.type, 'null'] : f.type,
      description: c.def,
    };
    if (enumValues) p.enum = f.nullable ? [...enumValues, null] : enumValues;
    if (f.format) p.format = f.format;
    properties[c.key] = p;
    required.push(c.key); // every key is PRESENT on every row; nullability is in the type
  }
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${def.slug} row`,
    type: 'object',
    properties,
    required,
    // Additive change policy: new fields may appear; intakes ignore them.
    additionalProperties: true,
  };
}

export function envelopeJsonSchema(def: DatasetDef, rowSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${def.slug} download`,
    type: 'object',
    required: ['dataset', 'rows'],
    properties: {
      dataset: {
        type: 'object',
        required: ['slug', 'day', 'row_count', 'columns'],
        properties: {
          slug: { const: def.slug },
          title: { type: 'string' },
          description: { type: 'string' },
          methodology: { type: 'string' },
          category: { type: 'string' },
          lens: { type: 'null' },
          day: { type: ['string', 'null'], format: 'date', description: 'Echoes the ?day= filter where the dataset supports one; null otherwise.' },
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

// ---------------------------------------------------------------------------
// Shared Transport-section prose (the 2026-09-23 per-person access key
// migration, plus the query grammar and saved views that shipped the same
// night). Five call sites render this identically, so it is written once
// here rather than five times: the four hand-written domain handoffs
// (lib/scan/handoff.ts's buildScanHandoff, lib/intel/handoff.ts's
// buildIntelHandoff, lib/tooling/handoff.ts's buildToolingHandoff,
// lib/research/handoff.ts's buildResearchHandoff) and the generic
// per-dataset handoff (lib/datasets/handoff-generic.ts's
// buildDatasetHandoff). Wording follows docs/data-portal.md's "Access
// model" and "Query grammar" sections, the source of truth for how this is
// described to a reader.

// (a) Authentication for scripts: the access key also travels as a header,
// not only the browser cookie the numbered "unlock once per browser" step
// sets.
export function authForScriptsParagraph(): string {
  return `Authentication for scripts: send the access key as
Authorization: Bearer atlas_... or X-Atlas-Key: atlas_... on every
/api/datasets/* request (the legacy shared key still works the same way
during the migration). The enter link above sets a cookie for a browser; a
script should send the header instead. Keys expire after 90 days, and a
401 response names why in its JSON body (key_required, key_expired, or
key_revoked), except a format=csv request, which gets the message as plain
text instead; the reason is always in the X-Atlas-Key-State response
header, so a script should key off the header rather than assume a JSON
body. An intake script should stop and alert on a 401 rather than retry.`;
}

// The SQL pushdowns a def declares, in prose, deriving the list from the
// registry (def.filters) rather than a hand-written per-dataset sentence.
// lens spells out its closed value set (SIGNAL_LENSES) since a script has no
// other way to discover it short of reading lib/datasets/core.ts.
export function pushdownsFor(def: DatasetDef): string {
  const parts: string[] = [];
  if (def.filters?.lens) parts.push(`lens=<one of ${SIGNAL_LENSES.join(', ')}>`);
  if (def.filters?.day) parts.push('day=YYYY-MM-DD, defaults to the latest completed day');
  if (def.filters?.since) parts.push('since=YYYY-MM-DD, an incremental lower bound on fetched_at');
  if (def.filters?.source) parts.push('source=<a single source code>');
  if (def.filters?.company) parts.push('company=<a single company slug>');
  return parts.length ? parts.join('; ') : 'none; every download here is a full-corpus pull';
}

// (b) The query grammar table: where/cols/sort/limit/q/schema=1, the op
// matrix per column type, and the caps. Fixed text (the grammar itself does
// not vary by dataset; lib/datasets/filter.ts's OPS_BY_TYPE is its
// authoritative twin), so this is a plain constant rather than a function.
const QUERY_GRAMMAR_TABLE = `| Param | Meaning |
| --- | --- |
| where=<col>:<op>:<value> | Repeatable, max 8. Ops by column type: enum eq, ne, in, isnull, notnull; text and longtext add contains (case-insensitive); number eq, ne, gt, gte, lt, lte, in, isnull, notnull; date eq, ne, gt, gte, lt, lte, isnull, notnull (YYYY-MM-DD; an ISO timestamp compares on its first 10 characters). in takes a comma list, max 20 values; isnull and notnull take no value; every where value is capped at 200 characters. |
| cols=a,b,c | Projection, in the given order; the CSV header and the JSON columns list both follow it. |
| sort=<col>:asc\|desc[,<col>:asc\|desc] | One param, up to 2 comma-separated keys, most significant first; a repeated sort= param is ignored. A stable tiebreak on the file's first column is always appended, nulls last. |
| limit=N | 1 to 50000, applied after where, q, and sort. |
| q=<text> | Case-insensitive substring over every text, longtext, and enum column, max 200 characters. |
| schema=1 | The JSON Schema of exactly this slice (the projected columns) plus the normalized spec; no rows, no download. |`;

// defs is one file (most domains) or several (the Intel Desk, the Tooling
// Monitor), so the pushdown line can either be inline or a per-file list.
export function queryGrammarParagraphs(defs: DatasetDef[]): string {
  const pushdownLines = defs.length === 1
    ? `Pushdowns this file declares: ${pushdownsFor(defs[0])}.`
    : defs.map((d) => `- ${d.slug}: ${pushdownsFor(d)}`).join('\n');
  return `Query grammar: every download in this system accepts the same
filter grammar, validated against the file's own column list before any
other work runs (an unknown column or op answers 400 naming the bad
token; an unknown enum value answers 400 too, but only for a column whose
value set the Columns table actually lists, since a column shown with no
value set accepts any value and matches zero rows instead of rejecting
it).

${QUERY_GRAMMAR_TABLE}

A filtered download's filename ends in -filtered (a sort-only request does
not count as filtering); the JSON envelope's dataset.filter field carries
the normalized spec whenever the grammar was used, null otherwise. A
where, in, sort, or q past its cap answers 400 with the reason in its
error field; limit past 50000 is clamped to 50000, not rejected. A dataset
whose built rows exceed 400,000 answers 413 to any where/cols/sort/limit/q
request, so narrow with a pushdown first.

${pushdownLines}`;
}

// (c) Saved views.
export function savedViewsParagraph(): string {
  return `Saved views: view=<uuid> applies a view saved from the dataset's
page on the Atlas. Any param the request also passes explicitly overrides
the same-named one stored in the view; the dataset's own access gate still
runs first, so a view can never grant access a plain download would not
already have.`;
}

// (d) The one-line schema=1 recommendation.
export function schemaHintLine(): string {
  return 'schema=1 returns the JSON Schema of exactly the requested slice; prefer it over a hand-maintained copy of the schema.';
}
