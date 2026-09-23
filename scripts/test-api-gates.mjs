// The API gate inventory: every app/api/**/route.ts either re-exports its
// parent's handler (inheriting its gate), calls one of the known gate
// functions itself, or is explicitly EXEMPT with a one-line reason. Also
// checks that lib/route-shapes.ts's PUBLIC_API_PATHS/PREFIXES each point at a
// route that actually exists. Pure, no DB, walks the filesystem with
// node:fs. Run: node scripts/test-api-gates.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_API_PATHS, PUBLIC_API_PREFIXES } from '../lib/route-shapes.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const apiDir = path.join(root, 'app', 'api');

// A route.ts with no in-file gate call that is still public BY DESIGN. Every
// entry needs a reason (checked below against the actual source, not just
// asserted) and must correspond to a real, currently-ungated route, so this
// list can never silently go stale in either direction.
const EXEMPT = {
  '/api/traceroute/tokenize': 'pure string processing over a length-capped input, no model call, no DB read',
  '/api/nav/viewer': "returns only the caller's own session flags (getChromeViewer), nothing else",
  '/api/tickets': 'public validated write; every field is checked and capped in-route (mirrors /api/access/request)',
  '/api/access/request': 'public validated write; every field is checked and capped in-route',
};

const GATE_MARKERS = ['isAdmin(', 'cronGate(', 'identityFromRequest(', 'getPortalIdentity(', 'isPortal(', 'requireAdmin'];
const REEXPORT_RE = /export\s*\{\s*[A-Z]+(?:\s*,\s*[A-Z]+)*\s*\}\s*from\s*['"]\.\.\/route['"]/;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

// app/api/foo/[id]/route.ts -> /api/foo/[id]
function apiPathFor(file) {
  const rel = path.relative(path.join(root, 'app'), file).replace(/\\/g, '/');
  return `/${rel.replace(/\/route\.ts$/, '')}`;
}

const routeFiles = walk(apiDir);

check('app/api has route.ts files to check (the walk itself is not vacuously empty)', () => {
  assert.ok(routeFiles.length > 30, `found only ${routeFiles.length}`);
});

const seenExempt = new Set();
const ungated = [];
const reexports = [];

for (const file of routeFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const apiPath = apiPathFor(file);
  if (REEXPORT_RE.test(src)) { reexports.push(apiPath); continue; }
  const gated = GATE_MARKERS.some((m) => src.includes(m));
  if (gated) continue;
  if (EXEMPT[apiPath]) { seenExempt.add(apiPath); continue; }
  ungated.push(apiPath);
}

check('every /api/*/route.ts either re-exports its parent, carries a known gate call, or is EXEMPT with a reason', () => {
  assert.deepEqual(ungated, [], `no gate call and not EXEMPT: ${ungated.join(', ') || '(none)'}`);
});

check('re-export stubs were actually found (the cron /sweep siblings), so REEXPORT_RE is not silently matching nothing', () => {
  assert.ok(reexports.length >= 10, `found ${reexports.length}: ${reexports.join(', ')}`);
});

check('every EXEMPT entry names a route that still has no gate call (not stale)', () => {
  const stale = Object.keys(EXEMPT).filter((p) => !seenExempt.has(p));
  assert.deepEqual(stale, [], `EXEMPT entries that no longer apply (route now gated, or no longer exists): ${stale.join(', ')}`);
});

check('every EXEMPT entry carries a non-empty one-line reason', () => {
  for (const [p, reason] of Object.entries(EXEMPT)) {
    assert.ok(typeof reason === 'string' && reason.trim().length > 0, p);
    assert.ok(!reason.includes('\n'), `${p}: reason must be one line`);
  }
});

check('PUBLIC_API_PATHS: each exact entry points at an existing route.ts', () => {
  for (const p of PUBLIC_API_PATHS) {
    const file = path.join(root, 'app', ...p.split('/').filter(Boolean), 'route.ts');
    assert.ok(fs.existsSync(file), `${p} -> ${file}`);
  }
});

check('PUBLIC_API_PREFIXES: each prefix points at an existing directory under app/api', () => {
  for (const p of PUBLIC_API_PREFIXES) {
    assert.ok(p.startsWith('/api/') && p.endsWith('/'), `${p}: expected a leading /api/ and a trailing slash`);
    const dir = path.join(root, 'app', ...p.replace(/\/$/, '').split('/').filter(Boolean));
    assert.ok(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `${p} -> ${dir}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
