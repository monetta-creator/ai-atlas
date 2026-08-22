// Tests for the deep-research pure logic (lib/ask/deep.ts): the signal-tag
// minter, tool input validation, result rendering and clipping, the NDJSON
// protocol, and house style on every model- and user-facing string. The two
// search functions (lib/ask/search.ts) are exercised against a scripted fake Q.
// No DB, no network.
//
// Run: node scripts/test-deep.mjs

import assert from 'node:assert/strict';

const deep = await import('../lib/ask/deep.ts');
const {
  MAX_ROUNDS, MAX_CALLS_PER_ROUND, RESULT_CAP, INPUT_TOKEN_CAP,
  createTagger, parseSignalMap,
  parseSearchAtlasInput, parseFetchRecordInput, parseSearchArticlesInput,
  citeToken, clipResult, renderSearchHits, renderArticleHits, renderRecord,
  ndStatus, ndDelta, ndDone, ndError, ndVerify,
  statusSearch, statusRead, statusArticles,
  DEEP_TOOLS, DEEP_ADDENDUM, STATUS_START, STATUS_WRITING, STATUS_VERIFYING,
  VERIFY_TOOL, VERIFY_INSTRUCTION, VERIFY_SYSTEM,
  extractQuotes, extractNumbers, runDeterministicChecks, parseVerifyOutput,
} = deep;
const { searchAtlas, searchArticles } = await import('../lib/ask/search.ts');

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
// For tests that await the injected-Q search functions.
const acheck = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
};

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

// ---- tagger ------------------------------------------------------------------
check('tagger: mints from the offset', () => {
  const t = createTagger({}, 4);
  assert.equal(t.tagFor(U1), 'S5');
  assert.equal(t.tagFor(U2), 'S6');
});
check('tagger: same uuid keeps its tag', () => {
  const t = createTagger({}, 0);
  assert.equal(t.tagFor(U1), 'S1');
  assert.equal(t.tagFor(U1), 'S1');
});
check('tagger: seed entries resolve and pin the counter', () => {
  const t = createTagger({ S3: U1 }, 1);
  assert.equal(t.idFor('S3'), U1);
  assert.equal(t.idFor('s3'), U1); // case-insensitive lookup
  assert.equal(t.tagFor(U1), 'S3'); // rediscovery keeps the old tag
  assert.equal(t.tagFor(U2), 'S4'); // fresh tags continue past the seed
});
check('tagger: idFor unknown tag is null', () => {
  assert.equal(createTagger({}, 0).idFor('S9'), null);
});
check('tagger: refs covers seeded and minted', () => {
  const t = createTagger({ S1: U1 }, 0);
  t.tagFor(U2);
  const refs = Object.fromEntries(t.refs().map((r) => [r.tag, r.id]));
  assert.deepEqual(refs, { S1: U1, S2: U2 });
});

// ---- parseSignalMap ----------------------------------------------------------
check('parseSignalMap: keeps well-shaped entries only', () => {
  const out = parseSignalMap({ S1: U1, s2: U2, nope: U3, S3: 'not-a-uuid', S4: 42 });
  assert.deepEqual(out, { S1: U1, S2: U2 });
});
check('parseSignalMap: junk input is empty', () => {
  assert.deepEqual(parseSignalMap(null), {});
  assert.deepEqual(parseSignalMap([1, 2]), {});
  assert.deepEqual(parseSignalMap('S1'), {});
});

// ---- tool input validation ---------------------------------------------------
check('search input: defaults and clamps', () => {
  const p = parseSearchAtlasInput({ query: '  capex  ' });
  assert.equal(p.query, 'capex');
  assert.equal(p.limit, 5);
  assert.equal(p.kinds.length, 7);
  assert.equal(parseSearchAtlasInput({ query: 'x', limit: 99 }).limit, 8);
});
check('search input: kind filtering', () => {
  const p = parseSearchAtlasInput({ query: 'x', kinds: ['claim', 'question', 'claim'] });
  assert.deepEqual(p.kinds, ['claim']); // question unsupported, dupes dropped
  assert.equal(typeof parseSearchAtlasInput({ query: 'x', kinds: ['question'] }), 'string');
});
check('search input: empty query rejected', () => {
  assert.equal(typeof parseSearchAtlasInput({}), 'string');
  assert.equal(typeof parseSearchAtlasInput({ query: '   ' }), 'string');
});
check('fetch input: codes, slugs, tags', () => {
  assert.deepEqual(parseFetchRecordInput({ kind: 'claim', id: '2.3' }), { kind: 'claim', id: '2.3' });
  assert.deepEqual(parseFetchRecordInput({ kind: 'concept', id: 'Unit-Economics' }), { kind: 'concept', id: 'unit-economics' });
  assert.deepEqual(parseFetchRecordInput({ kind: 'signal', id: 's3' }), { kind: 'signal', id: 'S3' });
});
check('fetch input: bad shapes rejected as strings', () => {
  assert.equal(typeof parseFetchRecordInput({ kind: 'signal', id: '2.3' }), 'string');
  assert.equal(typeof parseFetchRecordInput({ kind: 'evidence', id: 'x' }), 'string');
  assert.equal(typeof parseFetchRecordInput({ kind: 'claim', id: 'a b c' }), 'string');
  assert.equal(typeof parseFetchRecordInput({ kind: 'claim' }), 'string');
});
check('articles input: query required', () => {
  assert.deepEqual(parseSearchArticlesInput({ query: 'tokens' }), { query: 'tokens' });
  assert.equal(typeof parseSearchArticlesInput({}), 'string');
});

// ---- rendering ---------------------------------------------------------------
check('citeToken: question gets the Q word', () => {
  assert.equal(citeToken('question', 'unit-economics'), '[Q unit-economics]');
  assert.equal(citeToken('claim', '2.3'), '[claim 2.3]');
  assert.equal(citeToken('signal', 'S3'), '[signal S3]');
});
check('clipResult: caps at RESULT_CAP', () => {
  const s = clipResult('x'.repeat(RESULT_CAP + 500));
  assert.ok(s.length <= RESULT_CAP + 4);
  assert.ok(s.endsWith(' ...'));
});
check('renderSearchHits: labeled lines, empty message', () => {
  const out = renderSearchHits([{ kind: 'claim', id: '2.3', snippet: 'API prices fall' }]);
  assert.ok(out.startsWith('[claim 2.3] API prices fall'));
  assert.ok(renderSearchHits([]).includes('No records matched'));
});
check('renderArticleHits: anchors to the signal tag', () => {
  const out = renderArticleHits([{ signalTag: 'S2', title: 'A story', outlet: 'Wire', excerpt: 'the **quote**' }]);
  assert.ok(out.includes('[signal S2]'));
  assert.ok(out.includes('(Wire)'));
});
check('renderRecord: signal tags ride out, uuids never do', () => {
  const t = createTagger({}, 0);
  const payload = {
    kind: 'claim', title: 'Claim text', code: '2.3', subtitle: 'Claim · market', body: null,
    test: 'A falsifying test', brief: null, counterpoint: null, significance: null, lenses: null,
    published_on: null, source: null,
    evidence: [{ direction: 'supports', excerpt: 'an excerpt', source_title: 'Src', source_url: null, outlet: 'Out' }],
    signals: [{ id: U1, title: 'Touching signal', published_on: '2026-08-01' }],
    stances: [], prerequisites: [], builds_toward: [], internal: '/claim/2.3',
  };
  const out = renderRecord(payload, '2.3', t.tagFor);
  assert.ok(out.startsWith('[claim 2.3] Claim text'));
  assert.ok(out.includes('Falsifying test:'));
  assert.ok(out.includes('Evidence (supports): an excerpt (Src, Out)'));
  assert.ok(out.includes('[signal S1] "Touching signal"'));
  assert.ok(!out.includes(U1));
});

// ---- NDJSON protocol ---------------------------------------------------------
check('ndjson: one parseable object per line', () => {
  for (const line of [ndStatus('a'), ndDelta('b'), ndError('c'), ndDone({ S1: U1 })]) {
    assert.ok(line.endsWith('\n'));
    assert.equal(line.slice(0, -1).includes('\n'), false);
    JSON.parse(line);
  }
  assert.deepEqual(JSON.parse(ndDone({ S1: U1 })), { type: 'done', signals: { S1: U1 } });
});

// ---- searchAtlas / searchArticles against a fake Q ---------------------------
const fakeQ = (responses) => {
  let i = 0;
  return async (sql) => {
    const r = responses[i++];
    if (!r) throw new Error(`fake Q exhausted at call ${i}: ${sql.slice(0, 60)}`);
    return r;
  };
};
await acheck('searchAtlas: signals become tags, drafts admin-only in SQL', async () => {
  const t = createTagger({}, 0);
  const rows = [[{ id: U1, title: 'Sig', summary: 'sum', claim_touches: ['2.3'], is_published: false }]];
  const hits = await searchAtlas(fakeQ(rows), 'q', { kinds: ['signal'], limit: 5, admin: true, tagFor: t.tagFor });
  assert.equal(hits[0].kind, 'signal');
  assert.equal(hits[0].id, 'S1');
  assert.ok(hits[0].snippet.includes('(draft)'));
  assert.ok(hits[0].snippet.includes('touches 2.3'));
});
await acheck('searchAtlas: only asked-for kinds hit the DB', async () => {
  let calls = 0;
  const q = async () => { calls++; return []; };
  await searchAtlas(q, 'q', { kinds: ['claim', 'concept'], limit: 5, tagFor: () => 'S1' });
  assert.equal(calls, 2);
});
await acheck('searchArticles: both legs, tags anchored', async () => {
  const t = createTagger({}, 0);
  const rows = [
    [{ id: 'x', title: 'Manual src', outlet: 'Wire', excerpt: 'frag', sig_id: U1 }],
    [{ sig_id: U2, sig_title: 'Pipeline sig', excerpt: 'frag2' }],
  ];
  const hits = await searchArticles(fakeQ(rows), 'q', { tagFor: t.tagFor });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].signalTag, 'S1');
  assert.equal(hits[1].signalTag, 'S2');
});

// ---- verification: deterministic layer ---------------------------------------
check('extractQuotes: long quotes only, citations stripped, curly normalized', () => {
  const qs = extractQuotes(
    'He said “entry-level workers saw a sixteen percent decline overall” [signal S1]. A "short" aside. And "another quoted span long enough to count here".'
  );
  assert.deepEqual(qs, [
    'entry-level workers saw a sixteen percent decline overall',
    'another quoted span long enough to count here',
  ]);
});
check('extractNumbers: cores, units, small-integer skip', () => {
  const ns = extractNumbers('A 16% drop, $103 billion, 3.6% lower, 950 occupations, 5 claims, 7% of firms [claim 2.3]');
  assert.deepEqual(ns, ['16', '103', '3.6', '950', '7']);
});
check('deterministic checks: finds and misses', () => {
  const corpus = ['[signal S1] "Sig" entry-level workers aged 22-25 saw a 16% decline in head count, per ADP data on 950 occupations'];
  const r = runDeterministicChecks(
    'The data shows "a 16% decline in head count" across 950 occupations, though some argue a 40% rebound and that "the figures were fabricated by analysts entirely".',
    corpus
  );
  assert.equal(r.quotesChecked, 2);
  assert.deepEqual(r.quotesMissing, ['the figures were fabricated by analysts entirely']);
  assert.equal(r.numbersChecked, 3);
  assert.deepEqual(r.numbersMissing, ['40']);
});
check('deterministic checks: formatting differences do not flag', () => {
  const r = runDeterministicChecks('Spending hit $103 billion (103,000 million).', ['capex of 103 billion dollars']);
  assert.deepEqual(r.numbersMissing, ['103000']); // real difference IS flagged
  const r2 = runDeterministicChecks('Spending hit $103 billion.', ['capex reached 103 billion']);
  assert.deepEqual(r2.numbersMissing, []);
});
check('parseVerifyOutput: clamps and drops junk', () => {
  const p = parseVerifyOutput({
    checked: 250,
    flags: [
      { excerpt: 'x'.repeat(300), issue: 'wrong number' },
      { excerpt: '', issue: 'no excerpt' },
      'junk',
      { excerpt: 'ok', issue: 'y'.repeat(300) },
    ],
  });
  assert.equal(p.checked, 99);
  assert.equal(p.flags.length, 2);
  assert.equal(p.flags[0].excerpt.length, 140);
  assert.equal(p.flags[1].issue.length, 280);
  assert.equal(parseVerifyOutput(null), null);
  assert.deepEqual(parseVerifyOutput({}), { checked: 0, flags: [], verdictLanguage: [] });
});
check('ndVerify: parseable line with report', () => {
  const line = ndVerify({ checked: 3, flags: [], quotesChecked: 1, quotesMissing: [], numbersChecked: 2, numbersMissing: [] });
  const ev = JSON.parse(line);
  assert.equal(ev.type, 'verify');
  assert.equal(ev.report.checked, 3);
});
check('ndCost: parseable line', () => {
  const cost = JSON.parse(deep.ndCost({
    cost_usd: 0.02, input_tokens: 40000, output_tokens: 1800,
    cache_read_tokens: 30000, searches: 0, rounds: 5, model: 'claude-haiku-4-5',
  }));
  assert.equal(cost.type, 'cost');
  assert.equal(cost.report.rounds, 5);
});
check('parseVerifyOutput: verdict_language clamped, absent -> empty', () => {
  const out = parseVerifyOutput({
    checked: 4, flags: [],
    verdict_language: ['the evidence leans toward', 42, 'x'.repeat(400), 'a', 'b', 'c'],
  });
  // The raw array is sliced to 4 entries first, then non-strings drop.
  assert.equal(out.verdictLanguage.length, 3);
  assert.equal(out.verdictLanguage[0], 'the evidence leans toward');
  assert.equal(out.verdictLanguage[1].length, 140);
  assert.deepEqual(parseVerifyOutput({ checked: 1, flags: [] }).verdictLanguage, []);
});

// ---- guards + house style ----------------------------------------------------
check('guards: the plan numbers', () => {
  assert.equal(MAX_ROUNDS, 4);
  assert.equal(MAX_CALLS_PER_ROUND, 6);
  assert.equal(RESULT_CAP, 1500);
  assert.equal(INPUT_TOKEN_CAP, 40000);
});
check('house style: no em dash in any model- or user-facing string', () => {
  const strings = [
    DEEP_ADDENDUM, STATUS_START, STATUS_WRITING, STATUS_VERIFYING,
    VERIFY_INSTRUCTION, VERIFY_SYSTEM, VERIFY_TOOL.description ?? '',
    statusSearch('x', 2), statusRead('[claim 2.3]'), statusArticles('x', 1),
    ...DEEP_TOOLS.map((t) => t.description ?? ''),
    ...DEEP_TOOLS.flatMap((t) => Object.values(t.input_schema.properties ?? {}).map((p) => p.description ?? '')),
  ];
  for (const s of strings) assert.equal(s.includes('—'), false, `em dash in: ${s.slice(0, 60)}`);
});
check('tools: names and required fields', () => {
  assert.deepEqual(DEEP_TOOLS.map((t) => t.name), ['search_atlas', 'fetch_record', 'search_articles']);
  for (const t of DEEP_TOOLS) assert.ok(t.input_schema.required.length >= 1);
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll deep-research tests passed.');
