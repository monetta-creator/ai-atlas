import { makeClient } from './db.mjs';

// The Strategy Atlas starter seed. Deliberately SMALL and clearly-sample: the
// tool's real content is the operator's own hypotheses and documents. The seed
// exists so a fresh install has working surfaces to learn on (a hypothesis with
// evidence, a published signal, a source with retained text) and so db:verify
// and the smoke tests in transition/RUNBOOK.md have material.
//
// Idempotent: upserts on hypotheses.code / sources.url / signals.title. Every
// conviction resets to NEUTRAL 0.50 — the operator's to move, through the gate.

const NEUTRAL = 0.5;
const client = makeClient();

const hypotheses = [
  {
    code: 'H1',
    statement: 'SAMPLE: Our core market consolidates to three at-scale players within 24 months.',
    test: 'Two or more top-ten competitors exit, merge, or are acquired within the window; concentration (top-3 share) rises above 60%.',
    note: 'Sample hypothesis shipped with the seed. Replace with a real one and delete this note.',
    resolvability: 'slow',
  },
  {
    code: 'H2',
    statement: 'SAMPLE: The new pricing model lifts net revenue retention without raising churn.',
    test: 'NRR improves by 5+ points over two quarters while logo churn stays within one point of baseline.',
    note: 'Sample hypothesis shipped with the seed.',
    resolvability: 'clean',
  },
  {
    code: 'H3',
    statement: 'SAMPLE: Regulatory change in our primary jurisdiction raises compliance cost enough to reshape the mid-market.',
    test: 'A final rule is published whose direct compliance cost exceeds 2% of revenue for mid-market operators.',
    note: 'Sample hypothesis shipped with the seed.',
    resolvability: 'qualitative',
  },
];

const sources = [
  {
    url: 'urn:sample:industry-briefing-2026',
    title: 'SAMPLE: Industry consolidation briefing',
    outlet: 'Seed sample',
    author: null,
    raw_text:
      'This is a sample retained document shipped with the seed. It stands in for a real ' +
      'ingested artifact: an analyst briefing arguing that the core market is consolidating ' +
      'faster than expected, with two mid-tier competitors exploring a merger and a third ' +
      'seeking a buyer. Replace it with real material and delete this row.',
  },
];

const signals = [
  {
    title: 'SAMPLE: Two mid-tier competitors confirm merger talks',
    summary:
      'A sample signal shipped with the seed: reporting that two mid-tier competitors have ' +
      'confirmed merger discussions, a step toward the consolidation H1 tracks.',
    significance: 'medium',
    context: 'external',
    touches: ['H1'],
    touch_details: {
      H1: { direction: 'supports', reason: 'A confirmed merger between mid-tier players is direct movement toward the three-player consolidation H1 predicts.' },
    },
    source_url: 'urn:sample:industry-briefing-2026',
    is_published: true,
  },
];

async function main() {
  await client.connect();

  // hypotheses (conviction reset to NEUTRAL on re-seed: the operator's to move)
  for (const h of hypotheses) {
    await client.query(
      `insert into hypotheses (code, statement, test, note, resolvability, conviction)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (code) do update set
         statement = excluded.statement, test = excluded.test, note = excluded.note,
         resolvability = excluded.resolvability, conviction = $6, updated_at = now()`,
      [h.code, h.statement, h.test, h.note, h.resolvability, NEUTRAL]
    );
  }
  console.log(`hypotheses: ${hypotheses.length}`);

  // sources
  const sourceId = new Map();
  for (const s of sources) {
    const { rows } = await client.query(
      `insert into sources (url, title, outlet, author, raw_text)
       values ($1, $2, $3, $4, $5)
       on conflict do nothing
       returning id`,
      [s.url, s.title, s.outlet, s.author, s.raw_text]
    );
    const id =
      rows[0]?.id ??
      (await client.query('select id from sources where url = $1', [s.url])).rows[0].id;
    sourceId.set(s.url, id);
  }
  console.log(`sources: ${sources.length}`);

  // signals (+ evidence materialized for the published one, mirroring
  // syncSignalEvidence so the seeded state matches what publish produces)
  for (const s of signals) {
    const src = s.source_url ? sourceId.get(s.source_url) : null;
    const existing = await client.query('select id from signals where title = $1', [s.title]);
    let signalId = existing.rows[0]?.id;
    if (!signalId) {
      const { rows } = await client.query(
        `insert into signals (title, summary, significance, context, touches, touch_details, source_id, is_published, origin)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'manual')
         returning id`,
        [s.title, s.summary, s.significance, s.context, s.touches, JSON.stringify(s.touch_details), src, s.is_published]
      );
      signalId = rows[0].id;
    }
    if (s.is_published) {
      for (const code of s.touches) {
        const hyp = await client.query('select id from hypotheses where code = $1', [code]);
        if (!hyp.rows[0]) continue;
        const d = s.touch_details[code] ?? {};
        await client.query(
          `insert into evidence (hypothesis_id, signal_id, source_id, direction, confidence, note, actor)
           values ($1, $2, $3, $4, 'medium', $5, 'seed')
           on conflict (signal_id, hypothesis_id) where signal_id is not null do nothing`,
          [hyp.rows[0].id, signalId, src, d.direction ?? 'neutral', d.reason ?? null]
        );
      }
    }
  }
  console.log(`signals: ${signals.length}`);

  await client.end();
  console.log('seed complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
