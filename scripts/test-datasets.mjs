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
// The one scoped exception (see lib/datasets/core.ts): per-touch direction +
// editorial reason may ride KEY-GATED datasets only; the portal key is the
// boundary, the same as bulk article text. Never widen this to the personal
// layer proper (confidence, priors, rationales stay banned everywhere).
const KEY_GATED_ALLOWED = new Set(['touch_details']);
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
check('helpers: isSignalLens + datasetFileName', () => {
  assert.ok(isSignalLens('labor'));
  assert.ok(!isSignalLens('vibes'));
  assert.equal(SIGNAL_LENSES.length, 6);
  const sig = DATASETS.find((d) => d.slug === 'signals');
  assert.equal(datasetFileName(sig, 'csv'), 'atlas-signals.csv');
  assert.equal(datasetFileName(sig, 'json', 'labor'), 'atlas-signals-labor.json');
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
