-- 0044: the intel metrics backfill adds holding-company consolidated series
-- (FR Y-9C, MDRM-coded) alongside the bank-subsidiary and market sources.
-- Widens the source CHECK; series naming: 'y9c_<lowercase mdrm>' (e.g.
-- y9c_bhck2170 = total consolidated assets), 'fdic_<lowercase mnemonic>'.

alter table intel_metrics drop constraint intel_metrics_source_check;
alter table intel_metrics add constraint intel_metrics_source_check
  check (source in ('edgar_xbrl', 'fdic', 'cfpb', 'y9c'));
