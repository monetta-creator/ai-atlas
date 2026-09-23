// Tests for the ONE nav tree (lib/nav.ts): groupFor, tabsFor, pathwayFor,
// publicParentFor, canSee. Pure and DB-free, so this is the whole test:
// no dotenv, no pg. Node type stripping loads the .ts module directly.
// Run: node scripts/test-nav.mjs

import assert from 'node:assert/strict';
import {
  groupFor, tabsFor, pathwayFor, publicParentFor, canSee, leafFor, isActiveGroup, isChromeless,
} from '../lib/nav.ts';

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

const guest = { admin: false, portal: false };
const holder = { admin: false, portal: true };
const admin = { admin: true, portal: false };

console.log('lib/nav:');

check("groupFor('/tooling/reports').key === 'tooling'", () => {
  assert.equal(groupFor('/tooling/reports')?.key, 'tooling');
});

check("groupFor('/ingest').key === 'map'", () => {
  assert.equal(groupFor('/ingest')?.key, 'map');
});

check("groupFor('/claim/3.3').key === 'map'", () => {
  assert.equal(groupFor('/claim/3.3')?.key, 'map');
});

check("groupFor('/agent').key === 'desk'", () => {
  assert.equal(groupFor('/agent')?.key, 'desk');
});

check("groupFor('/') is the home group", () => {
  assert.equal(groupFor('/')?.key, 'home');
});

check('tabsFor(/signals, guest) has 1 visible leaf so returns []', () => {
  assert.deepEqual(tabsFor('/signals', guest), []);
});

check('tabsFor(/signals, admin).length === 4', () => {
  assert.equal(tabsFor('/signals', admin).length, 4);
});

check('tabsFor(/tooling, guest) = Catalog + Table', () => {
  const tabs = tabsFor('/tooling', guest).map((l) => l.label);
  assert.deepEqual(tabs, ['Catalog', 'Table']);
});

check('tabsFor(/tooling, portal holder) adds Reports', () => {
  const tabs = tabsFor('/tooling', holder).map((l) => l.label);
  assert.deepEqual(tabs, ['Catalog', 'Table', 'Reports']);
});

check("pathwayFor('/signals/drafts', 'Draft queue') = Signal Board(link), Draft queue(null)", () => {
  const segs = pathwayFor('/signals/drafts', 'Draft queue');
  assert.deepEqual(segs, [
    { label: 'Signal Board', href: '/signals' },
    { label: 'Draft queue', href: null },
  ]);
});

check("pathwayFor('/tooling', 'AI Tooling Monitor') = single current segment (the hub itself)", () => {
  // On a group's own hub page, pathwayFor collapses to one segment using the
  // GROUP's label, not the caller's pageLabel (the h1 already says it).
  const segs = pathwayFor('/tooling', 'AI Tooling Monitor');
  assert.deepEqual(segs, [{ label: 'Tooling Monitor', href: null }]);
});

check("pathwayFor('/claim/3.3', 'Claim 3.3') = Claims & Theses(link), Claim 3.3(null)", () => {
  const segs = pathwayFor('/claim/3.3', 'Claim 3.3');
  assert.deepEqual(segs, [
    { label: 'Claims & Theses', href: '/map' },
    { label: 'Claim 3.3', href: null },
  ]);
});

check("groupFor('/about/data-handling').key === 'about' and the leaf is a public, listed tab", () => {
  const group = groupFor('/about/data-handling');
  assert.equal(group?.key, 'about');
  const leaf = leafFor('/about/data-handling', group);
  assert.equal(leaf?.label, 'Data handling');
  assert.equal(leaf?.access, 'public');
  const tabs = tabsFor('/about/data-handling', guest).map((l) => l.href);
  assert.ok(tabs.includes('/about/data-handling'), 'guest tabs list /about/data-handling');
  assert.ok(!tabs.includes('/about/architecture'), 'architecture stays hidden');
});

check("pathwayFor('/about/data-handling', 'Data handling') = About(link), Data handling(null)", () => {
  assert.deepEqual(pathwayFor('/about/data-handling', 'Data handling'), [
    { label: 'About', href: '/about' },
    { label: 'Data handling', href: null },
  ]);
});

check("publicParentFor('/worldview').href === '/map'", () => {
  assert.equal(publicParentFor('/worldview').href, '/map');
});

check("publicParentFor('/agent').href === '/'", () => {
  assert.equal(publicParentFor('/agent').href, '/');
});

check('canSee matrix: public/portal/admin access x guest/portal/admin viewer', () => {
  assert.equal(canSee('public', guest), true);
  assert.equal(canSee('public', holder), true);
  assert.equal(canSee('public', admin), true);
  assert.equal(canSee('portal', guest), false);
  assert.equal(canSee('portal', holder), true);
  assert.equal(canSee('portal', admin), true);
  assert.equal(canSee('admin', guest), false);
  assert.equal(canSee('admin', holder), false);
  assert.equal(canSee('admin', admin), true);
});

check('leafFor picks the longest match (/signals/drafts wins over /signals)', () => {
  const group = groupFor('/signals/drafts');
  const leaf = leafFor('/signals/drafts', group);
  assert.equal(leaf?.label, 'Drafts');
});

check("leafFor resolves /ingest to Sources via 'also'", () => {
  const group = groupFor('/ingest');
  const leaf = leafFor('/ingest', group);
  assert.equal(leaf?.label, 'Sources');
});

check('isActiveGroup: /tooling/console is active for the tooling group, not scout', () => {
  const tooling = groupFor('/tooling');
  const scout = groupFor('/scout');
  assert.equal(isActiveGroup('/tooling/console', tooling), true);
  assert.equal(isActiveGroup('/tooling/console', scout), false);
});

check('isChromeless: login, showcase, decks and print digests render without the chrome', () => {
  for (const p of ['/login', '/showcase', '/costs/deck', '/ingestion/deck', '/research/digest', '/signals/digest', '/education/agentic-harnesses/deck', '/login/']) {
    assert.equal(isChromeless(p), true, p);
  }
  for (const p of ['/', '/ask', '/blotter', '/education/agentic-harnesses', '/costs', '/research', '/signals', '/blotter/2026-09-22/pdf-not', '/education/x/deck/extra']) {
    assert.equal(isChromeless(p), false, p);
  }
});

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
