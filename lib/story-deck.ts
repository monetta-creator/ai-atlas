import { one } from './db';
import { getMonthlyBill, FIXED_MONTHLY } from './data/costs';
import type { CostDeck, DeckSlide } from './costs-deck';

// The ingestion story deck: the answer to the thought experiment "what if we
// 1000x external signal ingestion?". Reuses the cost deck's slide model and
// BOTH of its renderers unchanged; this module only assembles different
// slides. Audience: a VP conversation. Rules: generic system language, no
// employer or tracked-company names, and the scale comparisons pin to the
// enterprise platforms' subscription prices (the researched comps), never to
// a human baseline. Every projection states its assumptions on the slide.

// The scaling model's anchors, measured 2026-08-30:
//   ~300 discovered items/day across the three engines at daily cadence,
//   ~12KB retained full text per item, enrichment ~$0.004/item on the
//   benchmarked open-weight models, collection legs $0 (feeds, public APIs)
//   or free-tier search. Market bands from the comps research of the same
//   date (procurement-data aggregators; see lib/costs-deck.ts COMPS).
const BASELINE_ITEMS_PER_DAY = 300;

export async function buildStoryDeckData(): Promise<CostDeck> {
  const [bill, live, corpus] = await Promise.all([
    getMonthlyBill(),
    one<{
      items14: number; facts14: number; metrics_total: number;
      scan_feeds: number; intel_feeds: number; filers: number; certs: number;
    }>(
      `select
         (select count(*) from scan_items where created_at > now() - interval '14 days')::int
           + (select count(*) from intel_items where created_at > now() - interval '14 days')::int
           + (select count(*) from signal_candidates where created_at > now() - interval '14 days')::int as items14,
         (select count(*) from intel_facts where created_at > now() - interval '14 days')::int as facts14,
         (select count(*) from intel_metrics)::int as metrics_total,
         (select coalesce(sum(array_length(feed_urls, 1)), 0) from scan_topics where active)::int as scan_feeds,
         (select coalesce(sum(array_length(feed_urls, 1)), 0) from intel_companies where active)::int as intel_feeds,
         (select count(*) from intel_companies where active and cik is not null)::int as filers,
         (select count(*) from intel_companies where active and fdic_cert is not null)::int as certs`
    ),
    one<{ retained_chars: number; items_total: number; signals: number }>(
      `select
         (select coalesce(sum(length(raw_content)), 0) from scan_items)::bigint::float
           + (select coalesce(sum(length(raw_content)), 0) from intel_items)::bigint::float
           + (select coalesce(sum(length(raw_content)), 0) from signal_candidates)::bigint::float as retained_chars,
         (select count(*) from scan_items)::int
           + (select count(*) from intel_items)::int
           + (select count(*) from signal_candidates)::int as items_total,
         (select count(*) from signals where is_published)::int as signals`
    ),
  ]);
  const generatedOn = new Date().toISOString().slice(0, 10);
  const fixedTotal = FIXED_MONTHLY.reduce((s, f) => s + f.usd, 0);
  const runningUsd = Math.round(fixedTotal + bill.projectedUsd);
  const l = live ?? { items14: 0, facts14: 0, metrics_total: 0, scan_feeds: 0, intel_feeds: 0, filers: 0, certs: 0 };
  const c = corpus ?? { retained_chars: 0, items_total: 0, signals: 0 };
  const mChars = Math.round(c.retained_chars / 1_000_000);

  const slides: DeckSlide[] = [
    {
      kind: 'title',
      kicker: 'Thought experiment',
      title: 'What if we 1000x external signal ingestion?',
      subtitle:
        'A standing intelligence system already reads the outside world continuously: news, filings, and regulatory data, structured on arrival. This is what the question costs, and what it takes, on the architecture that exists today.',
      bigStat: { n: `~${BASELINE_ITEMS_PER_DAY}`, l: 'external documents discovered, fetched, and structured per day, today, unattended' },
      date: generatedOn,
    },
    {
      kind: 'stat-grid',
      kicker: 'Act 1 · the step change already happened',
      title: 'Today’s ingestion, measured',
      stats: [
        { n: l.items14.toLocaleString(), l: 'documents ingested, trailing 14 days', sub: 'full text retained with provenance' },
        { n: String(l.scan_feeds + l.intel_feeds), l: 'feeds polled every weekday', sub: 'press wires, newsrooms, per-company news' },
        { n: `${l.filers} + ${l.certs}`, l: 'SEC filers and bank charters watched', sub: 'filings within a day; quarterly data on schedule' },
        { n: l.facts14.toLocaleString(), l: 'structured facts extracted, trailing 14 days', sub: 'dated, attributed, deduplicated' },
        { n: l.metrics_total.toLocaleString(), l: 'regulatory metric values on hand', sub: 'a decade deep, refreshed automatically' },
        { n: `${mChars.toLocaleString()}M`, l: 'characters of retained source text', sub: `${c.items_total.toLocaleString()} documents, searchable and exportable` },
      ],
      note: 'Every figure on this page is queried live from the system at render time.',
      takeaway: 'The collection layer is already continuous, structured, and unattended. The step change is behind us.',
    },
    {
      kind: 'table',
      kicker: 'Act 1 · the machinery',
      title: 'Three engines run the intake',
      heads: ['Engine', 'What it sweeps', 'Cadence', 'What comes out'],
      rows: [
        ['News scan', 'topic feeds and news search across the configured taxonomy', 'every weekday', 'tagged items with full text'],
        ['Discovery pipeline', 'targeted development search across six audience lenses', 'every weekday', 'draft signals a human reviews'],
        ['Intel desk', 'per-company feeds, filings, and regulatory data for a tracked registry', 'every weekday', 'items, facts, and quarterly metrics'],
      ],
      note: 'Each engine is checkpointed, budget-capped, resumable, and independently switchable. Humans review everything that becomes part of the record.',
      takeaway: `${c.signals.toLocaleString()} published signals and a two-million-point metrics warehouse have already come through these gates.`,
    },
    {
      kind: 'before-after',
      kicker: 'Act 1 · how it got cheap',
      title: 'The same intake, re-engineered twice',
      pairs: [
        {
          label: 'Development discovery',
          before: { n: 'weekly', l: 'one frontier-model run, $3.70, console-driven (2026-08-17)' },
          after: { n: 'daily', l: 'open-weight stack, $0.013 per run, unattended (2026-08-29)' },
          factor: '7x cadence, 285x cheaper',
        },
        {
          label: 'Item enrichment',
          before: { n: '$1.43', l: 'per day on frontier models (2026-08-29 morning)' },
          after: { n: '$0.013', l: 'per day on benchmarked open-weight models, same validation gates' },
          factor: '110x cheaper',
        },
        {
          label: 'Structured metrics',
          before: { n: 'n/a', l: 'not collected at all' },
          after: { n: '2.0M', l: 'values loaded from public regulatory APIs, zero model spend (2026-08-30)' },
          factor: 'new capability',
        },
      ],
      footnote: 'Collection is model-free where possible (feeds, public APIs, model-free search); models only touch judgment and structure, and the cheap ones are A/B measured in production.',
      takeaway: 'Cost per document fell two orders of magnitude in one engineering pass. That is the lever 1000x pulls on.',
    },
    { kind: 'divider', kicker: 'Act 2', title: 'The road to 1000x', subtitle: 'Scaling the measured unit economics, with the assumptions stated.' },
    {
      kind: 'table',
      kicker: 'Act 2 · the model',
      title: 'What each order of magnitude costs',
      heads: ['Scale', 'Documents / day', 'Est. monthly cost', 'What has to change', 'Priced against the market'],
      rows: [
        ['1x (today)', '~300', `~$${runningUsd}`, 'nothing: free tiers and pennies of model spend', 'about 3 percent of one entry-level CI subscription'],
        ['10x', '~3,000', '~$400', 'paid search tier; same database, same engines', 'about one 10-user enterprise news license'],
        ['100x', '~30,000', '~$3,600', 'commercial feed firehoses, object storage, retention windows', 'about one enterprise media-monitoring contract'],
        ['1000x', '~300,000', '~$30,000 to $36,000', 'dedicated pipeline infrastructure; attention becomes the scarce resource', 'about a 10-seat market-intelligence deployment'],
      ],
      note: 'Assumptions: enrichment at the measured $0.004 per document on open-weight models at TODAY’S prices (token prices have fallen roughly 10x per year, so the right column is a ceiling); collection stays model-free; storage at ~12KB retained text per document. Market bands from the 2026-08-30 comps research: CI platforms $15-60k, news licenses $8-96k, media monitoring $13-65k, market-intelligence seats $10-40k per year.',
      takeaway: 'At 1000x, the system reads about 100 million documents a year for the price of a 10-seat platform subscription.',
    },
    {
      kind: 'table',
      kicker: 'Act 2 · the honest part',
      title: 'What breaks, and what carries over',
      heads: ['Scale', 'Scales linearly', 'Must be rebuilt', 'The binding constraint'],
      rows: [
        ['10x', 'everything: engines, budgets, exports', 'nothing', 'search API quotas (a pricing tier, not a wall)'],
        ['100x', 'enrichment, facts, metrics, exports', 'source acquisition (firehoses over polling) and storage tiers', 'database and retention economics'],
        ['1000x', 'the gates, the taxonomy, the export contracts', 'the reading model: no one reviews 300,000 documents a day', 'attention: ranking, dedup, and the estimative layer become the product'],
      ],
      note: 'The invariants survive every row: allow-listed structure, provenance on every record, metered cost, human gates on what enters the argument record, and schema-first exports built for downstream ingestion.',
      takeaway: '1000x is not a research program. It is a sequence of engineering decisions this architecture was shaped to absorb.',
    },
    {
      kind: 'divider',
      kicker: 'The answer',
      title: '1000x is arithmetic.',
      subtitle: 'The step change was making ingestion continuous, structured, and cheap. Scale from here is a dial: each notch is priced above, and every safeguard travels with it.',
    },
  ];
  return { generatedOn, slides };
}
