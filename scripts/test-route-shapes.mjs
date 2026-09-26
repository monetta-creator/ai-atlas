// Tests for lib/route-shapes.ts (the proxy's malformed-detail-path check and
// its public-API allow-list). Pure, no DB. Run: node scripts/test-route-shapes.mjs
import assert from 'node:assert/strict';
import {
  isMalformedDetailPath, isRealDay, isPublicApiPath, PUBLIC_API_PATHS, PUBLIC_API_PREFIXES,
} from '../lib/route-shapes.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const U = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

check('well-formed ids and static siblings pass through', () => {
  for (const p of [`/signals/${U}`, `/signals/${U}/edit`, `/research/${U}`, `/scout/${U}`, `/source/${U}`, `/theses/${U}`,
    `/thesis-report/${U}`, `/thesis-report/${U}/pdf`, `/reports/${U}`, `/reports/${U}/pdf`, `/reports/sheet/${U}`, `/reports/sheet/${U}/pdf`,
    '/signals', '/signals/new', '/signals/drafts', '/signals/digest', '/research/console', '/research/digest', '/research/threads/labor-automation-evidence',
    '/scout/console', '/theses/new', '/reports', '/reports/period', '/reports/sheet', '/blotter', '/blotter/archive', '/blotter/desk',
    '/blotter/2026-09-22', '/blotter/2026-09-22/pdf', '/blotter/2026-09-22/deck/pdf', '/intel/deck', '/intel/deck/none', '/intel/deck/2026-09-23', '/intel/deck/2026-09-23/pdf', '/intel', `/signals/${U.toUpperCase()}`, '/claim/7.1', '/tooling/anything', '/sources']) {
    assert.equal(isMalformedDetailPath(p), false, p);
  }
});

check('malformed ids and impossible days are rejected', () => {
  for (const p of ['/signals/not-a-uuid', '/signals/123/edit', '/research/abc', '/scout/x', '/source/1', '/theses/zzz',
    '/thesis-report/nope/pdf', '/reports/abc', '/reports/sheet/abc', '/reports/sheet/abc/pdf', '/blotter/2026-13-45',
    '/blotter/2026-02-30', '/blotter/yesterday', '/intel/deck/latest', '/intel/deck/2026-13-01/pdf', `/signals/${U}x`, '/signals/------------------------------------']) {
    assert.equal(isMalformedDetailPath(p), true, p);
  }
});

check('isRealDay: calendar-valid dates only', () => {
  assert.equal(isRealDay('2026-02-28'), true);
  assert.equal(isRealDay('2028-02-29'), true);
  assert.equal(isRealDay('2026-02-29'), false);
  assert.equal(isRealDay('2026-9-1'), false);
});

check('isPublicApiPath: every listed exact path is public, nothing else under the same segment is', () => {
  for (const p of PUBLIC_API_PATHS) {
    assert.equal(isPublicApiPath(p), true, p);
  }
  // Exact matches are exact: a sibling or child path is NOT public by virtue
  // of sharing a prefix with an exact entry (that is what PUBLIC_API_PREFIXES
  // is for).
  assert.equal(isPublicApiPath('/api/tickets/image/1'), false, 'child of an exact entry stays gated');
  assert.equal(isPublicApiPath('/api/ask'), false, 'quick Ask stays admin-gated');
  assert.equal(isPublicApiPath('/api/ask/deep'), false, 'deep Ask stays admin-gated');
  assert.equal(isPublicApiPath('/api/nav/counts'), false, 'admin-only nav counts stays gated');
});

check('isPublicApiPath: prefix entries cover every path underneath', () => {
  for (const p of PUBLIC_API_PREFIXES) {
    assert.equal(isPublicApiPath(p), true, p);
    assert.equal(isPublicApiPath(`${p}anything`), true, `${p}anything`);
    assert.equal(isPublicApiPath(`${p}nested/deeper`), true, `${p}nested/deeper`);
  }
  assert.equal(isPublicApiPath('/api/cron'), false, 'no trailing slash does not match the prefix');
});

check('isPublicApiPath: an unlisted /api path is not public; every non-/api path is public by construction (proxy.ts ORs this in)', () => {
  assert.equal(isPublicApiPath('/api/agent/chat'), false);
  assert.equal(isPublicApiPath('/api/probe/duration'), false);
  assert.equal(isPublicApiPath('/'), false, 'isPublicApiPath itself only judges /api paths; proxy.ts handles the rest');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
