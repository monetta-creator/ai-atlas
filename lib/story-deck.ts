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
    {
      kind: 'table',
      kicker: 'Act 1 · why not just a frontier model',
      title: 'A model reads. A system remembers.',
      heads: ['', 'A frontier model alone', 'This system'],
      rows: [
        ['Memory', 'starts from zero every conversation', 'a compounding, deduplicated corpus with full text and provenance'],
        ['Ontology', 'generic knowledge, no house structure', 'a proprietary, customizable ontology: taxonomies, a tracked-company registry, dimensions, claims with tests'],
        ['Structure', 'prose out, nothing retained', 'facts, events, and quarterly metrics keyed to standard identifiers'],
        ['Verifiability', 'confident text, no receipts', 'every record traceable to its source; answers cite the corpus'],
        ['The model itself', 'is the product', 'is a component: benchmarked, swappable, A/B measured, metered per call'],
      ],
      note: 'The models are rented and replaceable. The corpus, the ontology, and the export contracts are the accumulating asset, and they are ours to shape.',
      takeaway: 'A frontier model is an engine. This is the vehicle: ontology, memory, provenance, and retrieval around whichever engine is currently best.',
    },
    { kind: 'divider', kicker: 'Act 2', title: 'The road to 1000x', subtitle: 'The question is not whether it can be done. It is what turning the dial costs, one order of magnitude at a time.' },
    {
      kind: 'table',
      kicker: 'Act 2 · the dial, priced honestly',
      title: 'Each notch, priced at the retail ceiling',
      heads: ['Scale', 'Documents / day', 'Ceiling / month', 'What actually changes', 'In market terms'],
      rows: [
        ['1x (today)', '~300', `~$${runningUsd}`, 'nothing: the proof of concept as it runs today', 'about 3 percent of one entry-level CI subscription'],
        ['10x', '~3,000', 'under $400', 'higher API allowances; zero structural change', 'about one 10-user enterprise news license'],
        ['100x', '~30,000', 'under $3,600', 'firehose sources in place of polling; object storage', 'about one enterprise media-monitoring contract'],
        ['1000x', '~300,000', 'under $36,000', 'dedicated inference and pipeline infrastructure', 'about a 10-seat enterprise research platform deployment, reading 100M documents a year'],
      ],
      note: 'These are CEILINGS, not forecasts: straight-line arithmetic at today’s retail prices. The real curve bends below linear four separate ways: token prices fall roughly 10x per year; volume moves inference from retail calls to batch and dedicated serving; a tiered read (a cheap classifier pass over everything, full enrichment only on what clears it) cuts effective per-document cost several-fold; and deduplication means marginal novelty grows slower than raw intake. The frame that matters: this table was paid retail, by one person, to prove the concept. Inside an enterprise, every row is a rounding error against existing data and tooling budgets.',
      takeaway: 'Linear at retail is the worst case, and even the worst case is a rounding error inside the firewall. The build is proven; adoption is a decision.',
    },
    {
      kind: 'table',
      kicker: 'Act 2 · what scale actually changes',
      title: 'The architecture carries; attention becomes the product',
      heads: ['Scale', 'Carried unchanged', 'The new frontier'],
      rows: [
        ['10x', 'everything: engines, budgets, gates, ontology, exports', 'none'],
        ['100x', 'the same, on swapped plumbing', 'retention economics: deciding what full text to keep hot'],
        ['1000x', 'the same: the invariants are scale-free', 'attention: ranking, dedup, and the estimative layer decide what a human ever sees'],
      ],
      note: 'The invariants are scale-free by design: allow-listed structure, provenance on every record, metered cost, human gates on what enters the argument record, schema-first exports. At 1000x no one reads everything, and nothing about this system ever assumed anyone would: it was built to structure first and surface selectively.',
      takeaway: 'Scale does not break the system. It promotes the retrieval and judgment layers from features to the product.',
    },
    {
      kind: 'stat-grid',
      kicker: 'Act 2 · why the reading pays off',
      title: 'Scale only matters if you can retrieve it',
      stats: [
        { n: 'Grounded Q&A', l: 'answers assembled from the corpus, with citations to the records', sub: 'a research loop with verification, not a chat with a memory' },
        { n: 'Structured recall', l: 'facts, events, and metrics queryable by company, code, and period', sub: 'keyed to standard identifiers for downstream joins' },
        { n: 'Schema-first exports', l: 'the whole corpus travels: formal contracts, generated importer docs', sub: 'built to feed retrieval systems downstream' },
        { n: 'The ontology', l: 'taxonomies and registries that make 100M documents navigable', sub: 'editorial, versioned, and ours to change' },
        { n: 'The argument layer', l: 'claims with tests, evidence with direction, confidence with reasons', sub: 'where signal becomes position' },
        { n: 'Human gates', l: 'people decide what enters the record, at any volume', sub: 'the invariant that makes the rest trustworthy' },
      ],
      note: 'Ingestion without retrieval is a landfill. The reason to turn the dial is that every layer above the intake already exists and already compounds.',
      takeaway: 'The corpus is only as valuable as the questions it can answer. That layer is built, and it is what 1000x feeds.',
    },
    {
      kind: 'divider',
      kicker: 'The answer',
      title: '1000x is arithmetic.',
      subtitle: 'Ingestion is continuous, structured, and cheap; the scale dial is priced per notch. What makes it worth turning is everything a frontier model alone does not have: a proprietary, customizable ontology, a compounding corpus with provenance, and the retrieval layers that turn reading into answers.',
    },
  ];
  return { generatedOn, slides };
}
