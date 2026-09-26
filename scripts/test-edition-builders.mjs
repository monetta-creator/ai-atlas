// Pure tests for "What builders are reading" (lib/edition/builders-core.ts):
// the cheap chips, the catalog-product matcher, the model-JSON validator (the
// type boundary for qwen/GLM's loose output), the no-model fallback, and the
// tag grouping. READ-ONLY, no DB, no model call.
// Run: node scripts/test-edition-builders.mjs

import assert from 'node:assert/strict';
import {
  chipsFor, catalogHrefFor, validateBuilderJudgments, fallbackReads, groupReadsByTag,
} from '../lib/edition/builders-core.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

console.log('edition builders:');

// ---------------------------------------------------------------- chipsFor

check('chipsFor: a Show HN title sets showHn', () => {
  const c = chipsFor({ title: 'Show HN: My new inference cache', url: null, points: 10, comments: 5 });
  assert.equal(c.showHn, true);
});

check('chipsFor: a github.com host sets repo', () => {
  const c = chipsFor({ title: 'A neat project', url: 'https://github.com/foo/bar', points: 10, comments: 5 });
  assert.equal(c.repo, true);
});

check('chipsFor: comments at 30 on points 40 clears the debate floor', () => {
  const c = chipsFor({ title: 'A story', url: null, points: 40, comments: 30 });
  assert.equal(c.debate, true);
});

check('chipsFor: comments at 5 never debates, whatever the points', () => {
  const c = chipsFor({ title: 'A story', url: null, points: 1000, comments: 5 });
  assert.equal(c.debate, false);
});

// ---------------------------------------------------------------- catalogHrefFor

const products = [
  { slug: 'cursor', name: 'Cursor', vendorDomain: 'cursor.com', urlHost: null, urlPath: null },
  { slug: 'bun', name: 'Bun', vendorDomain: null, urlHost: null, urlPath: null },
  { slug: 'copilot', name: 'GitHub Copilot', vendorDomain: null, urlHost: null, urlPath: null },
  { slug: 'copilot-short', name: 'Copilot', vendorDomain: null, urlHost: null, urlPath: null },
];

check('catalogHrefFor: host match on vendorDomain, www stripped', () => {
  const href = catalogHrefFor({ title: 'A tool ships an update', url: 'https://www.cursor.com/blog/x' }, products);
  assert.equal(href, '/tooling/cursor');
});

check('catalogHrefFor: whole-word name match, longest name wins', () => {
  const href = catalogHrefFor({ title: 'GitHub Copilot gets a new autocomplete mode', url: null }, products);
  assert.equal(href, '/tooling/copilot');
});

check('catalogHrefFor: a 3-letter product name never matches by title', () => {
  const href = catalogHrefFor({ title: 'The bun toasts nicely today', url: null }, products);
  assert.equal(href, null);
});

check('catalogHrefFor: no host and no title match returns null', () => {
  const href = catalogHrefFor({ title: 'Something entirely unrelated happens', url: 'https://example.com/x' }, products);
  assert.equal(href, null);
});

check('catalogHrefFor: a shared platform host (github.com) never matches on host alone, a different owner/repo stays null', () => {
  const platformProducts = [
    { slug: 'copilot', name: 'Copilot', vendorDomain: null, urlHost: 'github.com', urlPath: '/github/copilot' },
  ];
  const href = catalogHrefFor({ title: 'jevmem: a new memory layer for agents', url: 'https://github.com/acme/jevmem' }, platformProducts);
  assert.equal(href, null);
});

check('catalogHrefFor: a shared platform host matches only when owner/repo (first two path segments) agree', () => {
  const platformProducts = [
    { slug: 'copilot', name: 'Copilot', vendorDomain: null, urlHost: 'github.com', urlPath: '/github/copilot' },
    { slug: 'jevmem', name: 'jevmem', vendorDomain: null, urlHost: 'github.com', urlPath: '/acme/jevmem' },
  ];
  const href = catalogHrefFor({ title: 'jevmem: a new memory layer for agents', url: 'https://github.com/acme/jevmem' }, platformProducts);
  assert.equal(href, '/tooling/jevmem');
});

// ---------------------------------------------------------------- validateBuilderJudgments

const hits = [0, 1, 2, 3, 4].map((i) => ({
  title: `Story ${i}`, url: `https://x${i}.com`, hnUrl: `https://news.ycombinator.com/item?id=${i}`, points: 100 - i, comments: 10 + i,
}));

check('validateBuilderJudgments: accepts a bare array', () => {
  const out = validateBuilderJudgments(hits, [{ index: 0, keep: true, tag: 'agents', line: 'why it matters' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, 'agents');
  assert.equal(out[0].title, 'Story 0');
});

check('validateBuilderJudgments: accepts {items:[...]}', () => {
  const out = validateBuilderJudgments(hits, { items: [{ index: 1, keep: true, tag: 'infra' }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, 'infra');
});

check('validateBuilderJudgments: coerces a string index and a string keep', () => {
  const out = validateBuilderJudgments(hits, [{ index: '2', keep: 'true', tag: 'infra' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Story 2');
});

check('validateBuilderJudgments: drops out-of-range and duplicate indexes', () => {
  const out = validateBuilderJudgments(hits, [
    { index: 0, keep: true, tag: 'agents' },
    { index: 0, keep: true, tag: 'agents' }, // duplicate
    { index: 99, keep: true, tag: 'agents' }, // out of range
    { index: -1, keep: true, tag: 'agents' }, // out of range
  ]);
  assert.equal(out.length, 1);
});

check('validateBuilderJudgments: an unrecognized tag files as field', () => {
  const out = validateBuilderJudgments(hits, [{ index: 1, keep: true, tag: 'not-a-real-tag' }]);
  assert.equal(out[0].tag, 'field');
});

check('validateBuilderJudgments: a line replaces an em dash with a comma', () => {
  const out = validateBuilderJudgments(hits, [{ index: 1, keep: true, tag: 'field', line: 'why it works — mostly' }]);
  assert.equal(out[0].line, 'why it works, mostly');
});

check('validateBuilderJudgments: a line over 140 chars clips to 140 with an ellipsis', () => {
  const long = 'lorem '.repeat(30); // 180 chars
  const out = validateBuilderJudgments(hits, [{ index: 1, keep: true, tag: 'field', line: long }]);
  assert.ok(out[0].line.length <= 140, out[0].line.length);
  assert.ok(out[0].line.endsWith('...'));
});

check('validateBuilderJudgments: honors the cap', () => {
  const raw = hits.map((_, i) => ({ index: i, keep: true, tag: 'field' }));
  const out = validateBuilderJudgments(hits, raw, [], 3);
  assert.equal(out.length, 3);
});

check('validateBuilderJudgments: keep=false is dropped', () => {
  const out = validateBuilderJudgments(hits, [{ index: 0, keep: false, tag: 'field' }]);
  assert.equal(out.length, 0);
});

// ---------------------------------------------------------------- fallbackReads

check('fallbackReads: top 8 by points, no line, filed as field notes', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    title: `Story ${i}`, url: `https://y${i}.com`, hnUrl: `https://news.ycombinator.com/item?id=${100 + i}`, points: 200 - i, comments: 5,
  }));
  const out = fallbackReads(many, [], 8);
  assert.equal(out.length, 8);
  assert.ok(out.every((r) => r.tag === 'field' && r.line === null));
  const top = [...many].sort((a, b) => b.points - a.points).slice(0, 8);
  assert.deepEqual(out.map((r) => r.title), top.map((h) => h.title));
});

check('fallbackReads: fills chips and catalogHref through the shared matcher', () => {
  const out = fallbackReads(
    [{ title: 'Show HN: Cursor ships an update', url: 'https://cursor.com/x', hnUrl: 'https://news.ycombinator.com/item?id=1', points: 10, comments: 30 }],
    products,
    8
  );
  assert.equal(out[0].showHn, true);
  assert.equal(out[0].debate, true);
  assert.equal(out[0].catalogHref, '/tooling/cursor');
});

// ---------------------------------------------------------------- groupReadsByTag

check('groupReadsByTag: BUILDER_TAGS order, empty tags omitted', () => {
  const reads = [
    { title: 'a', url: null, hnUrl: 'https://hn/1', points: 1, comments: 1, tag: 'infra', line: null, showHn: false, repo: false, debate: false, catalogHref: null },
    { title: 'b', url: null, hnUrl: 'https://hn/2', points: 1, comments: 1, tag: 'tooling', line: null, showHn: false, repo: false, debate: false, catalogHref: null },
  ];
  const groups = groupReadsByTag(reads);
  assert.deepEqual(groups.map((g) => g.tag), ['tooling', 'infra']);
  assert.ok(groups.every((g) => g.items.length > 0));
  assert.equal(groups.find((g) => g.tag === 'tooling').label, 'Tooling & models');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
