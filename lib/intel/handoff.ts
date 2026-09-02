import type { DatasetDef } from '../datasets/core';
// Explicit .ts extensions: loaded by plain Node in
// scripts/test-intel-datasets.mjs (type stripping), which resolves no
// extensionless specifiers for real (non-type-only) imports.
import {
  buildRowJsonSchema, cronLabel, describeFieldType, envelopeJsonSchema,
} from '../datasets/handoff-shared.ts';
import type { CronEntry } from '../datasets/handoff-shared.ts';
import { dimensionDigest } from './core.ts';
import type { IntelCompany } from '../types';

// Builds the importer handoff the /intel console renders (mirrors
// lib/scan/handoff.ts's buildScanHandoff): one orientation document covering
// all FOUR Intel Desk datasets for the coding assistant building the intake
// on the other side of a firewall. Generated from the live registry defs
// (schema) and the live company registry + cron config (roster/cadence) so
// none of the three halves can drift from what actually ships. No secrets:
// the portal key travels as a placeholder.
//
// Purpose order matches the scan handoff: system overview first, then each
// file formally (JSON Schema, the thing an intake validates against), then
// join-key, roster, and taxonomy guidance, then intake design guidance,
// transport last (the least stable part).

function findDef(defs: DatasetDef[], slug: string): DatasetDef {
  const d = defs.find((x) => x.slug === slug);
  if (!d) throw new Error(`buildIntelHandoff: missing dataset def for ${slug}`);
  return d;
}

function fieldTable(def: DatasetDef): string {
  return def.columns.map((c) => `| ${c.key} | ${describeFieldType(c.key, c.type)} | ${c.def} |`).join('\n');
}

function schemaBlock(def: DatasetDef): string {
  return JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);
}

const TIER_LABEL: Record<string, string> = {
  self: 'Self', card_issuer: 'Card issuers', consumer_bank: 'Consumer banks',
  fintech: 'Fintech', tech_platform: 'Tech platforms', wildcard: 'Wildcard',
};
const TIER_ORDER = ['self', 'card_issuer', 'consumer_bank', 'fintech', 'tech_platform', 'wildcard'];

function rosterByTier(companies: IntelCompany[]): string {
  const active = companies.filter((c) => c.active);
  if (!active.length) return '(registry currently empty)';
  const lines: string[] = [];
  for (const tier of TIER_ORDER) {
    const inTier = active.filter((c) => c.tier === tier);
    if (!inTier.length) continue;
    lines.push(`${TIER_LABEL[tier] ?? tier}:`);
    for (const c of inTier) {
      const ident = [c.ticker ? `ticker ${c.ticker}` : null].filter(Boolean).join(', ');
      lines.push(`- ${c.name} (${c.slug})${ident ? ` [${ident}]` : ''}`);
    }
  }
  return lines.join('\n');
}

export function buildIntelHandoff(opts: {
  defs: DatasetDef[];       // the four intel-* registry defs, any order
  companies: IntelCompany[]; // the live registry, for the current-roster section
  crons: CronEntry[];        // the /api/cron/intel vercel.json entries
  host: string;               // e.g. https://example.vercel.app
  generatedOn: string;        // YYYY-MM-DD
}): string {
  const { host, generatedOn, companies, crons } = opts;
  const items = findDef(opts.defs, 'intel-items');
  const companiesDef = findDef(opts.defs, 'intel-companies');
  const facts = findDef(opts.defs, 'intel-facts');
  const metrics = findDef(opts.defs, 'intel-metrics');
  const schedule = crons.map((c) => cronLabel(c.schedule)).join(', then ');

  return `# Intel Desk: import orientation and contract

Generated ${generatedOn} from the live dataset registry. Audience: the
assistant building the INTAKE on the other side of a firewall. This document
plus four files is the whole interface; design the intake from what is
written here, and treat each file's own dataset.columns array as the runtime
source of truth if this document and it ever disagree.

## 1. What this system is

A company-intelligence desk: a registry of companies under standing
coverage, organized into tiers (a self tier, card issuers, consumer banks,
fintechs, tech platforms, and an open wildcard tier). It collects daily from
public press feeds, per-company web search, and SEC EDGAR filings, runs a
light model enrichment pass over each collected document (a short summary,
dimension tags, named entities, an advisory significance score), and
extracts structured FACTS from it (a dimension, a fact statement, an
optional value and as-of date, with provenance back to the source
document). A separate, LLM-free leg pulls quarterly METRICS directly from
public structured APIs (SEC EDGAR XBRL, FDIC, CFPB): no model ever touches
that table.

The division of labor mirrors the Atlas's External Scan:
- OUTSIDE (this desk): discovery, fetching, light annotation, fact
  extraction. It makes NO investment or acquisition judgment.
- INSIDE (the intake you are building and its downstream): validation,
  storage, dedupe against internal state, and all analytical judgment.
  Tags, facts, and significance arrive as advisory hints, never verdicts.

Four files, downloaded independently:
- intel-items: one collection day at a time, the External Scan's shape.
- intel-companies, intel-facts, intel-metrics: full corpus on every
  download (re-import replaces; upsert makes that idempotent).

## 2. The four files, formally

### 2.1 intel-items: one day of collected documents

One row per document collected on one UTC day, mirroring the External
Scan's twenty columns key for key, in the same order, so one intake
validates both scan and intel files: topic_slug carries the item's primary
company_slug, tags carries its dimension codes, relevance carries its
significance score. topic_code is always null here (no company-level
taxonomy code exists; the taxonomy lives on dimensions, already riding
tags). full_text is a composed document, not raw article text alone:
headline, then SUMMARY, then EXTRACTED FACTS (this item's own facts, with
their dimension, value, and as-of date), then ARTICLE TEXT, joined and
capped at 24,000 characters.

\`\`\`json
${schemaBlock(items)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(items)}

### 2.2 intel-companies: the registry

One row per company under coverage, active or not. This is the smallest
and most stable of the four files: re-download it whenever the registry
might have changed.

\`\`\`json
${schemaBlock(companiesDef)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(companiesDef)}

### 2.3 intel-facts: extracted facts

One row per extracted fact, deduped per company at write time (the desk's
own dedupe keys on a normalized form of the fact text, so a fact is added
once and kept, never overwritten by a near-duplicate re-extraction).

\`\`\`json
${schemaBlock(facts)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(facts)}

### 2.4 intel-metrics: structured series

One row per (company, metric, period, source). No model output anywhere in
this file: every value traces to a public structured API.

Metric naming:
- fdic_<mnemonic>: FDIC RIS call-report-derived fields for the bank
  subsidiary. Mnemonics follow FDIC's own data dictionary at
  https://api.fdic.gov/banks/docs/risview_properties.yaml.
- y9c_<mdrm>: FR Y-9C holding-company consolidated items. Codes follow the
  Federal Reserve's MDRM data dictionary at
  https://www.federalreserve.gov/apps/mdrm/.
- edgar_xbrl metric codes are the desk's own curated concept names
  (revenue, net_income, and so on), not raw XBRL tags.
- cfpb_complaints_month is a calendar-month consumer-complaint count;
  cfpb_complaints_30d is a trailing-30-day point sample. Both are counts,
  not the same series at different granularities.

Quarterly sources are period-stamped by report date. Every row upserts
idempotently on (company_slug, metric_code, period, source).

\`\`\`json
${schemaBlock(metrics)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(metrics)}

## 3. Join keys and licensed data

company_slug is the internal spine: it is the stable join key across all
four files, and the only one guaranteed to always be present. ticker, cik,
rssd_id, fdic_cert, and lei exist on intel-companies specifically so an
importer can join LICENSED datasets held inside their own environment, for
example an AlphaSense or S&P Capital IQ extract, onto this spine. State this
plainly to anyone building on top of the intake: no licensed content of any
kind is ever present in these files. Every field in all four files traces
to a public source: press feeds, public web search, SEC filings, or public
structured APIs.

## 4. Companies currently tracked

The registry roster at generation time, by tier. Treat this as a snapshot,
not a fixed list: the intel-companies file is the live source of truth on
every download.

${rosterByTier(companies)}

## 5. Dimension taxonomy

The fixed set that dimension (on intel-facts) and the entries inside tags
(on intel-items) are drawn from. Treat it as a closed set for validation,
but expect it to grow with a future deploy; an unknown code should be
stored, not rejected.

${dimensionDigest()}

## 6. Update cadence

The collection engine runs on UTC WEEKDAYS at ${schedule || 'a scheduled time'},
the same cadence as the External Scan. A Monday run carries the weekend
window (the weekend's news does not get lost) and additionally refreshes
the metrics table and every active company's dossier for the week.
intel-items therefore only ever has weekday files; intel-companies,
intel-facts, and intel-metrics can change on any weekday download.

## 7. Intake design guidance

- Upsert intel-items keyed on item_id (fall back to normalized_url if your
  storage prefers a natural key); the intake must be IDEMPOTENT.
- Upsert intel-companies keyed on slug.
- Upsert intel-facts keyed on company_slug plus a normalized form of the
  fact text (the desk's own dedupe key; two extractions of the same fact
  collapse to one row upstream, so a plain company_slug plus fact_id upsert
  is also safe).
- Upsert intel-metrics keyed on the four-part natural key: company_slug,
  metric_code, period, source.
- Import every intel-items row, including fetch failures and unenriched
  items: they still carry discovery metadata the downstream triage wants.
- Ignore unknown row fields (the contract is additive: new columns may
  appear) and diff each envelope's dataset.columns against your
  expectations to detect schema drift early, loudly, and without failing
  the import.
- Do not re-judge inside what the desk already encoded: store tags, facts,
  and significance verbatim as advisory inputs to your own analysis.
- The CSV variant of every file is the same contract flattened: identical
  keys as headers, UTF-8 BOM, CRLF rows, RFC-4180 quoting, lists
  pre-joined with "; ". Prefer JSON; it needs no quoting rules.

## 8. Transport (the least stable section; mechanics may change)

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; the key comes from the desk's operator, never this doc).
2. Download intel-items for the latest completed day:
   ${host}/api/datasets/intel-items?format=json&download=1
   A specific day: append &day=YYYY-MM-DD. CSV instead: format=csv.
3. Download the other three files (always the full corpus):
   ${host}/api/datasets/intel-companies?format=json&download=1
   ${host}/api/datasets/intel-facts?format=json&download=1
   ${host}/api/datasets/intel-metrics?format=json&download=1
   intel-metrics supports incremental pulls: append &since=YYYY-MM-DD
   (rows with fetched_at on or after that date) and/or &source=<code>
   (edgar_xbrl, fdic, cfpb, y9c, or ats), together or alone. A weekly
   &since=<the date of your last pull> download is the intended intake
   once the initial full corpus is in hand.
4. Fresh data lands via scheduled weekday runs; the intel-items default URL
   always serves the latest COMPLETED day, never a partial one.
`;
}
