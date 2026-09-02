// Test for the Datasets portal registry (lib/datasets/*), in the injected-Q
// style of scripts/test-thesis.mjs. READ-ONLY: never writes a row.
//
// Asserts, per registry dataset:
//   1. guest-safety  — no personal-layer key ever appears in any built row
//                      (exact keys and substrings), and every signal-derived row
//                      traces to a published signal (independent SQL recount)
//   2. determinism   — two builds are deep-equal
//   3. shape         — every row carries exactly the registry's column keys, and
//                      every cell is string | number | null
//   4. house style   — no em dash in any registry string (title, description,
//                      methodology, column labels/defs)
//   5. registry      — unique URL-safe slugs; the catalog dataset mirrors the
//                      registry exactly
//   6. CSV           — header is the column keys; a quote-aware round-trip parse
//                      yields the right record and field counts
//
// Run: node scripts/test-datasets.mjs   (loads .env.local; DATABASE_URL, else SUPABASE_DB_*)

import { config } from 'dotenv';
config({ path: '.env.local' });
import assert from 'node:assert/strict';
import pg from 'pg';
import { DATASETS, getDataset } from '../lib/datasets/registry.ts';
import { isSignalLens, SIGNAL_LENSES } from '../lib/datasets/core.ts';
import { datasetFileName, datasetToCSV } from '../lib/datasets/serialize.ts';
import { buildRowJsonSchema } from '../lib/datasets/handoff-shared.ts';

const client = process.env.DATABASE_URL
  ? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new pg.Client({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT),
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      database: process.env.SUPABASE_DB_NAME,
      ssl: { rejectUnauthorized: false },
    });
await client.connect();
// Serialize queries: builders issue Promise.all batches, which a bare pg.Client
// (unlike the app's pool) cannot run concurrently.
let queue = Promise.resolve();
const q = (sql, params) => {
  const run = queue.then(() => client.query(sql, params).then((r) => r.rows));
  queue = run.catch(() => {});
  return run;
};

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
};

// Personal-layer names that may never appear as a row key. `note` is exact
// (methodology text lives in the registry, not in rows); the substrings catch
// derived spellings.
const BANNED_EXACT = new Set([
  'confidence', 'confidence_label', 'domain_note', 'reliability_prior',
  'dossier', 'note', 'touch_details', 'review_note', 'rigor_prior', 'admin_note',
]);
const BANNED_SUBSTRINGS = ['rationale', 'snapshot', 'confidence', 'prior', 'dossier'];
// The scoped exceptions (see lib/datasets/core.ts): per-touch direction +
// editorial reason, the Intel Desk's merged dossier fields, and the Research
// Portal's rigor_prior, may ride KEY-GATED datasets only; the portal key is
// the boundary, the same as bulk article text. dossier_* here is the Intel
// Desk's own machine-merged research record (lib/scout/core.ts mergeDossier),
// not the admin note/prior personal layer the ban exists to protect;
// intel-companies is key-gated. rigor_prior on research-export is the
// research library's own per-paper editorial number (distinct from the
// argument map's confidence/reliability_prior personal layer it never
// touches or gates); research-export is key-gated. Never widen this to the
// argument map's personal layer proper (confidence, source reliability
// priors, rationales stay banned everywhere).
const KEY_GATED_ALLOWED = new Set([
  'touch_details',
  'dossier_summary', 'dossier_initiatives', 'dossier_segments', 'dossier_updated_at',
  'rigor_prior',
]);
const EM_DASH = '—';

// Quote-aware CSV parse (RFC-4180-ish, CRLF records) for the round-trip check.
function parseCSV(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field); field = ''; records.push(record); record = []; i++;
    } else {
      field += ch;
    }
  }
  record.push(field);
  records.push(record);
  return records;
}

// ---- 5) registry integrity (no DB) ------------------------------------------
check('registry: slugs unique and URL-safe', () => {
  const slugs = DATASETS.map((d) => d.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, /^[a-z0-9-]+$/);
});
check('registry: getDataset round-trips, unknown is null', () => {
  for (const d of DATASETS) assert.equal(getDataset(d.slug), d);
  assert.equal(getDataset('nope'), null);
});
check('registry: column keys unique per dataset, snake_case', () => {
  for (const d of DATASETS) {
    const keys = d.columns.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, d.slug);
    for (const k of keys) assert.match(k, /^[a-z0-9_]+$/, `${d.slug}.${k}`);
  }
});
check('registry: house style, no em dash anywhere', () => {
  for (const d of DATASETS) {
    for (const s of [d.title, d.description, d.methodology]) {
      assert.ok(!s.includes(EM_DASH), `${d.slug}: ${s.slice(0, 60)}`);
    }
    for (const c of d.columns) {
      assert.ok(!c.label.includes(EM_DASH) && !c.def.includes(EM_DASH), `${d.slug}.${c.key}`);
    }
  }
});
check('registry: every dataset carrying full_text is heavy and key-gated', () => {
  // full_text is not itself a banned key (articles-full-text, external-scan,
  // signals-export, intel-items, research-export all legitimately carry bulk
  // third-party or retained text), but it must never ship un-gated: this is
  // the regression guard for that, independent of the personal-layer ban above.
  for (const d of DATASETS) {
    if (d.columns.some((c) => c.key === 'full_text')) {
      assert.ok(d.keyGated, `${d.slug} carries full_text but is not keyGated`);
      assert.ok(d.heavy, `${d.slug} carries full_text but is not heavy`);
    }
  }
});
check('helpers: isSignalLens + datasetFileName', () => {
  assert.ok(isSignalLens('labor'));
  assert.ok(!isSignalLens('vibes'));
  assert.equal(SIGNAL_LENSES.length, 6);
  const sig = DATASETS.find((d) => d.slug === 'signals');
  // Every filename carries a date: the served day / since when given, else the
  // UTC generation date (a firewall folder of pulls must sort by itself).
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(datasetFileName(sig, 'csv'), `atlas-signals-${today}.csv`);
  assert.equal(datasetFileName(sig, 'json', 'labor'), `atlas-signals-labor-${today}.json`);
  assert.equal(datasetFileName(sig, 'json', undefined, '2026-09-01'), 'atlas-signals-2026-09-01.json');
  assert.equal(datasetFileName(sig, 'json', undefined, undefined, '2026-08-25'), 'atlas-signals-2026-08-25.json');
});

// ---- per-dataset build checks ------------------------------------------------
const publishedCount = Number(
  (await q(`select count(*)::int as n from signals where is_published = true`))[0].n
);
console.log(`\nPublished signals in corpus: ${publishedCount}`);

for (const d of DATASETS) {
  const rows1 = await d.build(q);
  const rows2 = await d.build(q);
  const colKeys = d.columns.map((c) => c.key);
  const colSet = new Set(colKeys);

  check(`${d.slug}: determinism (${rows1.length} rows)`, () =>
    assert.deepEqual(rows1, rows2));

  check(`${d.slug}: shape, exactly the registry columns`, () => {
    for (const r of rows1) {
      const keys = Object.keys(r);
      assert.equal(keys.length, colKeys.length, `row has ${keys.length} keys, want ${colKeys.length}`);
      for (const k of keys) assert.ok(colSet.has(k), `unexpected key ${k}`);
    }
  });

  check(`${d.slug}: cells are string | number | null`, () => {
    for (const r of rows1) {
      for (const [k, v] of Object.entries(r)) {
        assert.ok(
          v === null || typeof v === 'string' || typeof v === 'number',
          `${k} is ${typeof v}`
        );
      }
    }
  });

  check(`${d.slug}: guest-safety, no personal-layer key`, () => {
    for (const k of colKeys) {
      if (d.keyGated && KEY_GATED_ALLOWED.has(k)) continue;
      assert.ok(!BANNED_EXACT.has(k), `banned key ${k}`);
      for (const sub of BANNED_SUBSTRINGS) {
        assert.ok(!k.includes(sub), `key ${k} contains banned substring ${sub}`);
      }
    }
  });

  check(`${d.slug}: CSV round-trip`, () => {
    const csv = datasetToCSV(d, rows1.slice(0, 50));
    const parsed = parseCSV(csv);
    assert.deepEqual(parsed[0], colKeys, 'header is the column keys');
    assert.equal(parsed.length, Math.min(rows1.length, 50) + 1, 'record count');
    for (const rec of parsed) assert.equal(rec.length, colKeys.length, 'field count');
  });
}

// ---- limit-capable preview (opts.limit) --------------------------------------
// Three representative shapes: a non-heavy plain-SQL builder, a heavy plain-SQL
// builder, and the JS-composed union builder. build(q, { limit: 3 }) must both
// cap the row count and agree with the first 3 rows of the unlimited build, so
// a preview is a prefix, never a reordering or a resample.
console.log('\nPreview limit (opts.limit):');
for (const slug of ['signals', 'intel-metrics', 'argument-nodes']) {
  const d = getDataset(slug);
  const unlimited = await d.build(q);
  const limited = await d.build(q, { limit: 3 });
  check(`${slug}: limit caps to at most 3 rows (${limited.length})`, () =>
    assert.ok(limited.length <= 3, `got ${limited.length} rows`));
  check(`${slug}: limit is a prefix of the unlimited build`, () =>
    assert.deepEqual(limited, unlimited.slice(0, 3)));
}

// ---- 1) published-only recounts (independent SQL) ---------------------------
const idsOf = (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))];
async function countUnpublished(signalIds) {
  if (!signalIds.length) return 0;
  const bad = await q(
    `select count(*)::int as n from signals where id = any($1::uuid[]) and is_published = false`,
    [signalIds]
  );
  return Number(bad[0].n);
}

{
  const signals = await getDataset('signals').build(q);
  check('signals: row count equals the published corpus', () =>
    assert.equal(signals.length, publishedCount));
  const laborRows = await getDataset('signals').build(q, { lens: 'labor' });
  check('signals: lens slice is a strict filter', () => {
    assert.ok(laborRows.length <= signals.length);
    for (const r of laborRows) assert.ok(String(r.lenses).includes('labor'));
  });

  for (const slug of ['signals-by-claim', 'articles-full-text', 'evidence-ledger']) {
    const rows = await getDataset(slug).build(q);
    const ids = idsOf(rows, 'signal_id');
    const bad = await countUnpublished(ids);
    check(`${slug}: every signal reference is published (${ids.length} distinct)`, () =>
      assert.equal(bad, 0, `${bad} unpublished signal(s) leaked`));
  }

  const articles = await getDataset('articles-full-text').build(q);
  check('articles-full-text: every row has text and a correct length', () => {
    for (const r of articles) {
      assert.ok(typeof r.full_text === 'string' && r.full_text.length > 0);
      // Postgres length() counts characters (code points); JS .length counts
      // UTF-16 code units, which diverges on astral characters. Compare points.
      assert.equal(r.text_chars, [...r.full_text].length);
    }
  });

  // signals-export: one row per published signal (item_id IS the signal id),
  // and every touch_details cell parses as the documented JSON array.
  const signalsExport = await getDataset('signals-export').build(q);
  check('signals-export: row count equals the published corpus', () =>
    assert.equal(signalsExport.length, publishedCount));
  {
    const ids = idsOf(signalsExport, 'item_id');
    const bad = await countUnpublished(ids);
    check(`signals-export: every row is a published signal (${ids.length} distinct)`, () =>
      assert.equal(bad, 0, `${bad} unpublished signal(s) leaked`));
  }
  check('signals-export: touch_details parses and full_text is present', () => {
    for (const r of signalsExport) {
      assert.ok(typeof r.full_text === 'string' && r.full_text.length > 0);
      assert.equal(r.text_chars, [...r.full_text].length);
      const touches = JSON.parse(r.touch_details);
      assert.ok(Array.isArray(touches));
      for (const t of touches) assert.ok(typeof t.code === 'string');
    }
  });

  const enums = {
    significance: new Set(['high', 'medium', 'low']),
    direction: new Set(['supports', 'contradicts', 'neutral']),
  };
  const byClaim = await getDataset('signals-by-claim').build(q);
  check('signals-by-claim: enum values allow-listed', () => {
    for (const r of byClaim) {
      assert.ok(enums.significance.has(r.significance), String(r.significance));
      if (r.direction !== null) assert.ok(enums.direction.has(r.direction), String(r.direction));
    }
  });

  // Scout datasets: tracked-only floor, verified with independent SQL, and the
  // events dataset never references a company the companies dataset omits.
  const scoutCompanies = await getDataset('scout-companies').build(q);
  const scoutEvents = await getDataset('scout-events').build(q);
  {
    const companyIds = idsOf(scoutCompanies, 'company_id');
    const eventCompanyIds = idsOf(scoutEvents, 'company_id');
    const allIds = [...new Set([...companyIds, ...eventCompanyIds])];
    const bad = allIds.length
      ? Number((await q(
          `select count(*)::int as n from companies where id = any($1::uuid[]) and status <> 'tracked'`,
          [allIds]
        ))[0].n)
      : 0;
    check(`scout datasets: every company reference is tracked (${allIds.length} distinct)`, () =>
      assert.equal(bad, 0, `${bad} non-tracked compan(ies) leaked`));
    check('scout-events: company ids are a subset of scout-companies', () => {
      const have = new Set(companyIds);
      for (const id of eventCompanyIds) assert.ok(have.has(id), String(id));
    });
  }

  // research-export: key-gated by construction, every row is a tracked/noted
  // paper (independent recount against papers.review_status), who_cares
  // parses as the documented JSON array, and the schema generator has real
  // facts for every column (the buildResearchHandoff coverage guard, the
  // test-scan.mjs / test-intel-datasets.mjs pattern applied to this def).
  const researchExportDef = getDataset('research-export');
  check('research-export: is key-gated', () => assert.ok(researchExportDef.keyGated));
  const researchExport = await researchExportDef.build(q);
  {
    const ids = idsOf(researchExport, 'id');
    const bad = ids.length
      ? Number((await q(
          `select count(*)::int as n from papers where id = any($1::uuid[]) and review_status not in ('tracked', 'noted')`,
          [ids]
        ))[0].n)
      : 0;
    check(`research-export: every row is tracked or noted (${ids.length} distinct)`, () =>
      assert.equal(bad, 0, `${bad} row(s) with a non-tracked/noted review_status leaked`));
  }
  check('research-export: review_status is allow-listed and who_cares parses as JSON', () => {
    const allowed = new Set(['tracked', 'noted']);
    for (const r of researchExport) {
      assert.ok(allowed.has(r.review_status), String(r.review_status));
      if (r.who_cares !== null) assert.ok(Array.isArray(JSON.parse(r.who_cares)), 'who_cares should be a JSON array');
    }
  });
  check('research-export: buildRowJsonSchema covers every column with real facts', () => {
    const schema = buildRowJsonSchema(researchExportDef);
    for (const c of researchExportDef.columns) {
      const p = schema.properties[c.key];
      assert.ok(p, `no schema property for ${c.key}`);
      assert.ok(
        !(Array.isArray(p.type) && p.type.length === 3),
        `${c.key} fell back to the permissive type; add it to FIELD_FACTS`
      );
    }
    assert.deepEqual(schema.required, researchExportDef.columns.map((c) => c.key));
  });

  const catalog = await getDataset('catalog').build(q);
  check('catalog: mirrors the registry exactly', () => {
    const want = DATASETS.reduce((n, d) => n + d.columns.length, 0);
    assert.equal(catalog.length, want);
    for (const d of DATASETS) {
      const mine = catalog.filter((r) => r.dataset_slug === d.slug);
      assert.equal(mine.length, d.columns.length, d.slug);
      assert.deepEqual(mine.map((r) => r.column_key), d.columns.map((c) => c.key), d.slug);
    }
  });
}

await client.end();
if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL DATASET CHECKS PASSED');
