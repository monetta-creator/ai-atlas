// Tests for the Ask lanes (lib/ask/lanes.ts): the soft-failure classifier that
// decides whether a question is covered, thinly covered, adjacent to the
// Atlas's beat, or unrelated to it, plus the @@BEYOND@@ marker split and the
// coded decline card. Pure, no DB, no network; lanes.ts imports nothing.
//
// Run: node scripts/test-ask-lanes.mjs

import assert from 'node:assert/strict';

const {
  decideLane, splitBeyond, composeDecline, encodeDecline, extractDecline,
  laneAddendum, priorUserTurn, BEYOND_MARKER, DECLINE_MARKER, LANE_LABEL, ASK_PERSONA, SCOPE_WITH_BEYOND,
} = await import('../lib/ask/lanes.ts');

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

const sig = (over) => ({ hitCount: 0, maxRank: 0, explicit: false, beat: 'atlas', followUp: false, ...over });

// ---- decideLane ---------------------------------------------------------------
check('decideLane: explicit code match is always covered', () =>
  assert.equal(decideLane(sig({ explicit: true, hitCount: 0, maxRank: 0, beat: 'unrelated' })), 'covered'));

check('decideLane: strong hits (>=6, rank >=0.08) is covered', () =>
  assert.equal(decideLane(sig({ hitCount: 8, maxRank: 0.2 })), 'covered'));

check('decideLane: weak hits (some, but under the strong bar) is thin', () => {
  assert.equal(decideLane(sig({ hitCount: 1, maxRank: 0.025 })), 'thin');
  assert.equal(decideLane(sig({ hitCount: 5, maxRank: 0.03, beat: 'adjacent' })), 'thin');
  // Measured 2026-09-23: the beat plus a mid rank covers; the same rank off-beat is thin.
  assert.equal(decideLane(sig({ hitCount: 63, maxRank: 0.049, beat: 'atlas' })), 'covered');
  assert.equal(decideLane(sig({ hitCount: 62, maxRank: 0.037, beat: 'adjacent' })), 'thin');
  assert.equal(decideLane(sig({ hitCount: 48, maxRank: 0.028, beat: 'atlas' })), 'thin');
  assert.equal(decideLane(sig({ hitCount: 65, maxRank: 0.034, beat: 'atlas' })), 'covered');
  // Below the noise floor, hits do not rescue an off-beat question.
  assert.equal(decideLane(sig({ hitCount: 24, maxRank: 0.015, beat: 'unrelated' })), 'unrelated');
  assert.equal(decideLane(sig({ hitCount: 24, maxRank: 0.015, beat: 'adjacent' })), 'adjacent');
});

check('decideLane: no hits + adjacent beat is adjacent', () =>
  assert.equal(decideLane(sig({ hitCount: 0, beat: 'adjacent' })), 'adjacent'));

check('decideLane: no hits + unrelated beat on the opening turn is unrelated', () =>
  assert.equal(decideLane(sig({ hitCount: 0, beat: 'unrelated', followUp: false })), 'unrelated'));

check('decideLane: no hits + unrelated beat on a follow-up floors at adjacent', () =>
  assert.equal(decideLane(sig({ hitCount: 20, maxRank: 0.03, beat: 'unrelated', followUp: true })), 'thin'));
check('decideLane: an off-beat follow-up with only noise-level matches still declines', () => {
  assert.equal(decideLane(sig({ hitCount: 24, maxRank: 0.015, beat: 'unrelated', followUp: true })), 'unrelated');
  assert.equal(decideLane(sig({ hitCount: 65, maxRank: 0.025, beat: 'unrelated', followUp: true })), 'unrelated');
});
check('priorUserTurn: the previous user turn, or undefined on the first', () => {
  assert.equal(priorUserTurn([{ role: 'user', content: 'a' }]), undefined);
  assert.equal(priorUserTurn([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'x' }, { role: 'user', content: 'b' }]), 'a');
});

check('decideLane: no hits + atlas beat (classifier disagreeing with retrieval) is adjacent', () =>
  assert.equal(decideLane(sig({ hitCount: 0, beat: 'atlas' })), 'adjacent'));

check('decideLane: every lane has a label', () => {
  for (const lane of ['covered', 'thin', 'adjacent', 'unrelated']) {
    assert.equal(typeof LANE_LABEL[lane], 'string');
    assert.ok(LANE_LABEL[lane].length > 0);
  }
});

// ---- splitBeyond ----------------------------------------------------------------
check('splitBeyond: marker absent returns the whole text as atlas, beyond null', () => {
  const r = splitBeyond('Plain answer, no marker here.');
  assert.equal(r.atlas, 'Plain answer, no marker here.');
  assert.equal(r.beyond, null);
});

check('splitBeyond: marker present splits atlas from beyond', () => {
  const r = splitBeyond(`Atlas part.\n${BEYOND_MARKER}\nBeyond part.`);
  assert.equal(r.atlas, 'Atlas part.');
  assert.equal(r.beyond, 'Beyond part.');
});

check('splitBeyond: doubled marker strips both occurrences from the tail', () => {
  const r = splitBeyond(`Head.\n${BEYOND_MARKER}\nTail one.\n${BEYOND_MARKER}\nTail two.`);
  assert.equal(r.atlas, 'Head.');
  assert.ok(!r.beyond.includes(BEYOND_MARKER));
  assert.ok(r.beyond.includes('Tail one.'));
  assert.ok(r.beyond.includes('Tail two.'));
});

check('splitBeyond: empty tail after the marker returns beyond null, not an empty string', () => {
  const r = splitBeyond(`Head only.\n${BEYOND_MARKER}\n   `);
  assert.equal(r.atlas, 'Head only.');
  assert.equal(r.beyond, null);
});

// ---- composeDecline -------------------------------------------------------------
check('composeDecline: headline is fixed and dry', () =>
  assert.equal(composeDecline('cooking', [], []).headline, 'Not my beat.'));

check('composeDecline: topic is capitalized in the body, lowercase in the field', () => {
  const d = composeDecline('pasta recipes', [], []);
  assert.equal(d.topic, 'pasta recipes');
  assert.ok(d.body.includes('Pasta recipes'));
  assert.ok(!d.body.includes('pasta recipes is outside'));
});

check('composeDecline: strips trailing punctuation and handles an empty topic', () => {
  assert.equal(composeDecline('cricket scores!', [], []).topic, 'cricket scores');
  assert.equal(composeDecline('', [], []).topic, '');
  assert.ok(composeDecline('', [], []).body.includes('That is outside'));
});

check('composeDecline: caps questions at 7 and starters at 3', () => {
  const questions = Array.from({ length: 12 }, (_, i) => ({ title: `Q${i}`, href: `/q/${i}` }));
  const starters = Array.from({ length: 8 }, (_, i) => `Starter ${i}`);
  const d = composeDecline('topic', questions, starters);
  assert.equal(d.questions.length, 7);
  assert.equal(d.starters.length, 3);
});

// ---- encodeDecline / extractDecline round trip -----------------------------------
check('encodeDecline/extractDecline: round trips a decline payload', () => {
  const payload = composeDecline('sports trivia', [{ title: 'Q1', href: '/q/1' }], ['a', 'b', 'c']);
  const encoded = encodeDecline(payload);
  assert.ok(encoded.startsWith(DECLINE_MARKER));
  const { text, decline } = extractDecline(`some preamble${encoded}`);
  assert.equal(text, 'some preamble');
  assert.deepEqual(decline, payload);
});

check('extractDecline: no marker returns the text unchanged and a null decline', () => {
  const { text, decline } = extractDecline('just an ordinary answer');
  assert.equal(text, 'just an ordinary answer');
  assert.equal(decline, null);
});

check('extractDecline: a torn/invalid JSON tail fails closed to null, keeping the head text', () => {
  const { text, decline } = extractDecline(`head${DECLINE_MARKER}{not json`);
  assert.equal(text, 'head');
  assert.equal(decline, null);
});

// ---- laneAddendum ---------------------------------------------------------------
check('laneAddendum: covered lane adds nothing', () =>
  assert.equal(laneAddendum('covered', { web: false, fresh: false }), ''));

check('laneAddendum: thin/adjacent mention the @@BEYOND@@ marker', () => {
  assert.ok(laneAddendum('thin', { web: false, fresh: false }).includes(BEYOND_MARKER));
  assert.ok(laneAddendum('adjacent', { web: false, fresh: false }).includes(BEYOND_MARKER));
});

check('laneAddendum: web mode names the exact web first-line label', () => {
  const a = laneAddendum('thin', { web: true, fresh: false });
  assert.ok(a.includes('"From the web, not the Atlas records."'));
});

check('laneAddendum: model mode names the exact model-knowledge first-line label', () => {
  const a = laneAddendum('adjacent', { web: false, fresh: false });
  assert.ok(a.includes('"From the model\'s own knowledge, not the Atlas records, and not current."'));
});

check('laneAddendum: fresh without web calls out the staleness', () => {
  const a = laneAddendum('thin', { web: false, fresh: true });
  assert.ok(a.toLowerCase().includes('out of date'));
});

// ---- house style: no em dash in any exported prompt string -----------------------
check('no em dash in ASK_PERSONA, SCOPE_WITH_BEYOND, or any laneAddendum output', () => {
  const strings = [
    ASK_PERSONA,
    SCOPE_WITH_BEYOND,
    laneAddendum('thin', { web: false, fresh: false }),
    laneAddendum('thin', { web: true, fresh: true }),
    laneAddendum('adjacent', { web: false, fresh: true }),
    laneAddendum('adjacent', { web: true, fresh: false }),
    composeDecline('anything', [], []).body,
    composeDecline('anything', [], []).headline,
  ];
  for (const s of strings) assert.ok(!s.includes('—'), `em dash found in: ${s.slice(0, 60)}`);
});

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
