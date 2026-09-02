-- 0049: index for the /intel metrics-coverage read.
--
-- getIntelMetricsCoverage (lib/data/intel.ts) groups the ~2M-row intel_metrics
-- warehouse by source with count(distinct company_slug) + min/max(period). With
-- no index leading on source that was a full seq scan plus an external merge
-- sort spilling ~58 MB to temp disk on EVERY /intel load (measured 2.7 s idle,
-- the page's whole latency budget). This index lets the planner stream an
-- index-only scan in (source, company_slug) order: no sort, no temp file, and
-- Postgres 17's presorted-aggregate path serves the distinct count.
create index if not exists intel_metrics_source_company_period_idx
  on intel_metrics (source, company_slug, period);

analyze intel_metrics;
