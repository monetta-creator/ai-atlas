import type { DatasetDef } from './core';
// Explicit .ts extension: a real (non type-only) import, so plain Node
// (scripts/test-dataset-handoff.mjs, type stripping) resolves it exactly
// like the rest of this module chain (see filter.ts/registry.ts).
import {
  authForScriptsParagraph, buildRowJsonSchema, describeColumnType, envelopeJsonSchema,
  queryGrammarParagraphs, savedViewsParagraph, schemaHintLine,
} from './handoff-shared.ts';

// A generic, per-dataset importer orientation document: the same shape the
// four hand-written domain handoffs render by hand (lib/scan/handoff.ts,
// lib/intel/handoff.ts, lib/tooling/handoff.ts, lib/research/handoff.ts),
// generated straight from one registry def with no domain-specific prose.
// Serves GET /api/datasets/<slug>/handoff for EVERY dataset in the registry,
// including the ones with no hand-written sibling (signals,
// argument-nodes/edges, evidence-ledger, sources, concepts, and so on).
//
// Pure: no DB, no Request. The route (app/api/datasets/[slug]/handoff/
// route.ts) does the identity gate itself and passes only this dataset's own
// origin, so this module has nothing to fail on.

function columnTable(def: DatasetDef): string {
  return def.columns
    .map((c) => `| ${c.key} | ${describeColumnType(c)} | ${c.def} |`)
    .join('\n');
}

function accessParagraph(def: DatasetDef, origin: string): string {
  if (def.keyGated) {
    return `This dataset requires an access key. Unlock a browser once at
${origin}/datasets/enter?k=<key> (sets a 30-day cookie), or send the key on
every request; see Authentication for scripts below. A 401 response names
why in its JSON body (key_required, key_expired, or key_revoked) and
repeats the same state in the X-Atlas-Key-State response header. The
legacy shared key still works the same way during the migration. Admins
pass this gate implicitly.`;
  }
  return `This dataset is public: no access key is required. A key still
works if sent, and unlocks nothing further for this file.`;
}

function statusSemantics(def: DatasetDef): string {
  const line401 = def.keyGated
    ? '- 401: no active access key was sent (see Access above); the body names key_required, key_expired, or key_revoked.'
    : '- 401: never returned; this dataset requires no access key.';
  return `- 200: the request succeeded; the body is CSV or JSON as
  requested, or the schema envelope alone for schema=1.
- 400: a where, cols, sort, limit, or q token was malformed or unknown, or
  the request tried to filter or sort an oversized dataset with no
  pushdown set first; the error field names the problem.
${line401}
- 413: the request's built row count exceeded the row-count cap for a
  JS-side filter or sort pass; narrow the slice with a pushdown (lens,
  day, since, source, company) first. A where clause runs after the
  build and does not help.`;
}

export function buildDatasetHandoff(def: DatasetDef, opts: { origin: string }): string {
  const { origin } = opts;
  const schemaJson = JSON.stringify(envelopeJsonSchema(def, buildRowJsonSchema(def)), null, 2);
  const columns = columnTable(def);

  return `# ${def.title}: import orientation and contract

Generated from the live dataset registry. Audience: a script or a coding
assistant orienting on this dataset for the first time. Treat this file's
own dataset.columns array, inside the JSON envelope below, as the runtime
source of truth if this document and it ever disagree.

## 1. What this is

${def.description}

${def.methodology}

## 2. Access

${accessParagraph(def, origin)}

## 3. Columns

Every key is present on every row; absence of a value is null, never a
missing key. Cells are only ever string, number, or null.

| key | type | definition |
|---|---|---|
${columns}

## 4. The file, formally (JSON Schema, draft 2020-12)

The JSON download is one envelope object: dataset (metadata plus the
runtime column schema) and rows. Validate rows against this schema;
quarantine a failing row rather than rejecting the whole file.

\`\`\`json
${schemaJson}
\`\`\`

## 5. Query grammar

${queryGrammarParagraphs([def])}

${savedViewsParagraph()}

${schemaHintLine()}

## 6. Example requests

Plain download: ${origin}/api/datasets/${def.slug}?format=json
A capped peek: ${origin}/api/datasets/${def.slug}?preview=20
Schema only, no rows: ${origin}/api/datasets/${def.slug}?schema=1

## 7. Status semantics

${statusSemantics(def)}

## 8. Intake design guidance

${authForScriptsParagraph()}

Ignore unknown row fields: the contract is additive, so new columns may
appear over time. Diff the envelope's dataset.columns against your
expectations to detect schema drift early, loudly, and without failing the
import. The CSV variant of this file is the same contract flattened:
identical keys as headers, UTF-8 BOM, CRLF rows, RFC-4180 quoting, and any
list-shaped column pre-joined with a semicolon. Prefer JSON; it needs no
quoting rules.
`;
}
