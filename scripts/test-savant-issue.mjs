// Pure tests for Savant's issue-side helpers (2026-09-26): the citation
// allow-list over a fixture pack, the deterministic editorial checks, the
// TOC and strapline constants. READ-ONLY, no DB, no model call.
// Run: node scripts/test-savant-issue.mjs

import assert from 'node:assert/strict';
import { allowlistForSavant } from '../lib/savant/allowlist.ts';
import { deterministicChecks, stripTags, revisionKeepsFigures, numbersIn } from '../lib/savant/editor-core.ts';
import { SAVANT_TOC, SAVANT_STRAPLINE } from '../lib/savant/types.ts';
import { estimateSavantWeek, SAVANT_MODEL_OPTIONS, isAnthropicId, LEAD_FALLBACK_MODEL } from '../lib/savant/cost-model.ts';
import { SCAN_ENRICH_MODELS } from '../lib/scan/models.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const brief = (title, url, href = null) => ({ title, url, href, domain: url ? new URL(url).hostname : null, date: '2026-09-25', kind: 'scan_item' });

function fixturePack() {
  return {
    weekEnd: '2026-09-25', windowFrom: '2026-09-18T16:45:00.000Z', windowTo: '2026-09-25T16:45:00.000Z', issueNumber: 1,
    self: { slug: 'own', name: 'Own Company', public_blurb: 'A large regulated financial-services company.' },
    plan: null,
    hypotheses: { fresh: { id: 'h1', statement: 'x', question_slug: 'labor', posed_week: '2026-09-25', status: 'open', verdict: null, what_would_settle: [], watch: [], updates: [{ week: '2026-09-25', direction: 'unchanged', note: 'n', hrefs: ['/signals/hyp-1'] }] }, open: [] },
    notebook: {
      notes: [], echoes: [], anomalies: [], misses: [{ kind: 'coverage', headline: 'Missed thing', url: 'https://miss.example.com/a?utm_source=x', detail: 'd' }],
      connections: [{ record: { kind: 'paper', id: 'p1', title: 'A paper', url: 'https://arxiv.org/abs/1', href: '/research/p1' }, target: { kind: 'claim', code: '7.1', statement: 'Entry-level hiring is contracting', href: '/claim/7.1' }, sim: 0.6 }],
    },
    moved: { evidenceByDirection: { supports: 1, contradicts: 0, neutral: 0 }, evidenceByLens: {}, signalsByLens: {}, topClaims: [{ code: 'B5', statement: 'Capex outpaces cash flow', href: '/bridge/B5', evidence: 3, supports: 2, contradicts: 1 }], signals: [{ ...brief('Sig', 'https://news.example.com/s', '/signals/s1'), kind: 'signal' }] },
    peers: { self: { slug: 'own', name: 'Own Company', tier: 'self', isSelf: true, metrics: [{ code: 'fdic_eeffr', label: 'Efficiency ratio', latest: 55, period: '2026-06-30', prev: 54, delta: 1, pct: 0.018, unit: 'percent', source: 'fdic', sourceUrl: 'https://banks.data.fdic.gov/bankfind-suite/bankfind?cert=1', goodWhen: 'down' }], aiItems: 2, aiItemsTrailing: 1, facts: 3, filings: [brief('10-Q', 'https://www.sec.gov/f/1')], cfpb: { latest: 10, prev: 12, period: '2026-08-01', sourceUrl: 'https://www.consumerfinance.gov/x' }, hiring: { aiMl: 3, agents: 1, total: 100, asOf: '2026-09-21' } }, tiers: [], codes: [] },
    regulation: [brief('Reg item', 'https://reg.example.com/r')],
    research: [{ id: 'p1', title: 'A paper', href: '/research/p1', whoCares: null, headlineClaim: null }],
    researchKept: 1,
    tools: { entrants: [{ slug: 'tool-a', name: 'Tool A', vendor: null, oneLiner: null, href: '/tooling/tool-a' }], releases: [{ productName: 'P', productHref: '/tooling/p', title: 'v2', url: 'https://p.example.com/changelog', kind: 'changelog', date: '2026-09-24' }], reads: [{ title: 'Read', url: 'https://read.example.com/x', hnUrl: 'https://news.ycombinator.com/item?id=1', points: 1, comments: 1, tag: 'tooling', line: null, showHn: false, repo: false, debate: false, catalogHref: '/tooling/p' }] },
    ahead: [{ date: '2026-10-10', what: 'deadline', url: 'https://ahead.example.com/d', href: null, trigger: 'deadline' }],
    numbers: { itemsRead: 1, outlets: 1, signals: 1, papers: 1, evidence: 1, connections: 1, anomalies: 0, companies: 1 },
    sources: [], mapHrefs: [{ href: '/claim/3.6', code: '3.6', statement: 'Training data is a cost' }],
    generatedAt: '2026-09-25T20:00:00.000Z',
  };
}

check('allowlist covers every href and url the pack carries, plus query-stripped twins and the whole map', () => {
  const a = allowlistForSavant(fixturePack());
  for (const h of ['/research/p1', '/claim/7.1', 'https://arxiv.org/abs/1', 'https://miss.example.com/a?utm_source=x', 'https://miss.example.com/a', '/signals/s1', '/bridge/B5',
    'https://banks.data.fdic.gov/bankfind-suite/bankfind?cert=1', 'https://banks.data.fdic.gov/bankfind-suite/bankfind', 'https://www.sec.gov/f/1', 'https://www.consumerfinance.gov/x',
    'https://reg.example.com/r', '/tooling/tool-a', 'https://p.example.com/changelog', '/tooling/p', 'https://read.example.com/x', 'https://news.ycombinator.com/item?id=1',
    'https://ahead.example.com/d', '/signals/hyp-1', '/claim/3.6', '/q/labor']) assert.ok(a.hrefs.has(h), h);
  assert.ok(!a.hrefs.has('https://evil.example.com/x'));
  assert.equal(a.tagByHref.get('/claim/7.1'), '7.1');
  assert.equal(a.tagByHref.get('/claim/3.6'), '3.6');
});

const draft = (over = {}) => ({
  title: 'T',
  summary: ['<p>One <a href="/signals/s1">link</a>.</p>', '<p>Two <a href="/claim/7.1">l</a>.</p>', '<p>Three <a href="/x">l</a>.</p>', '<p>Four <a href="/x">l</a>.</p>', '<p>Five <a href="/x">l</a>.</p>'],
  leadHtml: `<p>${'word '.repeat(1600)}</p><p><strong>What we will watch.</strong> The record.</p>`,
  leadMarkdown: 'md',
  freshHtml: '<p>fresh</p>',
  readings: [],
  departments: [{ key: 'moved', title: 'What moved', html: '<p>Fine <a href="/claim/7.1">position</a>.</p>', empty: false }],
  ...over,
});

check('deterministicChecks: a clean draft fires nothing', () => {
  assert.deepEqual(deterministicChecks(draft(), { slug: 'own', name: 'Own Company', public_blurb: null }), []);
});

check('deterministicChecks: machinery words, bare codes, em dashes, unlinked self sentences, missing links and length', () => {
  const bad = draft({
    summary: ['<p>No link here.</p>'],
    leadHtml: '<p>Short lead — with an em dash and this claim about 7.2 and Own Company doing things.</p>',
    departments: [{ key: 'moved', title: 'x', html: '<p>The argument map says B5 moved.</p>', empty: false }],
  });
  const out = deterministicChecks(bad, { slug: 'own', name: 'Own Company', public_blurb: null });
  const joined = out.join(' | ');
  for (const needle of ['em dash', 'machinery word', 'bare position code', 'names Own Company with no linked record', 'under the 1,500 floor', 'bullets, wants 5', 'bullet 1 has no link', 'What we will watch']) assert.ok(joined.includes(needle), needle + ' :: ' + joined);
});

check('revisionKeepsFigures: a revision may drop or keep figures, never add one', () => {
  assert.ok(revisionKeepsFigures('8 items against 1.5 per week, $2.1B', 'eight items? no: 8 items, 1.5 per week'));
  assert.ok(!revisionKeepsFigures('8 items against 1.5 per week', '0 items against 1.5 per week'));
  assert.ok(revisionKeepsFigures('no numbers', 'still none'));
  assert.deepEqual([...numbersIn('$2,100 and 40% of 1.5')], ['2100', '40', '1.5']);
});

check('deterministicChecks: the peer watch may name the reader organization without a link', () => {
  const d = draft({ departments: [{ key: 'peers', title: 'Peers', html: '<p>Own Company logged 8 items this week.</p>', empty: false }] });
  assert.ok(!deterministicChecks(d, { slug: 'own', name: 'Own Company', public_blurb: null }).join(' ').includes('names Own Company'));
});

check('stripTags removes links and tags but keeps text', () => {
  assert.equal(stripTags('<p>Hello <a href="/x">there</a> <strong>you</strong></p>'), 'Hello there you');
});

check('the TOC has the fixed departments in order and the strapline names the producer', () => {
  assert.equal(SAVANT_TOC[0].key, 'summary');
  assert.equal(SAVANT_TOC[SAVANT_TOC.length - 1].key, 'editor');
  assert.equal(SAVANT_TOC.length, 13);
  assert.ok(SAVANT_STRAPLINE.endsWith('Produced by The AI Atlas.'));
  assert.ok(!SAVANT_STRAPLINE.includes('—'));
});

const RATES = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'z-ai/glm-5.3-flash': { input: 0.075, output: 0.25, cacheRead: 0 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

check('the cost model prices a Sonnet week near the measured issue and a GLM writer hands only the lead to the fallback', () => {
  const sonnet = estimateSavantWeek({ writer: 'claude-sonnet-4-6', editor: 'claude-sonnet-4-6', notebook: 'z-ai/glm-5.3-flash' }, RATES);
  assert.ok(sonnet.total > 0.35 && sonnet.total < 0.6, `sonnet week ${sonnet.total}`);
  assert.equal(sonnet.missingRates.length, 0);
  const glm = estimateSavantWeek({ writer: 'z-ai/glm-5.3-flash', editor: 'claude-haiku-4-5', notebook: 'z-ai/glm-5.3-flash' }, RATES);
  const lead = glm.legs.find((l) => l.leg.startsWith('Lead'));
  assert.equal(lead.model, LEAD_FALLBACK_MODEL);
  assert.equal(lead.fallback, true);
  assert.equal(glm.legs.filter((l) => l.fallback).length, 1);
  assert.ok(glm.total < sonnet.total);
  const unknown = estimateSavantWeek({ writer: 'claude-sonnet-4-6', editor: 'vendor/unpriced', notebook: 'z-ai/glm-5.3-flash' }, RATES);
  assert.deepEqual(unknown.missingRates, ['vendor/unpriced']);
  assert.ok(SAVANT_MODEL_OPTIONS.some((m) => m.id === 'claude-sonnet-4-6' && m.anthropic));
  assert.equal(isAnthropicId('z-ai/glm-5.3-flash'), false);
  // Sonnet 5 is cheaper per token than 4.6 but tokenizes ~30% longer: the week still lands under 4.6's.
  const s5 = estimateSavantWeek({ writer: 'claude-sonnet-5', editor: 'claude-sonnet-5', notebook: 'z-ai/glm-5.3-flash' }, RATES);
  assert.ok(s5.total < sonnet.total && s5.total > sonnet.total * 0.7, `sonnet 5 week ${s5.total} vs ${sonnet.total}`);
  const opus = estimateSavantWeek({ writer: 'claude-opus-5-5', editor: 'claude-opus-5-5', notebook: 'z-ai/glm-5.3-flash' }, RATES);
  assert.ok(opus.total > sonnet.total, `opus week ${opus.total}`);
  // The OpenRouter picks mirror the scan registry, whose rate cards test-scan.mjs checks live.
  const scanIds = new Set(SCAN_ENRICH_MODELS.filter((m) => !m.anthropic).map((m) => m.id));
  const flash = SAVANT_MODEL_OPTIONS.filter((m) => m.tier === 'flash');
  for (const m of flash) assert.ok(scanIds.has(m.id), `${m.id} is not in SCAN_ENRICH_MODELS`);
  assert.equal(flash.length, scanIds.size);
  assert.ok(SAVANT_MODEL_OPTIONS.filter((m) => m.tier === 'reasoning').length >= 5);
  assert.equal(new Set(SAVANT_MODEL_OPTIONS.map((m) => m.id)).size, SAVANT_MODEL_OPTIONS.length, 'ids are unique');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
