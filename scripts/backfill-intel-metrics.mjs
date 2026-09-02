// One-time historical loader for intel_metrics (migrations 0043/0044). Pulls
// as much quarterly history as each free public source will give up, for
// every active company in the registry (or one, with --only). Reruns
// converge: every write is an idempotent upsert on
// (company_slug, metric_code, period, source), so running this script twice
// with the same or a wider window just refreshes values, never duplicates
// rows. Node's built-in type stripping loads the .ts modules directly.
//
// Flags:
//   --quarters=N       quarterly lookback for EDGAR/FDIC and the y9c walk-back
//                       (default 40)
//   --months=N          monthly lookback for CFPB (default 24)
//   --only=<slug>        limit to one company (must exist in intel_companies)
//   --only-source=<edgar|fdic|cfpb|y9c>   run one leg only
//   --edgar-all          EDGAR: fetch EVERY us-gaap XBRL tag instead of the
//                        curated concept list (a distinct metric_code
//                        namespace, edgar_<tag>, so it never collides with
//                        the curated edgar_xbrl rows)
//   --y9c-file=<path>    ingest ONE local BHCF file (a leading ~ expands to
//                        the home directory) instead of walking the FRBC
//                        archive. Implies --only-source=y9c (every other
//                        leg is skipped). Accepts a .zip (unzipped via the
//                        macOS `unzip -p` CLI, streamed) or a plain
//                        .txt/.csv. Delimiter (comma vs caret) is sniffed
//                        from the header line, so both the Chicago Fed's
//                        comma-delimited archive shape and NIC's caret-
//                        delimited bulk BHCF export work unmodified.
//
// Legs (edgar, fdic, cfpb) call straight into the production fetchers in
// lib/intel/metrics.ts and run one company at a time, sequentially. The y9c
// leg is different in shape: FR Y-9C holding-company data ships as ONE
// multi-hundred-column CSV per QUARTER covering every bank holding company,
// not one call per company, so it downloads each available quarter file
// once (streamed, never buffered whole) and filters it down to the
// registry's holdco rssd set. Its "N rows" progress line therefore prints
// per quarter as the file streams, then once more per company as a total
// after every quarter has been processed.
//
// The FRBC archive only carries quarters through 2021Q1; later quarters
// live on the captcha-walled NIC Financial Data Download, so they need a
// quarterly manual ritual: in a real browser, download the newest BHCF
// bulk file (ZIP or text) from NIC's Financial Data Download
// (https://www.ffiec.gov/npw), then run
//   node scripts/backfill-intel-metrics.mjs --y9c-file=~/Downloads/<file>
// and delete the downloaded file once the run succeeds.
//
// Run: node scripts/backfill-intel-metrics.mjs [flags]

import { config } from 'dotenv';
config({ path: '.env.local' });

import pg from 'pg';
import { mkdirSync, writeFileSync, createReadStream, accessSync, constants as fsConstants } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  fetchEdgarMetrics, fetchFdicMetricsFull, fetchFdicFieldList, fetchCfpbMonthlySeries,
} from '../lib/intel/metrics.ts';
import { edgarJson } from '../lib/intel/edgar.ts';
import { recordApiCall } from '../lib/cost.ts';

const scriptStart = Date.now();

// ---------------------------------------------------------------- arg parsing
function parseArgs(argv) {
  const args = {
    quarters: 40, months: 24, only: null, onlySource: null, edgarAll: false, y9cFile: null,
  };
  for (const arg of argv) {
    if (arg === '--edgar-all') args.edgarAll = true;
    else if (arg.startsWith('--quarters=')) args.quarters = Number(arg.slice('--quarters='.length));
    else if (arg.startsWith('--months=')) args.months = Number(arg.slice('--months='.length));
    else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
    else if (arg.startsWith('--only-source=')) args.onlySource = arg.slice('--only-source='.length);
    else if (arg.startsWith('--y9c-file=')) args.y9cFile = arg.slice('--y9c-file='.length);
    else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(args.quarters) || args.quarters <= 0) {
    console.error('--quarters must be a positive number.');
    process.exit(1);
  }
  if (!Number.isFinite(args.months) || args.months <= 0) {
    console.error('--months must be a positive number.');
    process.exit(1);
  }
  if (args.y9cFile) {
    // Expand a leading ~ (or ~/...) to the home directory, then resolve to
    // an absolute path so error messages and progress lines are unambiguous.
    const expanded = args.y9cFile === '~' || args.y9cFile.startsWith('~/')
      ? path.join(os.homedir(), args.y9cFile.slice(1))
      : args.y9cFile;
    args.y9cFile = path.resolve(expanded);
    // A local file leg replaces the archive walk entirely: run y9c only.
    args.onlySource = 'y9c';
  }
  const SOURCES = ['edgar', 'fdic', 'cfpb', 'y9c'];
  if (args.onlySource && !SOURCES.includes(args.onlySource)) {
    console.error(`--only-source must be one of ${SOURCES.join(', ')}.`);
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const runsLeg = (source) => !args.onlySource || args.onlySource === source;

if (args.y9cFile) {
  try {
    accessSync(args.y9cFile, fsConstants.R_OK);
  } catch (e) {
    const reason = e.code === 'ENOENT' ? 'file not found' : e.message;
    console.error(`--y9c-file=${args.y9cFile}: cannot read file (${reason}).`);
    process.exit(1);
  }
}

function formatBytes(bytes) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(2)} ${units[i]} (${bytes.toLocaleString()} bytes)`;
}

// ------------------------------------------------------------------ DB setup
const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ------------------------------------------------------------ safety rails
const SIX_GB = 6 * 1024 ** 3;
const sizeBeforeRow = await client.query('select pg_database_size(current_database()) as size');
const sizeBeforeBytes = Number(sizeBeforeRow.rows[0].size);
console.log(`Database size: ${formatBytes(sizeBeforeBytes)}`);
if (sizeBeforeBytes > SIX_GB) {
  console.error(
    `Database size ${formatBytes(sizeBeforeBytes)} is over the 6GB safety threshold ` +
    `(Supabase Pro includes 8GB and overage is a hard spend wall). Aborting before any writes.`
  );
  await client.end();
  process.exit(1);
}

// ---------------------------------------------------------------- registry
const { rows: registry } = await client.query(
  `select slug, name, tier, ticker, cik, fdic_cert, rssd_id, cfpb_name
     from intel_companies where active order by slug`
);
let companies = registry;
if (args.only) {
  companies = registry.filter((c) => c.slug === args.only);
  if (!companies.length) {
    console.error(`--only=${args.only}: no active company with that slug in intel_companies.`);
    await client.end();
    process.exit(1);
  }
}
console.log(`Companies in scope: ${companies.length}${args.only ? ` (--only=${args.only})` : ''}`);

// ------------------------------------------------------- batched upsert helper
// Mirrors upsertIntelMetrics (lib/mutations/intel.ts) exactly: same natural
// key, same on-conflict semantics. Reimplemented on the raw client because
// that module's import chain (lib/db.ts's pool singleton, scout/core, etc.)
// is not plain-Node loadable. Dedupes within each 200-row batch on the
// natural key (keeping the last value) so a duplicate key inside one
// multi-row VALUES statement can never trip Postgres's "ON CONFLICT DO
// UPDATE command cannot affect row a second time".
async function upsertMetrics(rows) {
  if (!rows.length) return 0;
  const deduped = new Map();
  for (const r of rows) {
    deduped.set(`${r.company_slug} ${r.metric_code} ${r.period} ${r.source}`, r);
  }
  const unique = [...deduped.values()];
  const BATCH_SIZE = 200;
  const COLS = 6;
  let total = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const params = [];
    const tuples = batch.map((r, j) => {
      const base = j * COLS;
      params.push(r.company_slug, r.metric_code, r.period, r.value, r.unit ?? null, r.source);
      return `($${base + 1}, $${base + 2}, $${base + 3}::date, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    const res = await client.query(
      `insert into intel_metrics (company_slug, metric_code, period, value, unit, source)
       values ${tuples.join(', ')}
       on conflict (company_slug, metric_code, period, source) do update
         set value = excluded.value, unit = excluded.unit, fetched_at = now()`,
      params
    );
    total += res.rowCount ?? 0;
  }
  return total;
}

// -------------------------------------------------------------- run tracking
const results = {}; // slug -> { edgar?, fdic?, cfpb?, y9c? } (number | 'error')
for (const c of companies) results[c.slug] = {};
let legAttempts = 0;
let legFailures = 0;
const failures = []; // { company, source, error }

async function runLeg(company, source, fn) {
  legAttempts += 1;
  const t0 = Date.now();
  try {
    const rows = await fn();
    const n = await upsertMetrics(rows);
    results[company.slug][source] = n;
    console.log(`${company.slug} ${source}: ${n} rows (${rows.length} fetched, ${Date.now() - t0}ms)`);
  } catch (e) {
    legFailures += 1;
    results[company.slug][source] = 'error';
    failures.push({ company: company.slug, source, error: e.message });
    console.error(`${company.slug} ${source}: FAILED (${e.message})`);
  }
}

// ------------------------------------------------------------------- edgar
const REPORT_FORM_RE = /^(10-[QK]|20-F|40-F|6-K)/;

// The --edgar-all leg: every us-gaap tag in the filer's companyfacts payload,
// not just the curated concept list. Distinct metric_code namespace
// (edgar_<tag lowercased>) so it can never collide with the curated
// edgar_xbrl rows fetchEdgarMetrics writes.
async function fetchEdgarAllMetrics(company, quarters) {
  if (!company.cik) return [];
  const padded = company.cik.padStart(10, '0');
  const payload = await edgarJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, 60_000);
  const gaap = payload.facts?.['us-gaap'] ?? {};
  const rows = [];
  for (const [tag, tagData] of Object.entries(gaap)) {
    const units = tagData?.units ?? {};
    const unitKey = Object.keys(units)[0];
    if (!unitKey) continue;
    const entries = units[unitKey] ?? [];
    const byEnd = new Map();
    for (const f of entries) {
      if (!f?.end || typeof f.val !== 'number' || !Number.isFinite(f.val)) continue;
      if (f.form && !REPORT_FORM_RE.test(f.form)) continue;
      byEnd.set(f.end, f.val); // later entries are later filings; last write wins
    }
    const periods = [...byEnd.keys()].sort().slice(-quarters);
    for (const period of periods) {
      rows.push({
        company_slug: company.slug,
        metric_code: `edgar_${tag.toLowerCase()}`,
        period,
        value: byEnd.get(period),
        unit: unitKey,
        source: 'edgar_xbrl',
      });
    }
  }
  return rows;
}

if (runsLeg('edgar')) {
  for (const c of companies) {
    if (!c.cik) {
      results[c.slug].edgar = 0;
      console.log(`${c.slug} edgar: skipped (no CIK)`);
      continue;
    }
    if (args.edgarAll) {
      await runLeg(c, 'edgar', () => fetchEdgarAllMetrics(c, args.quarters));
    } else {
      await runLeg(c, 'edgar', () => fetchEdgarMetrics(c, undefined, Number.POSITIVE_INFINITY));
    }
  }
}

// -------------------------------------------------------------------- fdic
if (runsLeg('fdic')) {
  for (const c of companies) {
    if (!c.fdic_cert) {
      results[c.slug].fdic = 0;
      console.log(`${c.slug} fdic: skipped (no FDIC cert)`);
      continue;
    }
    await runLeg(c, 'fdic', () => fetchFdicMetricsFull(c, args.quarters));
  }
}

// -------------------------------------------------------------------- cfpb
if (runsLeg('cfpb')) {
  for (const c of companies) {
    await runLeg(c, 'cfpb', () => fetchCfpbMonthlySeries(c, args.months));
  }
}

// --------------------------------------------------------------------- y9c
// FR Y-9C consolidated holding-company data, MDRM-coded. The free archive is
// the Chicago Fed's quarterly CSV dump; it only covers 2021Q1 and earlier —
// later quarters live on the captcha-walled NIC Financial Data Download and
// are counted, not fetched.
const FRBC_CUTOFF_YYMM = '2103'; // 2021Q1, the last quarter the archive carries

function yymmLabel(date) {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

// The most recent N quarter-ends on or before today, newest first.
function pastQuarterEnds(n) {
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const qEndMonths = [12, 9, 6, 3]; // Dec 31, Sep 30, Jun 30, Mar 31, newest-month-first
  const out = [];
  for (let year = today.getUTCFullYear() + 1; out.length < n && year >= 1990; year -= 1) {
    for (const qm of qEndMonths) {
      const d = new Date(Date.UTC(year, qm, 0)); // day 0 of next month = last day of qm
      if (d.getTime() <= todayUTC) {
        out.push(d);
        if (out.length >= n) break;
      }
    }
  }
  return out;
}

// Minimal delimited-line splitter honoring double-quoted fields (with "" as
// an escaped quote) — the bhcf files quote free-text fields like officer
// names that can contain the delimiter itself. `delimiter` is ',' for the
// Chicago Fed archive's CSV files and, for a --y9c-file NIC export, '^'.
function splitDelimitedLine(line, delimiter) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// Sniffs whether a BHCF header line is comma- or caret-delimited: split it
// both ways and keep whichever produces more RSSD-prefixed columns. The
// Chicago Fed archive is always comma-delimited (the archive leg below
// skips this and passes ',' directly); NIC's bulk BHCF text export is
// caret-delimited, hence this being needed for --y9c-file.
function sniffDelimiter(headerLine) {
  const commaCount = splitDelimitedLine(headerLine, ',').filter((c) => c.startsWith('RSSD')).length;
  const caretCount = splitDelimitedLine(headerLine, '^').filter((c) => c.startsWith('RSSD')).length;
  return caretCount > commaCount ? '^' : ',';
}

// Consumes a BHCF-shaped readline interface line by line, never buffering
// the whole body (these run tens to hundreds of MB). Keeps only rows whose
// RSSD9001 is a tracked holding company, and within those, every non-RSSD9*
// column that parses as a finite number. `resolveDelimiter(headerLine)`
// picks the delimiter once, off the first line.
async function parseBhcfStream(rl, rssdToSlug, resolveDelimiter, sourceLabel) {
  const rows = [];
  const perCompanyCount = new Map();
  let header = null;
  let delimiter = ',';
  let rssdIdx = -1;
  let periodIdx = -1;
  for await (const line of rl) {
    if (!line) continue;
    if (!header) {
      delimiter = resolveDelimiter(line);
      header = splitDelimitedLine(line, delimiter);
      rssdIdx = header.indexOf('RSSD9001');
      periodIdx = header.indexOf('RSSD9999');
      if (rssdIdx === -1 || periodIdx === -1) {
        throw new Error(`${sourceLabel}: header missing RSSD9001/RSSD9999`);
      }
      continue;
    }
    const cells = splitDelimitedLine(line, delimiter);
    const slug = rssdToSlug.get(cells[rssdIdx]);
    if (!slug) continue; // not a tracked holdco (also drops the header's dashed divider row)
    const periodRaw = cells[periodIdx];
    if (!/^\d{8}$/.test(periodRaw)) continue;
    const period = `${periodRaw.slice(0, 4)}-${periodRaw.slice(4, 6)}-${periodRaw.slice(6, 8)}`;
    for (let i = 0; i < header.length; i += 1) {
      const mnemonic = header[i];
      if (!mnemonic || mnemonic.startsWith('RSSD9')) continue;
      const raw = cells[i];
      if (raw === undefined || raw === '') continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      rows.push({
        company_slug: slug,
        metric_code: `y9c_${mnemonic.toLowerCase()}`,
        period,
        value: v,
        unit: null,
        source: 'y9c',
      });
      perCompanyCount.set(slug, (perCompanyCount.get(slug) ?? 0) + 1);
    }
  }
  return { rows, perCompanyCount };
}

// Streams one quarter's bhcf<YYMM>.csv from the Chicago Fed archive. Always
// comma-delimited, so the delimiter is passed directly, never sniffed.
async function fetchAndParseQuarter(label, rssdToSlug) {
  const url = `https://www.chicagofed.org/~/media/others/banking/financial-institution-reports/bhc-data/bhcf${label}.csv`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for bhcf${label}.csv`);
  const rl = createInterface({ input: Readable.fromWeb(res.body), crlfDelay: Infinity });
  return parseBhcfStream(rl, rssdToSlug, () => ',', `bhcf${label}.csv`);
}

async function fetchQuarterWithRetry(label, rssdToSlug) {
  try {
    return await fetchAndParseQuarter(label, rssdToSlug);
  } catch (e) {
    console.warn(`y9c bhcf${label}: first attempt failed (${e.message}), retrying once...`);
    return await fetchAndParseQuarter(label, rssdToSlug);
  }
}

// Opens a local --y9c-file for streaming: a .zip shells out to macOS's
// `unzip -p` (the inner BHCF entry is a single text file, so no member
// pattern is needed) with its stdout piped straight into the readline
// pipeline; a .txt/.csv streams directly off disk. `waitForExit` resolves
// once the child process (if any) has exited, throwing if it failed, so a
// broken/corrupt zip surfaces as a clear error rather than a silently empty
// parse.
function openY9cSource(filePath) {
  if (filePath.toLowerCase().endsWith('.zip')) {
    const child = spawn('unzip', ['-p', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const exited = new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', (e) => resolve(e));
    });
    return {
      stream: child.stdout,
      async waitForExit() {
        const result = await exited;
        if (result instanceof Error) throw new Error(`unzip -p ${filePath} failed to start (${result.message})`);
        if (result !== 0) {
          throw new Error(`unzip -p ${filePath} exited ${result}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
        }
      },
    };
  }
  return { stream: createReadStream(filePath), async waitForExit() {} };
}

// Parses one local BHCF file end to end: sniffs comma vs caret delimiting
// from its header line (Chicago Fed exports are comma-delimited, NIC bulk
// exports are caret-delimited) and reuses the same row logic as the archive
// leg.
async function parseY9cFile(filePath, rssdToSlug) {
  const { stream, waitForExit } = openY9cSource(filePath);
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const result = await parseBhcfStream(rl, rssdToSlug, sniffDelimiter, path.basename(filePath));
  await waitForExit();
  return result;
}

const y9cMnemonics = new Set();

if (runsLeg('y9c')) {
  const withRssd = companies.filter((c) => c.rssd_id);
  if (!withRssd.length) {
    console.log('y9c: no company in scope has an rssd_id, skipping leg.');
  } else {
    const rssdToSlug = new Map(withRssd.map((c) => [c.rssd_id, c.slug]));
    for (const c of withRssd) results[c.slug].y9c = 0;

    let unavailable = [];

    if (args.y9cFile) {
      const label = path.basename(args.y9cFile);
      legAttempts += 1;
      const t0 = Date.now();
      try {
        const { rows, perCompanyCount } = await parseY9cFile(args.y9cFile, rssdToSlug);
        const n = await upsertMetrics(rows);
        for (const r of rows) y9cMnemonics.add(r.metric_code.slice('y9c_'.length));
        for (const [slug, count] of perCompanyCount) {
          results[slug].y9c = (results[slug].y9c ?? 0) + count;
        }
        await recordApiCall({
          feature: 'intel_discovery',
          model: 'nic-bhcf',
          usage: null,
          wallMs: Date.now() - t0,
          metadata: { file: label, rows: n, provider: 'nic' },
        });
        console.log(`y9c ${label}: ${n} rows across ${perCompanyCount.size} companies (${Date.now() - t0}ms)`);
      } catch (e) {
        legFailures += 1;
        failures.push({ company: null, source: `y9c:${label}`, error: e.message });
        console.error(`y9c ${label}: FAILED (${e.message})`);
      }
    } else {
      const quarterEnds = pastQuarterEnds(args.quarters);
      const available = [];
      for (const d of quarterEnds) {
        const label = yymmLabel(d);
        (label <= FRBC_CUTOFF_YYMM ? available : unavailable).push(label);
      }
      console.log(`y9c: ${available.length} archived quarters in range, ${unavailable.length} not yet archived.`);

      for (const label of available) {
        legAttempts += 1;
        const t0 = Date.now();
        try {
          const { rows, perCompanyCount } = await fetchQuarterWithRetry(label, rssdToSlug);
          const n = await upsertMetrics(rows);
          for (const r of rows) y9cMnemonics.add(r.metric_code.slice('y9c_'.length));
          for (const [slug, count] of perCompanyCount) {
            results[slug].y9c = (results[slug].y9c ?? 0) + count;
          }
          await recordApiCall({
            feature: 'intel_discovery',
            model: 'frbc-bhcf',
            usage: null,
            wallMs: Date.now() - t0,
            metadata: { quarter: label, rows: n, provider: 'frbc' },
          });
          console.log(`y9c bhcf${label}: ${n} rows across ${perCompanyCount.size} companies (${Date.now() - t0}ms)`);
        } catch (e) {
          legFailures += 1;
          failures.push({ company: null, source: `y9c:${label}`, error: e.message });
          console.error(`y9c bhcf${label}: FAILED after retry (${e.message})`);
        }
      }
    }

    console.log('y9c per-company totals:');
    for (const c of withRssd) {
      console.log(`${c.slug} y9c: ${results[c.slug].y9c} rows`);
    }
    if (unavailable.length) {
      console.log(
        `${unavailable.length} recent quarters (2021Q2 onward) require the NIC Financial Data Download ` +
        `(captcha-walled); browser-assisted follow-up`
      );
    }

    try {
      mkdirSync('private', { recursive: true });
      writeFileSync(
        'private/y9c-dictionary.json',
        JSON.stringify({
          note: 'Distinct FR Y-9C MDRM mnemonics loaded by scripts/backfill-intel-metrics.mjs from the FRBC bhcf archive and any --y9c-file runs.',
          codes: [...y9cMnemonics].sort(),
        }, null, 2)
      );
      console.log(`Wrote private/y9c-dictionary.json (${y9cMnemonics.size} mnemonics).`);
    } catch (e) {
      console.warn(`Could not write private/y9c-dictionary.json: ${e.message}`);
    }
  }
}

// ------------------------------------------------------------- fdic dictionary
try {
  const fields = await fetchFdicFieldList();
  mkdirSync('private', { recursive: true });
  writeFileSync('private/fdic-dictionary.json', JSON.stringify(fields, null, 2));
  console.log(`Wrote private/fdic-dictionary.json (${fields.length} fields).`);
} catch (e) {
  console.warn(`Could not write private/fdic-dictionary.json: ${e.message}`);
}

// ---------------------------------------------------------------- summary
console.log('\n=== Summary ===');
console.log(['slug', 'edgar', 'fdic', 'cfpb', 'y9c'].join('\t'));
const totalsBySource = { edgar: 0, fdic: 0, cfpb: 0, y9c: 0 };
for (const c of companies) {
  const r = results[c.slug];
  console.log([c.slug, r.edgar ?? '-', r.fdic ?? '-', r.cfpb ?? '-', r.y9c ?? '-'].join('\t'));
  for (const src of ['edgar', 'fdic', 'cfpb', 'y9c']) {
    if (typeof r[src] === 'number') totalsBySource[src] += r[src];
  }
}
console.log('Totals by source:', totalsBySource);

if (failures.length) {
  console.log(`\n${failures.length} leg failure(s):`);
  for (const f of failures) console.log(`  ${f.company ?? '(y9c file)'} ${f.source}: ${f.error}`);
}

const sizeAfterRow = await client.query('select pg_database_size(current_database()) as size');
const sizeAfterBytes = Number(sizeAfterRow.rows[0].size);
console.log(`\nDB size before: ${formatBytes(sizeBeforeBytes)}`);
console.log(`DB size after:  ${formatBytes(sizeAfterBytes)}`);

const bySource = await client.query('select source, count(*) from intel_metrics group by 1 order by 1');
console.log('intel_metrics rows by source (all-time, all companies):');
for (const row of bySource.rows) console.log(`  ${row.source}: ${row.count}`);

console.log(`Elapsed: ${((Date.now() - scriptStart) / 1000).toFixed(1)}s`);

await client.end();

// The imported fetchers (and recordApiCall) run every insert through
// lib/db.ts's own global pooled Pool, separate from our raw client above.
// That pool's idleTimeoutMillis (30s) would otherwise keep the process alive
// for up to 30s after the last DB write with nothing left to do.
try {
  if (globalThis.__atlasPool) await globalThis.__atlasPool.end();
} catch {
  // best-effort: a slow-to-close pool must never fail the script after its work is done
}

if (legAttempts > 0 && legFailures === legAttempts) {
  console.error('\nEvery leg failed. Exiting 1.');
  process.exit(1);
}
