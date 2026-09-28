// Tests for lib/field-report/core.ts, Field Report's pure core: plan
// validation, the report markdown parser and provenance labels, citation
// linking, the draft checks, estimates and caps. READ-ONLY, no DB.
// Run: node scripts/test-field-report.mjs

import assert from 'node:assert/strict';
import {
  validatePlan, fieldReportSteps, parseReportMarkdown, provenanceOf, provenanceShare,
  linkifyTags, draftIssues, estimateUsd, capRoom, PLAN_LIMITS, checkCompares, textBySource, researchDigest,
} from '../lib/field-report/core.ts';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ok  ${name}`); }
  catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
}

console.log('field report core:');

check('a plan needs an objective and two sub-questions; lists are cleaned and capped', () => {
  assert.equal(typeof validatePlan({ objective: '' , sub_questions: ['a', 'b'] }), 'string');
  assert.equal(typeof validatePlan({ objective: 'x', sub_questions: ['a'] }), 'string');
  const p = validatePlan({
    title: '', objective: 'Does agentic AI cut servicing cost — and by how much?',
    sub_questions: ['one', ' ', 'two', 'three', 'four', 'five', 'six', 'seven'],
    considerations: ['c'], atlas_focus: [], web_gaps: ['w'], out_of_scope: [], recommended_size: 'huge',
  });
  assert.equal(typeof p, 'object');
  assert.equal(p.sub_questions.length, PLAN_LIMITS.subMax);
  assert.ok(!p.objective.includes('—'));
  assert.equal(p.recommended_size, 'brief');
  assert.ok(p.title.startsWith('Does agentic AI'), 'an empty title falls back to the objective');
});

check('the step list grows for Full', () => {
  assert.deepEqual(fieldReportSteps('brief').map((s) => s.key), ['atlas', 'web', 'write', 'save']);
  assert.deepEqual(fieldReportSteps('full').map((s) => s.key), ['atlas', 'web', 'write', 'editor', 'revise', 'figures', 'save']);
});

check('provenance: Atlas tags, web ids, both, and nothing', () => {
  assert.equal(provenanceOf('Costs fell [signal S3].', false), 'atlas');
  assert.equal(provenanceOf('Costs fell [claim 3.1].', false), 'atlas');
  assert.equal(provenanceOf('A regulator said so [W2].', false), 'web');
  assert.equal(provenanceOf('Both [S3] and [W2].', false), 'mixed');
  assert.equal(provenanceOf('An unsourced sentence.', false), 'analysis');
  assert.equal(provenanceOf('Cited but fenced [S3].', true), 'analysis');
});

check('the markdown parser splits sections, blocks and analysis fences', () => {
  const md = [
    '# A title the writer added',
    '## Summary',
    '- First finding [S1].',
    '- Second finding (analysis)',
    '',
    '## How much does it cost?',
    'Servicing costs fell 20% [S1] while a bank reported more [W1].',
    '',
    ':::analysis',
    'Our reading is that the savings are front-loaded.',
    ':::',
    '',
    '### A subheading',
    'An unsourced paragraph that is long enough to be flagged by the checker because it goes on and on without any citation at all, which the reader could mistake for a sourced finding if nobody labeled it, and it keeps going past two hundred characters.',
    '## How much does it cost?',
    'Same title again [S2].',
  ].join('\n');
  const s = parseReportMarkdown(md);
  assert.deepEqual(s.map((x) => x.key), ['summary', 'how-much-does-it-cost', 'how-much-does-it-cost-x']);
  assert.deepEqual(s[0].blocks.map((b) => b.prov), ['atlas', 'analysis'], 'each bullet is its own block with its own label');
  const body = s[1].blocks;
  assert.equal(body[0].prov, 'mixed');
  assert.equal(body[1].prov, 'analysis');
  assert.equal(body[1].labeled, true);
  assert.equal(body[2].kind, 'h3');
  assert.equal(body[3].prov, 'analysis');
  assert.equal(body[3].labeled, false);
  const issues = draftIssues(s);
  assert.equal(issues.filter((i) => i.issue.startsWith('an unsourced paragraph')).length, 1);
  const share = provenanceShare(s);
  assert.equal(share.analysis, 3, 'the analysis bullet, the fenced paragraph and the unsourced one; the h3 is not counted');
});

check('tags become numbered links, one number per href, unknown tags dropped', () => {
  const maps = {
    tagHrefs: new Map([['S3', '/signals/abc'], ['H7', 'https://news.example/x']]),
    codeHrefs: new Map([['claim:3.1', '/claim/3.1']]),
    webHrefs: new Map([['W2', 'https://regulator.example/y']]),
  };
  const used = new Map();
  const out = linkifyTags('Costs fell [signal S3]. Rules changed [W2] and [claim 3.1]. Again [S3]. Ghost [S99].', maps, used);
  assert.ok(out.includes('[1](/signals/abc)'));
  assert.ok(out.includes('[2](https://regulator.example/y)'));
  assert.ok(out.includes('[3](/claim/3.1)'));
  assert.equal((out.match(/\[1\]\(/g) ?? []).length, 2, 'a repeated source keeps its number');
  assert.ok(!out.includes('S99'));
  const next = linkifyTags('Later [H7].', maps, used);
  assert.ok(next.includes('[4](https://news.example/x)'), 'numbering continues across calls');
});

check('draft checks catch em dashes and machinery words', () => {
  const s = parseReportMarkdown('## One\nThe argument map shows it — clearly [S1].\n\nThe memos found more [S2].');
  const issues = draftIssues(s).map((i) => i.issue);
  assert.ok(issues.some((i) => i.includes('em dash')));
  assert.ok(issues.some((i) => i.includes('machinery')));
});

check('estimates price each leg by its role and count web searches; caps floor at zero', () => {
  const rates = new Map([['m-cheap', { input: 1, output: 5 }], ['m-rich', { input: 4, output: 20 }]]);
  const brief = estimateUsd('brief', { research: 'm-cheap', writer: 'm-cheap', editor: 'm-cheap', figures: 'm-cheap' }, rates);
  const full = estimateUsd('full', { research: 'm-cheap', writer: 'm-rich', editor: 'm-cheap', figures: 'm-cheap' }, rates);
  assert.ok(brief > 0.2 && brief < 1, `brief ${brief}`);
  assert.ok(full > brief * 2, `full ${full}`);
  assert.equal(capRoom(6, 5), 0);
  assert.equal(capRoom(1.25, 5), 3.75);
});

check('a compare chart keeps only bars stated beside their own source, all from one source', () => {
  const plain = (h) => h.replace(/<a [^>]*>(\d+)<\/a>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sections = [{ key: 'k', title: 'T', blocks: [{ kind: 'p', prov: 'web',
    html: '<p>Kimi K3 scored 33.4% <a href="https://a.example/x">1</a>. GLM scored 47.2 on the same test <a href="https://b.example/y">2</a>. Claude scored 1,250 points <a href="https://a.example/x">1</a>.</p>' }] }];
  const text = textBySource(sections, plain);
  const fig = (bars) => ({ id: 'fig-1', kind: 'compare', section: 'k', after: 0, title: 't', caption: 'c', unit: '%', bars });
  const A = 'https://a.example/x';
  const B = 'https://b.example/y';
  const mixed = checkCompares([fig([{ label: 'Kimi', value: 33.4, href: A }, { label: 'GLM', value: 47.2, href: B }])], text);
  assert.equal(mixed.figures.length, 0, 'bars from two sources are dropped');
  const pinned = checkCompares([fig([{ label: 'Kimi', value: 33.4, href: A }, { label: 'GLM', value: 47.2, href: A }])], text);
  assert.equal(pinned.figures.length, 0, 'a number pinned on a source that never states it is dropped');
  assert.ok(pinned.dropped[0].includes('GLM'));
  const good = checkCompares([fig([{ label: 'Kimi', value: 33.4, href: A }, { label: 'Claude', value: 1250, href: A }])], text);
  assert.equal(good.figures.length, 1, 'thousands separators and decimals both match');
  const partial = checkCompares([fig([{ label: 'Kimi', value: 33, href: A }, { label: 'Claude', value: 1250, href: A }])], text);
  assert.equal(partial.figures.length, 0, '33 is not 33.4');
  const one = textBySource([{ key: 'k', title: 'T', blocks: [{ kind: 'p', prov: 'web',
    html: '<p>Frontier at 25.5% <a href="https://a.example/x">1</a>, Kimi at 33.4% <a href="https://c.example/z">3</a>, and GLM at 47.2 <a href="https://b.example/y">2</a>.</p>' }] }], plain);
  const allOnA = checkCompares([fig([{ label: 'F', value: 25.5, href: A }, { label: 'GLM', value: 47.2, href: A }])], one);
  assert.equal(allOnA.figures.length, 0, 'one sentence citing three sources still splits by footnote');
});

check('Appendix A digests the log per sub-question, in plan order, the web last', () => {
  const log = [
    { track: 'web', tool: 'web_search', query: 'q web', results: 0, round: 1 },
    { track: 'T2', tool: 'search_atlas', query: 'b one', results: 5, round: 1 },
    { track: 'T1', tool: 'search_atlas', query: 'a one', results: 5, round: 1 },
    { track: 'T1', tool: 'search_atlas', query: 'A One', results: 5, round: 2 },
    { track: 'T1', tool: 'fetch_record', query: '[signal S1]', results: 1, round: 2 },
  ];
  const d = researchDigest(log, ['First?', 'Second?']);
  assert.deepEqual(d.map((x) => x.label), ['First?', 'Second?', 'The web, for what the Atlas did not hold']);
  assert.equal(d[0].searches, 2);
  assert.equal(d[0].reads, 1);
  assert.deepEqual(d[0].queries, ['a one'], 'queries dedupe case-insensitively');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
