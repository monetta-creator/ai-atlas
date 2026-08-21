// Tests for the Ask workspace's pure logic: the multi-turn wire contract
// (lib/ask/history.ts), the localStorage conversation store
// (components/ask/store.ts, run against a shim), citation parsing with offset
// tags and merged maps (lib/ask/verify.ts), and house style on the starter and
// registry strings. No DB, no network.
//
// Run: node scripts/test-ask.mjs

import assert from 'node:assert/strict';

// localStorage shim BEFORE the store module loads.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => { backing.set(k, String(v)); },
  removeItem: (k) => { backing.delete(k); },
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {} };

const {
  parseAskBody, clampHistory, retrievalQuery, clampSignalOffset, expandVocabulary,
  encodeCostReport, extractCostReport, parseCostReport, COST_MARKER,
  USER_TURN_CAP, ASSISTANT_TURN_CAP, MAX_MESSAGES, CHAR_BUDGET,
} = await import('../lib/ask/history.ts');
const { parseCitations } = await import('../lib/ask/verify.ts');
const { EXAMPLE_QUESTIONS } = await import('../components/ask/starters.ts');
const store = await import('../components/ask/store.ts');

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

// ---- history: parseAskBody ---------------------------------------------------
check('parseAskBody: legacy { query }', () =>
  assert.deepEqual(parseAskBody({ query: ' hi ' }), [{ role: 'user', content: 'hi' }]));
check('parseAskBody: messages shape', () =>
  assert.deepEqual(
    parseAskBody({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] })?.length,
    3
  ));
check('parseAskBody: drops empty turns', () =>
  assert.deepEqual(parseAskBody({ messages: [{ role: 'user', content: '  ' }, { role: 'user', content: 'q' }] }), [{ role: 'user', content: 'q' }]));
check('parseAskBody: rejects assistant-last', () =>
  assert.equal(parseAskBody({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }), null));
check('parseAskBody: rejects junk', () => {
  assert.equal(parseAskBody(null), null);
  assert.equal(parseAskBody({}), null);
  assert.equal(parseAskBody({ messages: [{ role: 'system', content: 'x' }] }), null);
  assert.equal(parseAskBody({ messages: 'nope' }), null);
});

// ---- history: clampHistory ---------------------------------------------------
check('clampHistory: user turn clamped to cap', () => {
  const out = clampHistory([{ role: 'user', content: 'x'.repeat(5000) }]);
  assert.equal(out[0].content.length, USER_TURN_CAP);
});
check('clampHistory: long assistant clipped from the head with marker', () => {
  const out = clampHistory([
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a'.repeat(9000) },
    { role: 'user', content: 'follow' },
  ]);
  const assistant = out.find((m) => m.role === 'assistant');
  assert.ok(assistant.content.startsWith('[...] '));
  assert.equal(assistant.content.length, ASSISTANT_TURN_CAP + 6);
});
check('clampHistory: keeps at most MAX_MESSAGES, drops oldest whole', () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: 'user', content: `u${i}` });
    msgs.push({ role: 'assistant', content: `a${i}` });
  }
  msgs.push({ role: 'user', content: 'latest' });
  const out = clampHistory(msgs);
  assert.ok(out.length <= MAX_MESSAGES);
  assert.equal(out[out.length - 1].content, 'latest');
  assert.equal(out[0].role, 'user');
});
check('clampHistory: char budget forces drops, latest always kept', () => {
  const big = 'x'.repeat(1900);
  const msgs = [
    { role: 'user', content: big }, { role: 'assistant', content: big },
    { role: 'user', content: big }, { role: 'assistant', content: big },
    { role: 'user', content: big }, { role: 'assistant', content: big },
    { role: 'user', content: 'latest question' },
  ];
  const out = clampHistory(msgs);
  const total = out.reduce((n, m) => n + m.content.length, 0);
  assert.ok(total <= CHAR_BUDGET, `total ${total}`);
  assert.equal(out[out.length - 1].content, 'latest question');
  assert.equal(out[0].role, 'user');
});
check('clampHistory: never starts with an assistant turn', () => {
  const out = clampHistory([
    { role: 'user', content: 'x'.repeat(1990) },
    { role: 'assistant', content: 'y'.repeat(2400) },
    { role: 'user', content: 'z'.repeat(1990) },
    { role: 'assistant', content: 'w'.repeat(2400) },
    { role: 'user', content: 'latest' },
  ]);
  assert.equal(out[0].role, 'user');
  assert.equal(out[out.length - 1].content, 'latest');
});

// ---- history: retrievalQuery + offset ---------------------------------------
check('retrievalQuery: latest plus prior user turn, capped', () => {
  const q = retrievalQuery([
    { role: 'user', content: 'first question about capex' },
    { role: 'assistant', content: 'an answer' },
    { role: 'user', content: 'what contradicts that?' },
  ]);
  assert.ok(q.startsWith('what contradicts that? first question about capex'));
  // The base is capped at 1200; vocabulary expansion appends after the cap.
  const long = retrievalQuery([{ role: 'user', content: 'x'.repeat(3000) }]);
  assert.ok(long.length <= 1200);
});
check('expandVocabulary: street terms gain Atlas terms, direct hits pass through', () => {
  const q = expandVocabulary('are frontier models still beating open source?');
  assert.ok(q.includes('parity'), 'beating -> parity');
  assert.ok(q.includes('open-weight'), 'open source -> open-weight');
  assert.ok(q.startsWith('are frontier models still beating open source?'), 'original text kept first');
  assert.equal(expandVocabulary('what is the capex thesis?'), 'what is the capex thesis?');
});
check('retrievalQuery: expansion terms ride along', () => {
  const q = retrievalQuery([{ role: 'user', content: 'is open source catching up?' }]);
  assert.ok(q.includes('open-weight'));
  assert.ok(q.includes('parity'));
});
check('clampSignalOffset: clamps and defaults', () => {
  assert.equal(clampSignalOffset(undefined), 0);
  assert.equal(clampSignalOffset('7'), 7);
  assert.equal(clampSignalOffset(-3), 0);
  assert.equal(clampSignalOffset(5000), 999);
  assert.equal(clampSignalOffset('nope'), 0);
});

// ---- verify: offset tags + merged maps --------------------------------------
const IDS = { claims: ['2.3'], bridges: [], stances: [], questions: [], concepts: [], threads: [], stanceToQuestion: {} };
check('parseCitations: stale S1 and fresh S7 both resolve through a merged map', () => {
  const merged = { S1: 'uuid-one', S7: 'uuid-seven' };
  const spans = parseCitations('Earlier [signal S1] and now [signal S7] and [claim 2.3].', IDS, merged);
  const codes = spans.flatMap((s) => s.codes);
  assert.equal(codes.length, 3);
  assert.deepEqual(codes.map((c) => c.valid), [true, true, true]);
  assert.equal(codes[0].href, '/signals/uuid-one');
  assert.equal(codes[1].href, '/signals/uuid-seven');
});
check('parseCitations: unknown tag flags invalid', () => {
  const spans = parseCitations('See [signal S9].', IDS, { S1: 'u' });
  assert.equal(spans[0].codes[0].valid, false);
});

// ---- store -------------------------------------------------------------------
check('store: create, append, title truncation, maps, offset', () => {
  const longFirst = 'a very long opening question that definitely exceeds the sixty character title cap for rails';
  const id = store.createConvo(longFirst);
  assert.equal(store.getConvo(id).title.length, store.TITLE_CAP);
  store.appendMessage(id, { role: 'assistant', content: 'ans', signalMap: { S1: 'u1', S2: 'u2' } });
  store.appendMessage(id, { role: 'user', content: 'more' });
  store.appendMessage(id, { role: 'assistant', content: 'ans2', signalMap: { S1: 'u1', S2: 'u2', S5: 'u5' } });
  const convo = store.getConvo(id);
  assert.equal(convo.messages.length, 4);
  assert.equal(store.maxSignalSuffix(convo), 5);
  assert.deepEqual(store.mergedSignalMap(convo), { S1: 'u1', S2: 'u2', S5: 'u5' });
});
check('store: dropLastAssistant only drops a trailing assistant', () => {
  const id = store.createConvo('q');
  store.appendMessage(id, { role: 'assistant', content: 'a' });
  store.dropLastAssistant(id);
  assert.equal(store.getConvo(id).messages.length, 1);
  store.dropLastAssistant(id); // trailing user: no-op
  assert.equal(store.getConvo(id).messages.length, 1);
});
check('store: trims to MAX_CONVOS', () => {
  for (let i = 0; i < store.MAX_CONVOS + 10; i++) store.createConvo(`c${i}`);
  const raw = JSON.parse(backing.get('atlas_ask_v1'));
  assert.equal(raw.convos.length, store.MAX_CONVOS);
});
check('store: deleteConvo removes', () => {
  const id = store.createConvo('to delete');
  store.deleteConvo(id);
  assert.equal(store.getConvo(id), null);
});

// ---- web sources (the web-search toggle's sentinel wire) ---------------------
const {
  encodeWebSources, extractWebSources, collectWebSources, WEB_SOURCES_MARKER,
} = await import('../lib/ask/history.ts');

check('web sources: encode/extract round trip', () => {
  const sources = [{ url: 'https://example.com/a', title: 'A story' }];
  const acc = `The answer text.${encodeWebSources(sources)}`;
  const out = extractWebSources(acc);
  assert.equal(out.text, 'The answer text.');
  assert.deepEqual(out.sources, sources);
});
check('web sources: no marker leaves text untouched', () => {
  const out = extractWebSources('Plain answer, no web.');
  assert.equal(out.text, 'Plain answer, no web.');
  assert.deepEqual(out.sources, []);
});
check('web sources: a torn sentinel drops sources, keeps the answer', () => {
  const out = extractWebSources(`Answer.\n${WEB_SOURCES_MARKER}[{"url":"https://x`);
  assert.equal(out.text, 'Answer.');
  assert.deepEqual(out.sources, []);
});
check('web sources: bad urls filtered, titles defaulted, capped at 8', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://s${i}.com`, title: '' }));
  const acc = `T${encodeWebSources([{ url: 'javascript:alert(1)', title: 'evil' }])}`;
  assert.deepEqual(extractWebSources(acc).sources, []);
  const out = extractWebSources(`T${WEB_SOURCES_MARKER}${JSON.stringify(many)}`);
  assert.equal(out.sources.length, 8);
  assert.equal(out.sources[0].title, 'https://s0.com');
});
check('collectWebSources: dedupes by url, skips non-text blocks', () => {
  const msg = {
    content: [
      { type: 'server_tool_use' },
      { type: 'text', citations: [
        { type: 'web_search_result_location', url: 'https://a.com/x', title: 'A' },
        { type: 'web_search_result_location', url: 'https://a.com/x', title: 'A again' },
        { type: 'char_location', url: 'https://not-web.com' },
      ] },
      { type: 'text', citations: [{ type: 'web_search_result_location', url: 'https://b.com/y', title: null }] },
    ],
  };
  assert.deepEqual(collectWebSources(msg), [
    { url: 'https://a.com/x', title: 'A' },
    { url: 'https://b.com/y', title: 'https://b.com/y' },
  ]);
});

// ---- cost report sentinel ----------------------------------------------------
check('cost report: encode/extract round-trip', () => {
  const report = {
    cost_usd: 0.0231, input_tokens: 41200, output_tokens: 2100,
    cache_read_tokens: 30000, searches: 2, rounds: 5, model: 'claude-haiku-4-5',
  };
  const { text, cost } = extractCostReport(`The answer.${encodeCostReport(report)}`);
  assert.equal(text, 'The answer.');
  assert.deepEqual(cost, report);
});
check('cost report: missing or torn sentinel yields null, answer kept', () => {
  assert.deepEqual(extractCostReport('Plain answer.'), { text: 'Plain answer.', cost: null });
  const torn = extractCostReport(`Answer.\n${COST_MARKER}{"cost_usd": 0.1`);
  assert.equal(torn.text, 'Answer.');
  assert.equal(torn.cost, null);
});
check('cost report: cost line before web-sources line, both extract', () => {
  const report = {
    cost_usd: 0.004, input_tokens: 9000, output_tokens: 800,
    cache_read_tokens: 0, searches: 1, rounds: 1, model: 'claude-haiku-4-5',
  };
  const acc = `Answer.${encodeCostReport(report)}${encodeWebSources([{ url: 'https://a.com/x', title: 'A' }])}`;
  const w = extractWebSources(acc);
  assert.equal(w.sources.length, 1);
  const c = extractCostReport(w.text);
  assert.equal(c.text, 'Answer.');
  assert.deepEqual(c.cost, report);
});
check('parseCostReport: clamps junk', () => {
  assert.equal(parseCostReport(null), null);
  const p = parseCostReport({ cost_usd: -1, input_tokens: 'nope', model: 42 });
  assert.equal(p.cost_usd, 0);
  assert.equal(p.input_tokens, 0);
  assert.equal(p.model, '');
});

// ---- house style -------------------------------------------------------------
// The starter list became the lobby's EXAMPLE_QUESTIONS strings in the
// 2026-08-13 polish; the count assertion tracks the live list.
check('example questions: non-empty, no em dash anywhere', () => {
  assert.ok(EXAMPLE_QUESTIONS.length >= 4);
  for (const s of EXAMPLE_QUESTIONS) {
    assert.ok(typeof s === 'string' && !s.includes('—'), s);
  }
});

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL ASK CHECKS PASSED');
