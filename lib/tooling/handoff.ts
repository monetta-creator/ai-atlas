import type { DatasetDef } from '../datasets/core';
// Explicit .ts extensions: loaded by plain Node in
// scripts/test-tooling-datasets.mjs (type stripping), which resolves no
// extensionless specifiers for real (non-type-only) imports.
import {
  buildRowJsonSchema, cronLabel, describeFieldType, envelopeJsonSchema,
} from '../datasets/handoff-shared.ts';
import type { CronEntry } from '../datasets/handoff-shared.ts';
import type { ToolingCategory } from '../types';

// Builds the importer handoff the /tooling/console renders (mirrors
// lib/intel/handoff.ts's buildIntelHandoff): one orientation document
// covering all FOUR Tooling Monitor datasets for the assistant building the
// intake on the other side of a firewall. Generated from the live registry
// defs (schema) and the live category registry + cron config (roster/cadence)
// so none of the three halves can drift from what actually ships. No
// secrets: the portal key travels as a placeholder.
//
// Section order matches the Intel Desk handoff: system overview first, then
// each file formally (JSON Schema, the thing an intake validates against),
// then join keys and identity, the live category roster, the curation
// statuses and how to treat a transition, intake design guidance, transport
// last (the least stable part).

function findDef(defs: DatasetDef[], slug: string): DatasetDef {
  const d = defs.find((x) => x.slug === slug);
  if (!d) throw new Error(`buildToolingHandoff: missing dataset def for ${slug}`);
  return d;
}

function fieldTable(def: DatasetDef): string {
  return def.columns.map((c) => `| ${c.key} | ${describeFieldType(c.key, c.type)} | ${c.def} |`).join('\n');
}

function schemaBlock(def: DatasetDef): string {
  return JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);
}

function categoryRoster(categories: ToolingCategory[]): string {
  const active = categories.filter((c) => c.active).slice().sort((a, b) => a.sort_order - b.sort_order);
  if (!active.length) return '(the category registry is currently empty)';
  return active.map((c) => `- ${c.name} (${c.slug})`).join('\n');
}

export function buildToolingHandoff(opts: {
  defs: DatasetDef[];        // the four tooling-* registry defs, any order
  categories: ToolingCategory[]; // the live category registry, for the roster section
  crons: CronEntry[];         // the /api/cron/tooling vercel.json entries (weekly)
  host: string;                // e.g. https://example.vercel.app
  generatedOn: string;         // YYYY-MM-DD
}): string {
  const { host, generatedOn, categories, crons } = opts;
  const products = findDef(opts.defs, 'tooling-products');
  const events = findDef(opts.defs, 'tooling-events');
  const features = findDef(opts.defs, 'tooling-features');
  const catalog = findDef(opts.defs, 'tooling-catalog');
  const schedule = crons.map((c) => cronLabel(c.schedule)).join(', then ');

  return `# AI Tooling Monitor: import orientation and contract

Generated ${generatedOn} from the live dataset registry. Audience: the
assistant building the INTAKE on the other side of a firewall. This document
plus four files is the whole interface; design the intake from what is
written here, and treat each file's own dataset.columns array as the runtime
source of truth if this document and it ever disagree.

## 1. What this system is

A market monitor for AI tooling: a curated registry of product categories
(coding assistants, agent platforms, enterprise search, and so on), swept
weekly for new and updated products by web search, Hacker News, Product
Hunt, and GitHub. A cheap model extracts descriptive facts from each
product's homepage; a scoring agent gives an advisory fit read for a
regulated financial-services buyer; a product at or above the catalog score
threshold whose homepage could be read enters the public catalog
automatically; anything else (below the threshold, or no readable homepage)
is parked for human review, and a human decision (catalog, park, dismiss) is
sticky.
High-fit new entrants get an automatic deep dive (a further web-researched
read: strengths, weaknesses, pricing detail, competitors, recent news); any
product can get one on demand.

The division of labor mirrors the Atlas's other collection engines:
- OUTSIDE (this monitor): discovery, fetching, descriptive extraction, an
  advisory fit score. It makes no purchase or build-versus-buy decision.
- INSIDE (the intake you are building and its downstream): validation,
  storage, dedupe against internal state, and all procurement judgment.
  The fit score and rubric dimensions arrive as advisory hints, never
  verdicts.

Four files, downloaded independently:
- tooling-products, tooling-events, tooling-features: full corpus on every
  download (re-import replaces; upsert makes that idempotent).
- tooling-catalog: the same corpus filtered to cataloged products only, with
  no agent, dossier, deep dive, or curation column. This is the one file
  that needs no team key; the other three do.

Identity is stable across a product's life: id never changes, slug rarely
changes (only on a deliberate rename), and url can change at any time (a
homepage move, a redirect, a vendor rebrand) without affecting identity.
Always join and upsert on id, never on url.

## 2. The four files, formally

### 2.1 tooling-products: the full catalog

One row per product with a status other than dismissed: candidates still
awaiting human review, cataloged products, and parked products (reviewed and
kept for reference but not promoted) are all included; only dismissed
products are dropped. agent_fit and the five agent_* rubric dimensions
(relevance, enterprise readiness, differentiation, momentum, build
difficulty, each 1 to 5) are the scoring agent's advisory read, never a
verdict, and are null until a product has been scored. agent_steal lists up
to three features the agent flagged as worth stealing. dossier_summary,
customers, and sources come from the machine's own merged research record
(homepage enrichment plus any deep dive), monotonically updated, never
overwritten by an older read. deep_dive_summary and deep_dived_at are null
until a deep dive has run. pinned is 1 when a human has pinned the product
so neither the agent nor a re-score can relabel its status.

\`\`\`json
${schemaBlock(products)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(products)}

### 2.2 tooling-events: product timelines

One row per event on a non-dismissed product: launches, funding, feature or
pricing changes, partnerships, changelog entries picked up by the weekly
feed poll, and notable news. event_source names what logged it (feed,
deepdive, discover, or manual); event_kind names what kind of event it is.
The admin's private working note behind an event (why it was logged, in
what context) never appears in this or any file.

\`\`\`json
${schemaBlock(events)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(events)}

### 2.3 tooling-features: the feature matrix, long form

One row per (product, normalized feature tag), cataloged and parked products
only. Feature tags are free-form at discovery time and normalized in code
into a shared vocabulary, capped per product, so this file is the
who-does-what comparison across a category: pivot feature against
product_slug (or category) to see coverage and gaps.

\`\`\`json
${schemaBlock(features)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(features)}

### 2.4 tooling-catalog: the public slice

Cataloged products only, the same floor the public /tooling hub renders,
with no agent score, dossier, deep dive, status, pinned flag, origin, or
found_url column: none of that exists in this file at all. This is the one
tooling file that needs no team key; download it for a guest-safe, purely
descriptive read of the market.

\`\`\`json
${schemaBlock(catalog)}
\`\`\`

Field guarantees:

| key | type | definition |
|---|---|---|
${fieldTable(catalog)}

## 3. Join keys and identity

id (a UUID) is the stable spine across all four files: tooling-events.
product_id and tooling-features.product_id both join tooling-products.id
(and tooling-catalog.id for the cataloged subset). slug is the second
stable identifier, used in the product's Atlas URL (/tooling/<slug>) and
denormalized onto tooling-events and tooling-features as product_slug for
convenience; it changes only on a deliberate rename. url is NOT a stable
identifier: it can change at any time without the product's identity
changing, so never key an upsert on it. category is the join to the live
category registry (see section 4): it is a slug, not a fixed enum, because
the registry is human-editable.

## 4. Categories currently active

The category registry at generation time. Treat this as a snapshot, not a
fixed list: it is human-curated and can gain or lose entries at any time,
so a product's category value should be stored even when it names a
category your intake has not seen before.

${categoryRoster(categories)}

## 5. Curation statuses

status on tooling-products (and, filtered, on tooling-features) is the
human curation layer, and it is STICKY once a human sets it:
- candidate: found by discovery, not yet reviewed. Absent from
  tooling-catalog and tooling-features.
- cataloged: in the public catalog, either by scoring at or above the catalog
  threshold with a readable homepage or by a human's decision. Present in
  every file.
- parked: reviewed and kept for reference, but not promoted to the public
  catalog. Present in tooling-products and tooling-features, absent from
  tooling-catalog.
- dismissed: reviewed and rejected. Absent from every file; a dismissed
  product never re-enters discovery, so treat its disappearance from a
  re-download as a terminal signal, not a data gap.

A status transition (candidate to cataloged, cataloged to parked, and so
on) is a normal, expected event on re-download: update your stored status to
match, do not treat it as an anomaly.

## 6. Update cadence

The discovery and catalog engine runs WEEKLY, at ${schedule || 'a scheduled time'}.
A one-time, much larger enumeration pull may also run outside this weekly
cadence (an admin-initiated backfill); its results land in the same four
files and are indistinguishable from weekly discoveries once cataloged.

## 7. Intake design guidance

- Upsert tooling-products keyed on id; the intake must be IDEMPOTENT.
  Fall back to slug only if your storage strongly prefers a natural key.
- Upsert tooling-events keyed on id.
- Treat tooling-features as a derived join table: replace a product's rows
  wholesale on each re-download rather than diffing tag by tag, since the
  underlying feature list can be re-normalized between runs.
- Import every tooling-products row, including candidates still awaiting
  review: they still carry discovery metadata a downstream triage may want,
  and a candidate that is cataloged next week should read as an update, not
  a new row.
- Treat features as an open TAG LIST, not a fixed enum: new tags appear as
  the market and the normalization vocabulary evolve.
- Do not re-judge inside what the monitor already encoded: store agent_fit,
  the rubric dimensions, and agent_steal verbatim as advisory inputs to your
  own build-versus-buy analysis, never as a final verdict.
- Ignore unknown row fields (the contract is additive: new columns may
  appear) and diff each envelope's dataset.columns against your
  expectations to detect schema drift early, loudly, and without failing
  the import.
- The CSV variant of every file is the same contract flattened: identical
  keys as headers, UTF-8 BOM, CRLF rows, RFC-4180 quoting, lists pre-joined
  with "; ". Prefer JSON; it needs no quoting rules.

## 8. Transport (the least stable section; mechanics may change)

1. Unlock once per browser: ${host}/datasets/enter?k=<PORTAL_KEY> (sets a
   30-day cookie; the key comes from the monitor's operator, never this
   doc).
2. Download the full corpus of each file:
   ${host}/api/datasets/tooling-products?format=json&download=1
   ${host}/api/datasets/tooling-events?format=json&download=1
   ${host}/api/datasets/tooling-features?format=json&download=1
   CSV instead of JSON: format=csv.
3. The public, no-key slice:
   ${host}/api/datasets/tooling-catalog?format=json&download=1
4. Fresh data lands via the scheduled weekly run (plus, occasionally, an
   admin-initiated backfill pull); re-download any file at any time for the
   current full corpus.
`;
}
