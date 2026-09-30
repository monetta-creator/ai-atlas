// Tests for lib/zip.ts. No DB. Run: node scripts/test-zip.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, zipFiles } from '../lib/zip.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

check('crc32 matches the reference value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

const entries = [
  { name: 'README.md', text: '# Hello\n\nA bundle.\n' },
  { name: 'acme/acme-base.md', text: 'Line one\n'.repeat(2000) },
  { name: 'acme/acme-sections.json', text: JSON.stringify({ a: [1, 2, 3], s: 'caf\u00e9 \u2192 ok' }) },
];

check('deterministic: same input and day, same bytes', () => {
  assert.ok(zipFiles(entries, '2026-09-30').equals(zipFiles(entries, '2026-09-30')));
  assert.ok(!zipFiles(entries, '2026-09-30').equals(zipFiles(entries, '2026-10-01')));
});

check('compresses repetitive text', () => {
  const size = entries.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
  assert.ok(zipFiles(entries, '2026-09-30').length < size / 4);
});

check('a real unzip reads every entry back byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-zip-'));
  const file = join(dir, 'bundle.zip');
  writeFileSync(file, zipFiles(entries, '2026-09-30'));
  execFileSync('unzip', ['-t', file], { stdio: 'pipe' });
  execFileSync('unzip', ['-q', file, '-d', join(dir, 'out')], { stdio: 'pipe' });
  for (const e of entries) assert.equal(readFileSync(join(dir, 'out', e.name), 'utf8'), e.text, e.name);
});

check('an empty bundle is still a valid archive', () => {
  assert.equal(zipFiles([], '2026-09-30').length, 22);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
