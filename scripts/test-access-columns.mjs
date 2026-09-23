// Regression test for the public/portal/admin column allow-lists that gate
// what a non-admin viewer's SELECT can ever return (Startup Scout, the AI
// Tooling Monitor, and the portal-only report kinds). Pure, no DB: the
// column lists live in lib/data/tooling-columns.ts and lib/data/scout-columns.ts
// specifically so this suite can load them without lib/db. Node type
// stripping loads the .ts modules directly.
// Run: node scripts/test-access-columns.mjs

import assert from 'node:assert/strict';
import {
  PRODUCT_PUBLIC_COLUMNS, PRODUCT_PORTAL_COLUMNS,
} from '../lib/data/tooling-columns.ts';
import { COMPANY_PUBLIC_COLUMNS } from '../lib/data/scout-columns.ts';
import { PORTAL_ONLY_KINDS, canReadKind } from '../lib/reports/access.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('access columns:');

// Column identifiers, alias AND raw expression: strips a `to_char(...) as
// alias` projection down to the alias for the name a caller would see, but
// also keeps the raw SQL text, so a forbidden pattern can't hide inside a
// SQL expression under an innocent alias (e.g. `raw_content as summary`)
// while a legitimate alias (first_seen, last_seen) still matches on its name.
function columnNames(list) {
  return list.map((c) => {
    const asMatch = c.match(/\bas\s+(\w+)\s*$/i);
    const name = asMatch ? asMatch[1] : c.trim();
    return { raw: c, name };
  });
}

// Splits the scout template-literal column string on commas into {raw, name}
// pairs (dropping any `::text as alias` cast for the name) the same way.
function scoutColumnNames(sql) {
  return sql
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((c) => {
      const asMatch = c.match(/\bas\s+(\w+)\s*$/i);
      const name = asMatch ? asMatch[1] : c;
      return { raw: c, name };
    });
}

// Adjusted from the spec's literal patterns for two legitimately public
// columns the spec's own regex would otherwise flag:
//  - tooling: `dossier` and `pinned` are both rendered on the public
//    /tooling/[slug] page (the dossier prose, and the "Pinned by an editor"
//    star) — only the PORTAL-only `deep_dive` (the Sonnet research leg) is
//    forbidden, so `dossier` is dropped from the pattern and `pinned$` is
//    dropped entirely (the admin-only `deep_dived_at` timestamp still trips
//    `deep_dive`, so a genuine leak there is still caught).
//  - scout: `funding_note` is public by design (a company fact, not the
//    admin review note) and ends in "note" same as `review_note`, so the
//    bare `note$` alternative is narrowed to an exact-name match.
const TOOLING_FORBIDDEN = /^agent_|deep_dive|raw_content|review_note|reviewed_at|fetch_|found_url|internal/;
const SCOUT_FORBIDDEN = /^agent_|dossier|raw_content|review_note|reviewed_at|fetched_|found_url|run_id|^note$|verdict|score/;

check('tooling public columns carry no portal/admin/agent field', () => {
  const cols = columnNames(PRODUCT_PUBLIC_COLUMNS);
  for (const { raw, name } of cols) {
    assert.ok(
      !TOOLING_FORBIDDEN.test(name) && !TOOLING_FORBIDDEN.test(raw),
      `"${raw}" in PRODUCT_PUBLIC_COLUMNS matches the forbidden pattern ${TOOLING_FORBIDDEN}`
    );
  }
});

check('scout public columns carry no admin/agent field', () => {
  const cols = scoutColumnNames(COMPANY_PUBLIC_COLUMNS);
  for (const { raw, name } of cols) {
    assert.ok(
      !SCOUT_FORBIDDEN.test(name) && !SCOUT_FORBIDDEN.test(raw),
      `"${raw}" in COMPANY_PUBLIC_COLUMNS matches the forbidden pattern ${SCOUT_FORBIDDEN}`
    );
  }
});

check('PORTAL_ONLY_KINDS includes intel_deck', () => {
  assert.ok(PORTAL_ONLY_KINDS.includes('intel_deck'));
});

check('canReadKind: intel_deck is portal/admin only, never guest', () => {
  assert.equal(canReadKind('intel_deck', { admin: false, portal: false }), false);
  assert.equal(canReadKind('intel_deck', { admin: false, portal: true }), true);
  assert.equal(canReadKind('intel_deck', { admin: true, portal: false }), true);
});

check('the portal tooling column list is a superset of the public list', () => {
  const portalSet = new Set(PRODUCT_PORTAL_COLUMNS);
  for (const c of PRODUCT_PUBLIC_COLUMNS) {
    assert.ok(portalSet.has(c), `"${c}" is in PRODUCT_PUBLIC_COLUMNS but missing from PRODUCT_PORTAL_COLUMNS`);
  }
});

// The superset check above only catches a DROPPED public column; it says
// nothing about an ADMIN-only field added to the portal list by mistake
// (e.g. review_note or raw_content, a keyholder-visible leak). Check the
// portal list separately against the fields that stay admin-only in
// PRODUCT_ADMIN_COLUMNS beyond the portal list.
const TOOLING_ADMIN_ONLY = /raw_content|review_note|reviewed_at|fetch_|found_|run_id|origin|enriched_|agent_model|agent_at|deep_dived_at|feed_checked_at/;
check('the portal tooling column list carries no admin-only field', () => {
  const cols = columnNames(PRODUCT_PORTAL_COLUMNS);
  for (const { raw, name } of cols) {
    assert.ok(
      !TOOLING_ADMIN_ONLY.test(name) && !TOOLING_ADMIN_ONLY.test(raw),
      `"${raw}" in PRODUCT_PORTAL_COLUMNS matches the admin-only pattern ${TOOLING_ADMIN_ONLY}`
    );
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
