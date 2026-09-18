import type { DatasetDef } from './core';

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

// JSON Schema (draft 2020-12) for one row, generated from the live registry
// columns in order. Exported for the test scripts' coverage checks.
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
