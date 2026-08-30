import { one } from '../db';

// The /ingestion page's live ledger: what the system reads from the outside
// world, across the three collection engines (scan, pipeline, intel), summed
// today / trailing 14 days / all time. One Promise.all, four small reads.

export interface IngestionLedger {
  today: {
    items: number;
    facts: number;
    tavilyQueries: number;
    spendUsd: number;
  };
  trailing14: {
    items: number;
    facts: number;
    tavilyQueries: number;
  };
  corpus: {
    itemsTotal: number;
    charsTotal: number;
    signalsPublished: number;
    factsTotal: number;
    metricsTotal: number;
  };
  perEngine: {
    label: string;
    items14: number;
    itemsTotal: number;
  }[];
}

export async function getIngestionLedger(): Promise<IngestionLedger> {
  const [today, trailing14, corpus, engines, spendToday] = await Promise.all([
    one<{ items: number; facts: number; tavily_queries: number }>(
      `select
         (select count(*) from scan_items where created_at > current_date)::int
           + (select count(*) from intel_items where created_at > current_date)::int
           + (select count(*) from signal_candidates where created_at > current_date)::int as items,
         (select count(*) from intel_facts where created_at > current_date)::int as facts,
         (select coalesce(sum(coalesce((metadata->>'queries')::int, 1)), 0) from ai_cost_log
            where model = 'tavily-search' and created_at > current_date)::int as tavily_queries`
    ),
    one<{ items: number; facts: number; tavily_queries: number }>(
      `select
         (select count(*) from scan_items where created_at > now() - interval '14 days')::int
           + (select count(*) from intel_items where created_at > now() - interval '14 days')::int
           + (select count(*) from signal_candidates where created_at > now() - interval '14 days')::int as items,
         (select count(*) from intel_facts where created_at > now() - interval '14 days')::int as facts,
         (select coalesce(sum(coalesce((metadata->>'queries')::int, 1)), 0) from ai_cost_log
            where model = 'tavily-search' and created_at > now() - interval '14 days')::int as tavily_queries`
    ),
    one<{ items_total: number; chars_total: number; signals: number; facts_total: number; metrics_total: number }>(
      `select
         (select count(*) from scan_items)::int
           + (select count(*) from intel_items)::int
           + (select count(*) from signal_candidates)::int as items_total,
         (select coalesce(sum(length(raw_content)), 0) from scan_items)::bigint::float
           + (select coalesce(sum(length(raw_content)), 0) from intel_items)::bigint::float
           + (select coalesce(sum(length(raw_content)), 0) from signal_candidates)::bigint::float as chars_total,
         (select count(*) from signals where is_published)::int as signals,
         (select count(*) from intel_facts)::int as facts_total,
         (select count(*) from intel_metrics)::int as metrics_total`
    ),
    one<{
      scan_14: number; scan_total: number;
      pipeline_14: number; pipeline_total: number;
      intel_14: number; intel_total: number;
    }>(
      `select
         (select count(*) from scan_items where created_at > now() - interval '14 days')::int as scan_14,
         (select count(*) from scan_items)::int as scan_total,
         (select count(*) from signal_candidates where created_at > now() - interval '14 days')::int as pipeline_14,
         (select count(*) from signal_candidates)::int as pipeline_total,
         (select count(*) from intel_items where created_at > now() - interval '14 days')::int as intel_14,
         (select count(*) from intel_items)::int as intel_total`
    ),
    one<{ usd: number }>(
      `select coalesce(sum(cost_usd), 0)::numeric as usd from ai_cost_log
        where created_at > current_date
          and (feature like 'scan\\_%' or feature like 'pipeline\\_%' or feature like 'intel\\_%')`
    ),
  ]);

  const t = today ?? { items: 0, facts: 0, tavily_queries: 0 };
  const t14 = trailing14 ?? { items: 0, facts: 0, tavily_queries: 0 };
  const c = corpus ?? { items_total: 0, chars_total: 0, signals: 0, facts_total: 0, metrics_total: 0 };
  const e = engines ?? { scan_14: 0, scan_total: 0, pipeline_14: 0, pipeline_total: 0, intel_14: 0, intel_total: 0 };

  return {
    today: {
      items: t.items,
      facts: t.facts,
      tavilyQueries: t.tavily_queries,
      spendUsd: spendToday?.usd ?? 0,
    },
    trailing14: {
      items: t14.items,
      facts: t14.facts,
      tavilyQueries: t14.tavily_queries,
    },
    corpus: {
      itemsTotal: c.items_total,
      charsTotal: c.chars_total,
      signalsPublished: c.signals,
      factsTotal: c.facts_total,
      metricsTotal: c.metrics_total,
    },
    perEngine: [
      { label: 'News scan', items14: e.scan_14, itemsTotal: e.scan_total },
      { label: 'Discovery pipeline', items14: e.pipeline_14, itemsTotal: e.pipeline_total },
      { label: 'Intel desk', items14: e.intel_14, itemsTotal: e.intel_total },
    ],
  };
}
