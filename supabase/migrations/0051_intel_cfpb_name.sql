-- 0051: an explicit CFPB legal-name override for the intel registry.
--
-- fetchCfpbComplaints/fetchCfpbMonthlySeries (lib/intel/metrics.ts) resolve
-- the registry's display name through the CFPB _suggest_company endpoint
-- and query the first suggestion. That automatic pick is wrong for several
-- registered companies: it returns nothing for citigroup/pnc/lendingclub
-- (their registered legal names differ from the registry display name) and
-- a plausible-looking but unrelated company for hopper (an unregistered
-- travel app matched to an unrelated rent-to-own lender). cfpb_name lets
-- the registry pin the exact registered name to query, or opt a company out
-- of CFPB collection entirely.

alter table intel_companies add column if not exists cfpb_name text;

comment on column intel_companies.cfpb_name is
  'The exact CFPB-registered company name to query when the automatic _suggest_company pick is wrong or empty. Null keeps the automatic pick. An empty string skips CFPB for this company on purpose.';
