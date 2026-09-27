// Pure checks for the report section chunker and the guest name scrub
// (lib/embed/report-sections.ts). Run: node scripts/test-report-sections.mjs
import assert from 'node:assert/strict';
import {
  reportSections, reportPrefix, reportSectionHref, splitReportRecordId, buildNameMatcher, scrubSentences,
} from '../lib/embed/report-sections.ts';

let pass = 0; let fail = 0;
function check(name, fn) { try { fn(); pass += 1; console.log(`  ok  ${name}`); } catch (e) { fail += 1; console.error(`FAIL  ${name}\n      ${e.message}`); } }

const LONG = 'A sentence long enough to count as a real passage for retrieval purposes.';
const ID = '3e94d601-897c-43d2-a55a-cde208349052';

check('an edition cuts into its front stories and its column', () => {
  const s = reportSections({ id: ID, kind: 'edition', scope_to: '2026-09-25', title: 't', narrative: {
    front: [{ headline: 'Big news', why: LONG, numbers: null }, { headline: 'x', why: 'short' }],
    column: { title: 'The column', html: `<p>${LONG} <a href="/x">link</a></p>` },
  } });
  assert.deepEqual(s.map((x) => x.key), ['front-0', 'column']);
  assert.ok(!s[1].text.includes('<'), 'html stripped');
});

check('Savant cuts into summary, lead, hypotheses and departments; peers is portal-only; empty and editor stay out', () => {
  const s = reportSections({ id: ID, kind: 'savant', scope_to: '2026-09-25', title: 't', narrative: {
    summary: [`<p>${LONG}</p>`, `<p>${LONG}</p>`],
    lead: { title: 'Lead', html: `<p>${LONG}</p>` },
    hypotheses: { fresh: { statement: LONG, html: '' }, readings: [{ statement: 'H1', direction: 'strengthened', html: `<p>${LONG}</p>` }] },
    departments: [
      { key: 'moved', title: 'What moved', html: `<p>${LONG}</p>`, empty: false },
      { key: 'peers', title: 'Peers', html: `<p>${LONG}</p>`, empty: false },
      { key: 'ahead', title: 'Ahead', html: '<p>Nothing this week.</p>', empty: true },
    ],
    editor: { note: LONG },
  } });
  assert.deepEqual(s.map((x) => x.key), ['summary', 'lead', 'hypotheses', 'moved', 'peers']);
  assert.equal(s.find((x) => x.key === 'peers').portalOnly, true);
  assert.equal(s.find((x) => x.key === 'moved').portalOnly, false);
  assert.ok(s.find((x) => x.key === 'hypotheses').text.includes('(strengthened)'));
});

check('a roundup cuts into its four sheet sections', () => {
  const s = reportSections({ id: ID, kind: 'roundup', scope_to: '2026-09-19', title: 't', narrative: { reading: LONG, connections: null, watch: LONG, bottomLine: LONG } });
  assert.deepEqual(s.map((x) => x.key), ['reading', 'watch', 'bottomLine']);
});

check('prefix, href and record ids', () => {
  assert.equal(reportPrefix('savant', '2026-09-25', 'Lead analysis'), 'Savant, week ending 2026-09-25, Lead analysis');
  assert.equal(reportPrefix('edition', '2026-09-24', 'The column'), 'Daily edition, 2026-09-24, The column');
  assert.equal(reportSectionHref('edition', ID, '2026-09-24', 'front-0'), '/blotter/2026-09-24#front-0');
  assert.equal(reportSectionHref('savant', ID, '2026-09-25', 'lead'), '/savant/2026-09-25#lead');
  assert.equal(reportSectionHref('roundup', ID, '2026-09-19', 'watch'), `/reports/sheet/${ID}#watch`);
  assert.deepEqual(splitReportRecordId(`${ID}:front-0`), { id: ID, key: 'front-0' });
  assert.equal(splitReportRecordId('nope:front'), null);
});

check('the guest scrub drops exactly the sentences naming a registry company', () => {
  const re = buildNameMatcher(['Harbor Trust', 'Harbor Trust Financial', 'JPMorgan Chase', 'Ab']);
  const { text, removed } = scrubSentences('Banks are adopting agents. Harbor Trust Financial said more. JPMorgan  Chase hired. Harboring doubts is fine.', re);
  assert.equal(removed, 2);
  assert.equal(text, 'Banks are adopting agents. Harboring doubts is fine.');
  assert.equal(buildNameMatcher([]), null);
  assert.equal(scrubSentences('Anything.', null).removed, 0);
  const special = buildNameMatcher(['U.S. Bank']);
  assert.equal(scrubSentences('U.S. Bank grew. Others did not.', special).removed, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
