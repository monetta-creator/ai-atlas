-- 0048: the ATS hiring-signal unit. Adds the per-company Greenhouse/Lever
-- board config and widens intel_metrics.source to accept the LLM-free
-- open-role counts it writes (metric codes ats_open_roles_total /
-- _ai_ml / _fraud_risk / _engineering / _agents, period = the run day).

alter table intel_companies add column ats jsonb;

alter table intel_metrics drop constraint intel_metrics_source_check;
alter table intel_metrics add constraint intel_metrics_source_check
  check (source in ('edgar_xbrl', 'fdic', 'cfpb', 'y9c', 'ats'));
