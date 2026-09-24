// Tests for the embedding pipeline's pure pieces: chunking (lib/embed/chunk.ts)
// and reciprocal rank fusion (lib/ask/fusion.ts). Pure, no DB, no network.
//
// Run: node scripts/test-embed.mjs

import assert from 'node:assert/strict';

const { chunkRecord, hashText, CHUNK_TOKENS, OVERLAP_TOKENS, MAX_CHUNKS } = await import('../lib/embed/chunk.ts');
const { reciprocalRankFusion, fuseOrder, RRF_K } = await import('../lib/ask/fusion.ts');

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

// ---- chunkRecord ---------------------------------------------------------------

check('chunkRecord: empty text produces no chunks', () => {
  assert.deepEqual(chunkRecord({ title: 'T', text: '' }), []);
  assert.deepEqual(chunkRecord({ title: 'T', text: '   ' }), []);
});

check('chunkRecord: short text produces exactly one chunk, prefixed with the title', () => {
  const chunks = chunkRecord({ title: 'A claim about hiring', text: 'Short body text.' });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_no, 0);
  assert.equal(chunks[0].text, 'A claim about hiring\nShort body text.');
});

check('chunkRecord: a blank title omits the prefix line', () => {
  const chunks = chunkRecord({ title: '', text: 'Body only.' });
  assert.equal(chunks[0].text, 'Body only.');
});

check('chunkRecord: long text splits into multiple windows with overlap', () => {
  // 5000 distinguishable chars: window ~= 800 tokens * 4 chars/token = 3200 chars.
  const body = Array.from({ length: 5000 }, (_, i) => String(i % 10)).join('');
  const chunks = chunkRecord({ title: '', text: body });
  assert.ok(chunks.length >= 2, `expected multiple chunks, got ${chunks.length}`);
  const stride = CHUNK_TOKENS * 4 - OVERLAP_TOKENS * 4;
  // Chunk 1 should start `stride` chars into the body, so it repeats the last
  // OVERLAP_TOKENS*4 chars of chunk 0 (both chunks have no title prefix here).
  const chunk0Tail = chunks[0].text.slice(-OVERLAP_TOKENS * 4);
  const chunk1Head = chunks[1].text.slice(0, OVERLAP_TOKENS * 4);
  assert.equal(chunk0Tail, chunk1Head, 'consecutive chunks should overlap by OVERLAP_TOKENS*4 chars');
  assert.equal(chunks[1].chunk_no, 1);
  void stride;
});

check('chunkRecord: caps at MAX_CHUNKS even for very long text', () => {
  const body = 'x'.repeat(500_000);
  const chunks = chunkRecord({ title: 'Long', text: body });
  assert.equal(chunks.length, MAX_CHUNKS);
});

check('chunkRecord: text_hash is stable for identical input and differs for different input', () => {
  const a = chunkRecord({ title: 'X', text: 'same body' })[0];
  const b = chunkRecord({ title: 'X', text: 'same body' })[0];
  const c = chunkRecord({ title: 'X', text: 'different body' })[0];
  assert.equal(a.text_hash, b.text_hash);
  assert.notEqual(a.text_hash, c.text_hash);
  assert.equal(a.text_hash, hashText(a.text));
});

check('chunkRecord: chunk_no is sequential starting at 0', () => {
  const body = 'y'.repeat(20_000);
  const chunks = chunkRecord({ title: '', text: body });
  chunks.forEach((c, i) => assert.equal(c.chunk_no, i));
});

// ---- reciprocal rank fusion ------------------------------------------------------

check('reciprocalRankFusion: single list scores by 1/(k+rank)', () => {
  const scores = reciprocalRankFusion([['a', 'b', 'c']], 60);
  assert.equal(scores.get('a'), 1 / 61);
  assert.equal(scores.get('b'), 1 / 62);
  assert.equal(scores.get('c'), 1 / 63);
});

check('reciprocalRankFusion: scores from multiple lists sum per key', () => {
  const scores = reciprocalRankFusion([['a', 'b'], ['b', 'a']], 60);
  // a: rank 1 in list 1 (1/61), rank 2 in list 2 (1/62)
  // b: rank 2 in list 1 (1/62), rank 1 in list 2 (1/61)
  assert.equal(scores.get('a'), 1 / 61 + 1 / 62);
  assert.equal(scores.get('b'), 1 / 62 + 1 / 61);
  assert.equal(scores.get('a'), scores.get('b'), 'symmetric ranks should tie');
});

check('fuseOrder: a key appearing near the top of both lists outranks one appearing in only one list', () => {
  const order = fuseOrder([
    ['x', 'y', 'z'],
    ['y', 'x', 'w'],
  ]);
  // x: 1/61 + 1/62; y: 1/62 + 1/61 (tie with x); z, w appear once each, lower.
  assert.ok(order.indexOf('x') < order.indexOf('z'));
  assert.ok(order.indexOf('y') < order.indexOf('w'));
  assert.ok(order.indexOf('z') !== -1 && order.indexOf('w') !== -1);
});

check('fuseOrder: default k matches RRF_K', () => {
  const withDefault = fuseOrder([['p', 'q']]);
  const withExplicit = fuseOrder([['p', 'q']], RRF_K);
  assert.deepEqual(withDefault, withExplicit);
});

check('fuseOrder: empty input produces an empty order', () => {
  assert.deepEqual(fuseOrder([]), []);
  assert.deepEqual(fuseOrder([[], []]), []);
});

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
