// Tests for the Atlas Agent's brain: transcript rendering + step parsing
// (lib/agent/chat-core.ts), memo scrubbing/validation (lib/agent/brief-core.ts),
// and the brief email render (lib/agent/email.ts). READ-ONLY, no DB needed:
// every module under test has no lib/db import anywhere in its dependency
// chain, so plain-Node type stripping loads them directly (the
// scripts/test-reports-cards.mjs discipline).
// Run: node scripts/test-agent-brain.mjs

import assert from 'node:assert/strict';
import { renderTranscript, parseStep, buildToolCatalog } from '../lib/agent/chat-core.ts';
import { scrubDashes, validateMemo } from '../lib/agent/brief-core.ts';
import { renderBriefHtml } from '../lib/agent/email.ts';

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

console.log('agent brain:');

// ---------------------------------------------------------------- renderTranscript

const baseTranscriptInput = {
  steering: 'Prefer the scan queue over editorial nudges.',
  findingsDigest: [{ key: 'drafts.backlog', severity: 'warn', title: 'Draft backlog is aging' }],
  priorMessages: [{ role: 'user', text: 'what is behind today' }],
  toolResultsByStep: [{ step: 1, results: ['engine_status: scan done, pipeline running'] }],
  toolCatalog: buildToolCatalog([{ name: 'engine_status', description: 'today\'s job status', args: '(none)' }]),
  stepsLeft: 2,
  question: 'is the pipeline behind schedule',
};

check('renderTranscript: includes the latest question', () => {
  const { user } = renderTranscript(baseTranscriptInput);
  assert.ok(user.includes('is the pipeline behind schedule'));
});

check('renderTranscript: includes the tool results', () => {
  const { user } = renderTranscript(baseTranscriptInput);
  assert.ok(user.includes('TOOL RESULTS (step 1)'));
  assert.ok(user.includes('engine_status: scan done, pipeline running'));
});

check('renderTranscript: system carries the steering note and the findings digest', () => {
  const { system } = renderTranscript(baseTranscriptInput);
  assert.ok(system.includes('Prefer the scan queue over editorial nudges.'));
  assert.ok(system.includes('drafts.backlog'));
});

check('renderTranscript: prior turns render as Kevin/Agent lines', () => {
  const { user } = renderTranscript(baseTranscriptInput);
  assert.ok(user.includes('Kevin: what is behind today'));
});

// ---------------------------------------------------------------- parseStep

check('parseStep: calls defaults to an empty array when missing', () => {
  const step = parseStep({ thought: 'thinking', answer: null });
  assert.deepEqual(step.calls, []);
});

check('parseStep: answer is null when missing or blank', () => {
  assert.equal(parseStep({ thought: 't', calls: [] }).answer, null);
  assert.equal(parseStep({ thought: 't', calls: [], answer: '   ' }).answer, null);
  assert.equal(parseStep({ thought: 't', calls: [], answer: 'here it is' }).answer, 'here it is');
});

check('parseStep: refuses more than 4 calls', () => {
  const raw = {
    thought: 't',
    calls: [1, 2, 3, 4, 5, 6].map((n) => ({ tool: `tool${n}`, args: {} })),
    answer: null,
  };
  const step = parseStep(raw);
  assert.equal(step.calls.length, 4);
  assert.deepEqual(step.calls.map((c) => c.tool), ['tool1', 'tool2', 'tool3', 'tool4']);
});

check('parseStep: tolerates a malformed calls entry', () => {
  const step = parseStep({ thought: 't', calls: [null, { tool: 'ok', args: { x: 1 } }, { args: {} }], answer: null });
  assert.deepEqual(step.calls, [{ tool: 'ok', args: { x: 1 } }]);
});

// ---------------------------------------------------------------- scrubDashes

check('scrubDashes: a spaced em dash collapses to a comma', () => {
  assert.equal(scrubDashes('the scan failed — check the notes'), 'the scan failed, check the notes');
});

check('scrubDashes: a bare em dash collapses too', () => {
  assert.equal(scrubDashes('a—b'), 'a, b');
});

// ---------------------------------------------------------------- validateMemo

const openKeys = ['drafts.backlog', 'engine.failed:scan'];

check('validateMemo: drops a proposal citing an unknown finding key', () => {
  const memo = {
    headline: 'The scan failed today',
    sections: [{ title: 'Scan', body: 'It failed.' }],
    proposals: [
      { findingKey: 'drafts.backlog', text: 'Archive 19 stale drafts' },
      { findingKey: 'not.a.real.finding', text: 'Should be dropped' },
    ],
    willDo: [],
  };
  const out = validateMemo(memo, openKeys);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].findingKey, 'drafts.backlog');
});

check('validateMemo: keeps a willDo entry with a known finding key', () => {
  const memo = {
    headline: 'ok',
    sections: [],
    proposals: [],
    willDo: [{ findingKey: 'engine.failed:scan', text: 'Resume the scan run' }],
  };
  const out = validateMemo(memo, openKeys);
  assert.equal(out.willDo.length, 1);
});

check('validateMemo: scrubs em dashes out of the headline', () => {
  const memo = { headline: 'scan failed — pipeline ok', sections: [], proposals: [], willDo: [] };
  const out = validateMemo(memo, openKeys);
  assert.ok(!out.headline.includes('—'));
  assert.equal(out.headline, 'scan failed, pipeline ok');
});

// ---------------------------------------------------------------- renderBriefHtml

const memo = {
  headline: 'The scan run failed overnight',
  sections: [{ title: 'Scan', body: 'The scan run failed at 09:00 UTC.' }],
  proposals: [{ findingKey: 'engine.failed:scan', text: 'Resume the scan run' }],
  willDo: [{ findingKey: 'drafts.backlog', text: 'Archive 19 stale drafts' }],
};
const findings = [
  {
    id: 'f1', key: 'engine.failed:scan', checkKey: 'engine.failed', subject: 'scan', severity: 'high',
    title: 'The scan engine failed today', detail: 'It failed.', metric: {}, href: '/scan', remedy: null,
    state: 'open', first_seen: '2026-09-20T09:00:00Z', last_seen: '2026-09-22T09:00:00Z',
    resolved_at: null, snoozed_until: null, seen_at: null, acked_at: null, last_action_at: null,
  },
];

check('renderBriefHtml: contains the headline', () => {
  const html = renderBriefHtml('2026-09-22', memo, findings);
  assert.ok(html.includes('The scan run failed overnight'));
});

check('renderBriefHtml: contains a finding title', () => {
  const html = renderBriefHtml('2026-09-22', memo, findings);
  assert.ok(html.includes('The scan engine failed today'));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
