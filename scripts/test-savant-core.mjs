// Pure tests for Savant's plain-Node modules: week arithmetic, connection
// shaping, anomaly detection, calendar extraction, and plan selection.
// Run: node scripts/test-savant-core.mjs
import assert from 'node:assert/strict';
import { weekEndFor, issueWindow, weekdaysOf, previousWeekEnd, isMonday } from '../lib/savant/week.ts';
import { shapeConnections, shapeEchoes, connectionKey, echoKey } from '../lib/savant/connections-core.ts';
import { zScore, metricAnomalies, volumeAnomalies, silentLenses, fmtMetric } from '../lib/savant/anomalies-core.ts';
import { extractDatedItems } from '../lib/savant/calendar-core.ts';
import { nextInRotation, fallbackPlan, validatePlan } from '../lib/savant/plan-core.ts';

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

console.log('savant week:');
check('weekEndFor: Mon..Fri map to this week\'s Friday', () => {
  for (const d of ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']) {
    assert.equal(weekEndFor(d), '2026-09-25', d);
  }
});
check('weekEndFor: Sat and Sun map to next Friday', () => {
  assert.equal(weekEndFor('2026-09-26'), '2026-10-02');
  assert.equal(weekEndFor('2026-09-27'), '2026-10-02');
});
check('issueWindow: 7 days ending at 16:45Z on week_end', () => {
  const w = issueWindow('2026-09-25');
  assert.equal(w.to, '2026-09-25T16:45:00.000Z');
  assert.equal(w.from, '2026-09-18T16:45:00.000Z');
});
check('weekdaysOf: Monday first through Friday', () => {
  assert.deepEqual(weekdaysOf('2026-09-25'), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
});
check('previousWeekEnd: 7 days back', () => {
  assert.equal(previousWeekEnd('2026-09-25'), '2026-09-18');
});
check('isMonday', () => {
  assert.equal(isMonday('2026-09-21'), true);
  assert.equal(isMonday('2026-09-22'), false);
});

console.log('savant connections:');
check('shapeConnections: drops below minSim', () => {
  const out = shapeConnections([
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C1', sim: 0.5 },
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C2', sim: 0.7 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].targetId, 'C2');
});
check('shapeConnections: caps per record', () => {
  const raw = [
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C1', sim: 0.9 },
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C2', sim: 0.85 },
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C3', sim: 0.8 },
  ];
  const out = shapeConnections(raw, { perRecord: 2 });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.targetId), ['C1', 'C2']);
});
check('shapeConnections: caps overall by max, highest sim first', () => {
  const raw = Array.from({ length: 5 }, (_, i) => ({
    recordKind: 'scan_item',
    recordId: `r${i}`,
    targetKind: 'claim',
    targetId: 'C1',
    sim: 0.6 + i * 0.05,
  }));
  const out = shapeConnections(raw, { max: 3, perRecord: 5 });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.recordId), ['r4', 'r3', 'r2']);
});
check('shapeConnections: deterministic order on tied sim', () => {
  const raw = [
    { recordKind: 'scan_item', recordId: 'b', targetKind: 'claim', targetId: 'C1', sim: 0.7 },
    { recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C1', sim: 0.7 },
  ];
  const out = shapeConnections(raw, { perRecord: 5, max: 5 });
  assert.deepEqual(out.map((c) => c.recordId), ['a', 'b']);
});
check('connectionKey', () => {
  assert.equal(
    connectionKey({ recordKind: 'scan_item', recordId: 'a', targetKind: 'claim', targetId: 'C1', sim: 0.9 }),
    'scan_item:a->claim:C1'
  );
});
check('shapeEchoes: drops same-kind pairs', () => {
  const out = shapeEchoes([{ aKind: 'scan_item', aId: 'a', bKind: 'scan_item', bId: 'b', sim: 0.9 }]);
  assert.equal(out.length, 0);
});
check('shapeEchoes: drops below minSim', () => {
  const out = shapeEchoes([{ aKind: 'scan_item', aId: 'a', bKind: 'intel_fact', bId: 'b', sim: 0.5 }]);
  assert.equal(out.length, 0);
});
check('shapeEchoes: dedupes unordered pairs, keeps higher sim', () => {
  const out = shapeEchoes([
    { aKind: 'scan_item', aId: 'a', bKind: 'intel_fact', bId: 'b', sim: 0.7 },
    { aKind: 'intel_fact', aId: 'b', bKind: 'scan_item', bId: 'a', sim: 0.9 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sim, 0.9);
});
check('shapeEchoes: caps by max, highest sim first', () => {
  const raw = Array.from({ length: 5 }, (_, i) => ({
    aKind: 'scan_item',
    aId: `a${i}`,
    bKind: 'intel_fact',
    bId: `b${i}`,
    sim: 0.6 + i * 0.05,
  }));
  const out = shapeEchoes(raw, { max: 2 });
  assert.equal(out.length, 2);
  assert.equal(out[0].aId, 'a4');
});
check('echoKey: order-independent', () => {
  const k1 = echoKey({ aKind: 'scan_item', aId: 'a', bKind: 'intel_fact', bId: 'b', sim: 0.9 });
  const k2 = echoKey({ aKind: 'intel_fact', aId: 'b', bKind: 'scan_item', bId: 'a', sim: 0.9 });
  assert.equal(k1, k2);
});

console.log('savant anomalies:');
check('zScore: null on fewer than 4 points', () => {
  assert.equal(zScore(10, [1, 2, 3]), null);
});
check('zScore: null when sd is 0 (all history equal)', () => {
  assert.equal(zScore(10, [5, 5, 5, 5]), null);
});
check('zScore: flags a real jump', () => {
  const r = zScore(20, [5, 6, 5, 6, 5, 6]);
  assert.ok(r.z > 2);
  assert.equal(r.mean, 5.5);
});
check('metricAnomalies: flags an efficiency-ratio spike with the registry label', () => {
  const series = [
    {
      company: 'acme-bank',
      code: 'fdic_eeffr',
      points: [
        ...Array.from({ length: 7 }, (_, i) => ({ period: `2024-Q${(i % 4) + 1}`, value: 55 + (i % 2) })),
        { period: '2026-Q2', value: 90 },
      ],
    },
  ];
  const out = metricAnomalies(series);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Efficiency ratio');
  assert.equal(out[0].subject, 'acme-bank');
  assert.equal(out[0].period, '2026-Q2');
  assert.ok(out[0].z >= 2);
  assert.ok(out[0].note.includes('Efficiency ratio for acme-bank moved to 90.00%'));
});
check('metricAnomalies: delta mode does not flag a steady trend, does flag a break in it', () => {
  // Steady growth with the small quarter-to-quarter wobble real series have.
  const grow = (i) => 100 + i * 5 + (i % 2);
  const trend = [{ company: 'grower', code: 'fdic_asset', points: Array.from({ length: 10 }, (_, i) => ({ period: `2024-${String(i + 1).padStart(2, '0')}-01`, value: grow(i) })) }];
  assert.equal(metricAnomalies(trend).length, 0, 'a bank growing 5 a quarter is not an anomaly');
  const jump = [{ company: 'jumper', code: 'fdic_asset', points: [...Array.from({ length: 9 }, (_, i) => ({ period: `2024-${String(i + 1).padStart(2, '0')}-01`, value: grow(i) })), { period: '2024-10-01', value: 300_000 }] }];
  const out = metricAnomalies(jump);
  assert.equal(out.length, 1);
  assert.ok(out[0].note.includes('$0.3B'), out[0].note);
  assert.ok(out[0].note.includes('larger rise'));
  // The same fact from three filings collapses to one entry.
  const triple = ['fdic_asset', 'y9c_bhck2170', 'total_assets'].map((code) => ({ company: 'triple', code, points: [...Array.from({ length: 9 }, (_, i) => ({ period: `p${i}`, value: grow(i) * (code === 'total_assets' ? 1000 : 1) })), { period: 'p9', value: 300_000 * (code === 'total_assets' ? 1000 : 1) }] }));
  assert.equal(metricAnomalies(triple).length, 1);
});
check('metricAnomalies: stale series, ineligible flows and per-company caps', () => {
  const stale = [{ company: 'old', code: 'fdic_eeffr', points: [...Array.from({ length: 7 }, (_, i) => ({ period: `2019-0${(i % 9) + 1}-01`, value: 55 })), { period: '2020-12-31', value: 90 }] }];
  assert.equal(metricAnomalies(stale, { asOf: '2026-09-25', freshDays: 120 }).length, 0, 'a series that ended in 2020 is not news');
  const flow = [{ company: 'acme', code: 'net_income', points: [...Array.from({ length: 7 }, (_, i) => ({ period: `p${i}`, value: 1 })), { period: 'p7', value: 1000 }] }];
  assert.equal(metricAnomalies(flow).length, 0, 'EDGAR flows mix annual and quarterly facts');
  const many = ['fdic_eeffr', 'fdic_roa', 'fdic_roe', 'fdic_nimy', 'fdic_ntlnlsr'].map((code) => ({ company: 'busy', code, points: [...Array.from({ length: 7 }, (_, i) => ({ period: `p${i}`, value: 1 + (i % 2) })), { period: 'p7', value: 50 }] }));
  assert.equal(metricAnomalies(many, { perCompany: 3 }).length, 3);
});
check('fmtMetric renders thousands-of-dollars and dollar series both in billions, percents with two decimals', () => {
  assert.equal(fmtMetric(1976180, 'usd_thousands'), '$2B');
  assert.equal(fmtMetric(1976180000, 'usd'), '$2B');
  assert.equal(fmtMetric(1_547_586_000_000, 'usd'), '$1,547.6B');
  assert.equal(fmtMetric(54.7712, 'percent'), '54.77%');
  assert.equal(fmtMetric(693, 'count'), '693');
});
check('metricAnomalies: a flat series is not flagged', () => {
  const series = [
    {
      company: 'acme-bank',
      code: 'fdic_roa',
      points: Array.from({ length: 8 }, (_, i) => ({ period: `p${i}`, value: 1.2 })),
    },
  ];
  assert.equal(metricAnomalies(series).length, 0);
});
check('metricAnomalies: an unknown code uses the code itself as the label', () => {
  const series = [
    {
      company: 'acme-bank',
      code: 'mystery_metric',
      points: [
        ...Array.from({ length: 7 }, (_, i) => ({ period: `p${i}`, value: 10 + (i % 2) })),
        { period: 'p7', value: 500 },
      ],
    },
  ];
  const out = metricAnomalies(series);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'mystery_metric');
  assert.equal(out[0].source, undefined);
});
check('volumeAnomalies: flags a spike, sources by kind', () => {
  const current = { chips: 40 };
  const trailing = { chips: [5, 6, 5, 6, 5, 6] };
  const outTopic = volumeAnomalies(current, trailing, 'volume_topic', { chips: 'Chips' });
  assert.equal(outTopic.length, 1);
  assert.equal(outTopic[0].source, 'scan');
  assert.equal(outTopic[0].label, 'Chips');
  const outCompany = volumeAnomalies(current, trailing, 'volume_company', {});
  assert.equal(outCompany[0].source, 'intel');
  assert.equal(outCompany[0].label, 'chips');
});
check('volumeAnomalies: below minLatest is skipped even with a real spike shape', () => {
  const current = { chips: 3 };
  const trailing = { chips: [0, 0, 0, 0, 0, 0] };
  assert.equal(volumeAnomalies(current, trailing, 'volume_topic', {}).length, 0);
});
check('silentLenses: flags every lens with zero signals', () => {
  const out = silentLenses({ market: 3, labor: 0 }, ['market', 'labor', 'geopolitics']);
  assert.deepEqual(out.map((a) => a.subject), ['labor', 'geopolitics']);
  assert.equal(out[0].kind, 'lens_silent');
  assert.ok(out[0].note.includes('labor'));
});

console.log('savant calendar:');
check('extractDatedItems: ISO date with a deadline trigger', () => {
  const out = extractDatedItems(
    [{ id: '1', title: 'FTC sets 2026-10-15 deadline for comment responses', text: null, url: 'https://x', href: null }],
    '2026-09-26'
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2026-10-15');
  assert.equal(out[0].trigger, 'deadline');
});
check('extractDatedItems: "Month D, YYYY" with a comments-due trigger', () => {
  const out = extractDatedItems(
    [{ id: '2', title: 'Rule comments due October 26, 2026 says agency', text: null, url: null, href: null }],
    '2026-09-26'
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2026-10-26');
  assert.equal(out[0].trigger, 'comments due');
});
check('extractDatedItems: a past date is ignored', () => {
  const out = extractDatedItems(
    [{ id: '3', title: 'Filing deadline was 2026-01-15 for last cycle', text: null, url: null, href: null }],
    '2026-09-26'
  );
  assert.equal(out.length, 0);
});
check('extractDatedItems: a date with no trigger word nearby is ignored', () => {
  const out = extractDatedItems(
    [{ id: '4', title: 'The company was founded on 2026-10-15 in a garage', text: null, url: null, href: null }],
    '2026-09-26'
  );
  assert.equal(out.length, 0);
});
check('extractDatedItems: a year-less date resolves forward', () => {
  const out = extractDatedItems(
    [{ id: '5', title: 'Conference set for Oct 26 in Austin', text: null, url: null, href: null }],
    '2026-09-26'
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2026-10-26');
});
check('extractDatedItems: a year-less date already past this year rolls to next year', () => {
  const out = extractDatedItems(
    [{ id: '6', title: 'Annual summit held every Jan 5, next one confirmed', text: null, url: null, href: null }],
    '2026-09-26',
    { horizonDays: 200 }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].date, '2027-01-05');
});
check('extractDatedItems: dedupes the same date within one item', () => {
  const out = extractDatedItems(
    [
      {
        id: '7',
        title: 'Rule takes effect October 26, 2026',
        text: 'The comment period deadline is also October 26, 2026 for this rule.',
        url: null,
        href: null,
      },
    ],
    '2026-09-26'
  );
  assert.equal(out.length, 1);
});
check('extractDatedItems: outside the horizon is dropped', () => {
  const out = extractDatedItems(
    [{ id: '8', title: 'Deadline set for 2027-06-01 filings', text: null, url: null, href: null }],
    '2026-09-26',
    { horizonDays: 30 }
  );
  assert.equal(out.length, 0);
});
check('extractDatedItems: sorted by date ascending across items', () => {
  const out = extractDatedItems(
    [
      { id: 'later', title: 'Hearing scheduled for 2026-11-01', text: null, url: null, href: null },
      { id: 'sooner', title: 'Vote expected 2026-10-05', text: null, url: null, href: null },
    ],
    '2026-09-26',
    { horizonDays: 60 }
  );
  assert.deepEqual(out.map((o) => o.id), ['sooner', 'later']);
});

console.log('savant plan:');
check('nextInRotation: first slug not among the recent window', () => {
  assert.equal(nextInRotation(['capability', 'labor', 'regulatory'], ['capability']), 'labor');
});
check('nextInRotation: falls back to rotation[0] when every other slug is recent', () => {
  assert.equal(nextInRotation(['capability', 'labor'], ['labor']), 'capability');
  assert.equal(nextInRotation(['capability', 'labor', 'regulatory'], ['labor', 'regulatory']), 'capability');
});
check('nextInRotation: empty rotation falls back to capability', () => {
  assert.equal(nextInRotation([], ['labor']), 'capability');
});
check('fallbackPlan: builds a deterministic, non-empty plan', () => {
  const plan = fallbackPlan({
    rotation: ['capability', 'labor'],
    recent: ['capability'],
    topCluster: { headline: 'Nvidia unveils next GPU for inference', url: 'https://x' },
    weekEnd: '2026-09-25',
  });
  assert.equal(plan.fallback, true);
  assert.equal(plan.question_slug, 'labor');
  assert.ok(plan.hypothesis.statement.toLowerCase().startsWith('is it the case that'));
  assert.ok(!plan.hypothesis.statement.includes('—'));
});
check('fallbackPlan: no cluster falls back to a generic topic', () => {
  const plan = fallbackPlan({ rotation: ['capability'], recent: [], topCluster: null, weekEnd: '2026-09-25' });
  assert.equal(plan.topic, 'The week in capability');
});
check('validatePlan: a bad question_slug falls back to the fallback plan\'s slug', () => {
  const fb = fallbackPlan({ rotation: ['capability', 'labor'], recent: [], topCluster: null, weekEnd: '2026-09-25' });
  const out = validatePlan(
    { topic: 'A real topic', question_slug: 'not-in-rotation', hypothesis: { statement: 'Is this real?' } },
    { rotation: ['capability', 'labor'], fallback: fb }
  );
  assert.equal(out.question_slug, fb.question_slug);
  assert.equal(out.fallback, false);
});
check('validatePlan: an em dash in the model text is removed', () => {
  const fb = fallbackPlan({ rotation: ['capability'], recent: [], topCluster: null, weekEnd: '2026-09-25' });
  const out = validatePlan(
    { topic: 'Topic here — with a dash', question_slug: 'capability', hypothesis: { statement: 'Statement — also dashed' } },
    { rotation: ['capability'], fallback: fb }
  );
  assert.ok(!out.topic.includes('—'));
  assert.ok(!out.hypothesis.statement.includes('—'));
});
check('validatePlan: missing topic or statement falls back entirely', () => {
  const fb = fallbackPlan({ rotation: ['capability'], recent: [], topCluster: null, weekEnd: '2026-09-25' });
  assert.deepEqual(validatePlan({ hypothesis: { statement: 'x' } }, { rotation: ['capability'], fallback: fb }), fb);
  assert.deepEqual(validatePlan({ topic: 'x', hypothesis: {} }, { rotation: ['capability'], fallback: fb }), fb);
  assert.deepEqual(validatePlan(null, { rotation: ['capability'], fallback: fb }), fb);
});
check('validatePlan: arrays are clipped to 6 items and 200 chars', () => {
  const fb = fallbackPlan({ rotation: ['capability'], recent: [], topCluster: null, weekEnd: '2026-09-25' });
  const longStr = 'x'.repeat(250);
  const out = validatePlan(
    {
      topic: 'A real topic',
      question_slug: 'capability',
      hypothesis: { statement: 'Is this real?', watch: Array.from({ length: 9 }, (_, i) => `w${i}`), what_would_settle_it: [longStr] },
    },
    { rotation: ['capability'], fallback: fb }
  );
  assert.equal(out.hypothesis.watch.length, 6);
  assert.equal(out.hypothesis.what_would_settle_it[0].length, 200);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
