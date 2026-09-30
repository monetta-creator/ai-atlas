// Tests for lib/context-pack/core.ts (the company context pack's pure half).
// No DB, no model. Run: node scripts/test-context-pack.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIER_BUDGET, CORPUS_ROW_TOKENS, BRIEF_LABEL, BRIEF_MAX_WORDS, estimateTokens, fmtValue, clip,
  buildBlocks, fitTier, renderTier, buildSections, buildChecks, gateBrief, briefSource, briefAddsContent,
} from '../lib/context-pack/core.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const NAME = 'Example Bancorp';
const rec = (source, i, over = {}) => ({
  source, title: `${source} document ${i} about lending platforms`, url: `https://records.example/${source}/${i}`,
  date: `20${22 + (i % 5)}-0${1 + (i % 9)}-15`, summary: `Summary of ${source} ${i}: the company described its machine learning program in some detail.`,
  aiRelated: i % 2 === 0, aiPassages: i % 4 === 0 ? [`Passage ${i}: we use machine learning models across underwriting.`] : [], ...over,
});
function makeInput(scale = 1, over = {}) {
  const n = (k) => Math.round(k * scale);
  return {
    asOf: '2026-09-29',
    company: { slug: 'example-bank', name: NAME, tier: 'consumer_bank', publicBlurb: null, deepRecord: scale >= 1, ids: { cik: '12345', fdic_cert: '999', rssd_id: '111', cfpb_name: 'EXAMPLE' } },
    profile: Array.from({ length: n(15) }, (_, i) => ({ text: `Profile sentence ${i} states a public fact about the technology strategy of the company.`, urls: [`https://records.example/sec_filing/${i}`] })),
    timeline: Array.from({ length: n(84) }, (_, i) => ({ date: `20${22 + (i % 5)}-0${1 + (i % 9)}-1${i % 9}`, category: i % 2 ? 'launch' : 'statement', headline: `Timeline event ${i} headline`, body: `Body of event ${i} with a couple of sentences of detail. It explains what happened and why it matters.`, urls: [`https://records.example/news/${i}`] })),
    records: [
      ...Array.from({ length: n(180) }, (_, i) => rec('sec_filing', i)),
      ...Array.from({ length: n(320) }, (_, i) => rec('paper', i)),
      ...Array.from({ length: n(1000) }, (_, i) => rec('patent', i, { aiRelated: true, aiPassages: [`patent document ${i} about lending platforms`] })),
      ...Array.from({ length: n(400) }, (_, i) => rec('news', i)),
      ...Array.from({ length: n(6) }, (_, i) => rec('comment_letter', i)),
    ],
    facts: Array.from({ length: n(125) }, (_, i) => ({ dimension: ['tech_ai', 'products', 'strategy'][i % 3], fact: `Fact ${i}: the company reported a development in its platform.`, valueText: i % 5 === 0 ? `${i} million` : null, asOf: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, url: `https://news.example/f/${i}` })),
    items: Array.from({ length: n(127) }, (_, i) => ({ headline: `Tracked story ${i}`, url: `https://news.example/i/${i}`, domain: 'news.example', date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, summary: `Summary of story ${i}. `.repeat(8).trim(), significance: i % 7 === 0 ? null : (i % 10) / 10 })),
    metrics: [
      { code: 'fdic_eeffr', points: Array.from({ length: 40 }, (_, i) => ({ period: `20${26 - Math.floor(i / 4)}-0${[6, 3][i % 2]}-30`, value: 54.2 + i / 10 })) },
      { code: 'fdic_asset', points: [{ period: '2026-06-30', value: 480_000_000 }, { period: '2026-03-31', value: 470_000_000 }] },
      { code: 'total_assets', points: [{ period: '2026-06-30', value: 490_000_000_000 }] },
      { code: 'cfpb_complaints_month', points: [{ period: '2026-08-01', value: 1234 }] },
    ],
    peerCodes: ['fdic_eeffr', 'total_assets'],
    peers: [
      { name: NAME, tier: 'consumer_bank', isSubject: true, cells: [{ code: 'fdic_eeffr', value: 54.2, period: '2026-06-30' }, { code: 'total_assets', value: 4.9e11, period: '2026-06-30' }], urls: ['https://banks.example/self'] },
      { name: 'Other | Bank', tier: 'consumer_bank', isSubject: false, cells: [{ code: 'fdic_eeffr', value: 60.1, period: '2026-06-30' }, { code: 'total_assets', value: 2e11, period: '2026-06-30' }], urls: ['https://banks.example/other'] },
      { name: 'Thin Co', tier: 'fintech', isSubject: false, cells: [{ code: 'fdic_eeffr', value: null, period: null }, { code: 'total_assets', value: 1e9, period: '2025-12-31' }], urls: [] },
    ],
    briefs: [],
    ...over,
  };
}

check('estimateTokens is a ceiling on characters / 4', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 130);
  assert.ok(estimateTokens('x') >= 1);
});

check('fmtValue formats by the metric definition unit: thousands become dollars', () => {
  assert.equal(fmtValue(480_000_000, 'usd_thousands'), '$480.00B');
  assert.equal(fmtValue(490_000_000_000, 'usd'), '$490.00B');
  assert.equal(fmtValue(54.2, 'percent'), '54.20%');
  assert.equal(fmtValue(1234, 'count'), '1,234');
  assert.equal(fmtValue(2.5, 'per_share'), '$2.50');
});

check('both tiers stay inside their budget on a full-size record', () => {
  const input = makeInput();
  for (const size of ['base', 'brief']) {
    const doc = renderTier(input, size);
    assert.ok(doc.tokens <= TIER_BUDGET[size], `${size}: ${doc.tokens} > ${TIER_BUDGET[size]}`);
    assert.ok(doc.tokens > TIER_BUDGET[size] * 0.8, `${size} leaves the budget unused: ${doc.tokens}`);
    assert.equal(estimateTokens(doc.markdown) <= TIER_BUDGET[size] + 5, true);
  }
});

check('every [n] in a tier resolves to a Sources line, and every Sources line is used', () => {
  for (const size of ['base', 'brief']) {
    const md = renderTier(makeInput(), size).markdown;
    const [body, sources] = md.split('\n## Sources\n');
    const listed = new Set([...sources.matchAll(/^\[(\d+)\] /gm)].map((m) => m[1]));
    const used = new Set([...body.matchAll(/\[(\d+)\]/g)].map((m) => m[1]));
    for (const n of used) assert.ok(listed.has(n), `${size}: [${n}] has no source`);
    for (const n of listed) assert.ok(used.has(n), `${size}: source ${n} is never cited`);
  }
});

check('rendering is deterministic', () => {
  assert.equal(renderTier(makeInput(), 'brief').markdown, renderTier(makeInput(), 'brief').markdown);
  assert.deepEqual(buildSections(makeInput(0.2)), buildSections(makeInput(0.2)));
});

check('the company name comes from the input and no em dash is generated', () => {
  const input = makeInput(0.3);
  input.company.name = 'Zebra Holdings';
  input.peers[0].name = 'Zebra Holdings';
  const md = renderTier(input, 'base').markdown;
  assert.ok(md.startsWith('# Zebra Holdings: company context, base pack'));
  assert.ok(!md.includes(NAME));
  assert.ok(!md.includes('—'));
  for (const s of buildSections(input)) assert.ok(!s.markdown.includes('—'));
});

check('a light company (no profile, no timeline, no documents) still renders and says so', () => {
  const input = makeInput(1, { profile: [], timeline: [], records: [] });
  input.company.deepRecord = false;
  const base = renderTier(input, 'base');
  assert.ok(base.markdown.includes('no backfilled public record'));
  assert.ok(!base.markdown.includes('## Profile'));
  assert.ok(base.markdown.includes('## Extracted facts'));
  assert.ok(base.markdown.includes('light record'));
});

check('an empty company renders the guide only and never throws', () => {
  const input = makeInput(0, { metrics: [], peers: [], facts: [], items: [] });
  const doc = renderTier(input, 'base');
  assert.ok(doc.markdown.includes('## How to read this file'));
  assert.equal(buildSections(input).filter((s) => s.kind !== 'guide').length, 0);
});

check('peer table: subject first and bold, pipes escaped, thin rows dropped, sources column cited', () => {
  const md = renderTier(makeInput(0.1), 'base').markdown;
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && l.includes('Consumer bank'));
  assert.ok(rows[0].startsWith(`| **${NAME}**`));
  assert.ok(rows[1].includes('Other / Bank'));
  assert.ok(!md.includes('Thin Co'));
  assert.match(rows[0], /\[\d+\] \|$/);
  assert.ok(rows[0].includes('54.20% (2026-06)'));
});

check('sections: unique stable ids, rows near the corpus size, positions in order', () => {
  const sections = buildSections(makeInput());
  const ids = sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9_-]+$/);
  assert.ok(ids.includes('profile') && ids.includes('metrics-efficiency') && ids.some((i) => i.startsWith('record-patent-2026')));
  assert.ok(ids.some((i) => /^timeline-20\d\d/.test(i)));
  for (const s of sections) assert.ok(s.tokens <= CORPUS_ROW_TOKENS * 1.6, `${s.id}: ${s.tokens}`);
  assert.deepEqual(sections.map((s) => s.position), sections.map((_, i) => i + 1));
  assert.ok(sections.every((s) => s.markdown.startsWith(`## ${NAME}: `) || s.kind === 'check'));
});

check('sections: every record reaches the corpus, and tier flags follow the tier contents', () => {
  const input = makeInput();
  const sections = buildSections(input);
  const all = sections.map((s) => s.markdown).join('\n');
  for (const r of input.records) assert.ok(all.includes(r.url), r.url);
  const profile = sections.find((s) => s.id === 'profile');
  assert.ok(profile.inBase && profile.inBrief);
  const patents = sections.filter((s) => s.id.startsWith('record-patent'));
  assert.ok(patents.every((s) => !s.inBase));
  assert.ok(patents.some((s) => s.inBrief));
});

check('patent passages that repeat the title are not rendered as quotes', () => {
  const s = buildSections(makeInput(0.05)).filter((x) => x.id.startsWith('record-patent'));
  assert.ok(s.length > 0);
  assert.ok(s.every((x) => !x.markdown.includes('\n  > ')));
});

check('check questions: deterministic, answered from rows, never inside a prompt file', () => {
  const input = makeInput();
  const checks = buildChecks(input);
  assert.ok(checks.length >= 8 && checks.length <= 12, String(checks.length));
  assert.ok(checks.some((c) => c.answer === '54.20%'));
  assert.deepEqual(checks, buildChecks(makeInput()));
  const md = renderTier(input, 'brief').markdown;
  assert.ok(!md.includes('Check question'));
  assert.ok(buildSections(input).filter((s) => s.kind === 'check').every((s) => !s.inBase && !s.inBrief));
});

check('briefs: rendered under the label in tiers, shipped as model rows in the corpus', () => {
  const input = makeInput(0.3, { briefs: [{ sectionId: 'timeline', body: 'The company [launched a platform](https://records.example/news/1) this year.', citeUrls: ['https://records.example/news/1'], model: 'm', weekEnd: '2026-10-02' }] });
  const md = renderTier(input, 'base').markdown;
  assert.ok(md.includes(`> ${BRIEF_LABEL}`));
  assert.match(md, /> The company launched a platform \[\d+\] this year\./);
  const row = buildSections(input).find((s) => s.id === 'brief-timeline');
  assert.equal(row.provenance, 'model');
  assert.ok(buildSections(input).filter((s) => s.id !== 'brief-timeline').every((s) => s.provenance === 'record'));
});

check('gateBrief: foreign links are unwrapped, unknown figures drop their sentence, no link means no brief', () => {
  const source = 'The ratio was 54.20% in 2026. Assets were $480.00B. <https://a.example/1>';
  const g = gateBrief(
    'The ratio reached [54.20%](https://a.example/1) in 2026. Assets grew 17% to a record. See [this](https://evil.example/x) too. It named three priorities.',
    ['https://a.example/1'], source);
  assert.ok(g.body.includes('[54.20%](https://a.example/1)'));
  assert.ok(!g.body.includes('17%'));
  assert.ok(!g.body.includes('evil.example'));
  assert.ok(g.body.includes('three priorities'));
  assert.deepEqual(g.citeUrls, ['https://a.example/1']);
  assert.equal(g.dropped.length, 2);
  assert.equal(gateBrief('Nothing linked here.', ['https://a.example/1'], source), null);
  assert.equal(gateBrief('Only [a bad link](https://evil.example/x).', ['https://a.example/1'], source), null);
});

check('gateBrief: em dashes removed and the word cap lands on a sentence boundary', () => {
  const long = `Lead [one](https://a.example/1) — stated. ${'Filler words go here again. '.repeat(60)}`;
  const g = gateBrief(long, ['https://a.example/1'], '');
  assert.ok(!g.body.includes('—'));
  assert.ok(g.body.split(/\s+/).length <= BRIEF_MAX_WORDS);
  assert.ok(g.body.endsWith('.'));
});

check('briefSource: the section at brief depth with its URLs, bounded', () => {
  const src = briefSource(makeInput(), 'timeline', 1500);
  assert.ok(src.urls.length > 0 && src.text.includes('<https://records.example/news/'));
  assert.ok(estimateTokens(src.text) <= 1500);
  assert.equal(briefSource(makeInput(), 'nope'), null);
});

check('briefAddsContent: a light pack whose brief adds nothing is reported', () => {
  const tiny = makeInput(0, { facts: makeInput(0.05).facts, metrics: [], peers: [], items: [] });
  assert.equal(briefAddsContent(renderTier(tiny, 'base'), renderTier(tiny, 'brief')), false);
  const full = makeInput();
  assert.equal(briefAddsContent(renderTier(full, 'base'), renderTier(full, 'brief')), true);
});

check('the input type has no notes and no dossier field, and the file never reads one', () => {
  const src = readFileSync(new URL('../lib/context-pack/core.ts', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\bdossier\b/.test(code));
  assert.ok(!/\bnotes\b/.test(code));
  assert.ok(buildBlocks(makeInput(0.1)).length > 3);
  assert.ok(fitTier(makeInput(0.1), 'base').length > 3);
  assert.ok(clip('a'.repeat(50), 10).endsWith('...'));
});

check('briefs are never written for the sections that are tables of figures', async () => {
  const { BRIEFABLE } = await import('../lib/context-pack/core.ts');
  assert.ok(!BRIEFABLE.includes('metrics') && !BRIEFABLE.includes('peers'));
  assert.ok(BRIEFABLE.includes('timeline'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
