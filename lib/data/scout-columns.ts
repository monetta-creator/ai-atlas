// Pure column-visibility lists for Startup Scout. Split out of
// lib/data/scout.ts (which imports lib/db and so cannot be loaded by the
// plain-Node tests) so scripts/test-access-columns.mjs can assert the
// public/admin boundary directly. Re-exported from lib/data/scout.ts
// unchanged; see that file for how these lists are used.

export const COMPANY_PUBLIC_COLUMNS = `
  id, name, domain, url, vertical, one_liner, ai_tech, founded_year, stage,
  funding_note, hq, status, origin, created_at, updated_at`;

export const COMPANY_ADMIN_COLUMNS = `${COMPANY_PUBLIC_COLUMNS},
  review_note, reviewed_at::text as reviewed_at,
  agent_verdict, agent_reason, agent_confidence, agent_scores, agent_at::text as agent_at,
  fetched_via, run_id, found_url`;
