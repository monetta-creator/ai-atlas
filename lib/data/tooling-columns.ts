// Pure column-visibility lists for the AI Tooling Monitor. Split out of
// lib/data/tooling.ts (which imports lib/db and so cannot be loaded by the
// plain-Node tests) so scripts/test-access-columns.mjs can assert the
// public/portal/admin boundary directly. Re-exported from lib/data/tooling.ts
// unchanged; see that file for how these lists are used (columnsFor,
// allowedStatuses).

export const PRODUCT_PUBLIC_COLUMNS: string[] = [
  'id', 'name', 'slug', 'vendor', 'vendor_domain', 'url', 'category', 'secondary_categories',
  'one_liner', 'description', 'target_buyer', 'deployment', 'pricing_model', 'pricing_note',
  'maturity', 'founded_year', 'hq', 'funding_note', 'notable_customers', 'integrations',
  'compliance_claims', 'models_used', 'features', 'feed_url', 'changelog_url', 'github_repo',
  'dossier', 'status', 'pinned',
  "to_char(first_seen, 'YYYY-MM-DD') as first_seen", "to_char(last_seen, 'YYYY-MM-DD') as last_seen",
  'created_at', 'updated_at',
];

export const PRODUCT_PORTAL_COLUMNS: string[] = [
  ...PRODUCT_PUBLIC_COLUMNS, 'deep_dive', 'agent_fit', 'agent_scores', 'agent_reason',
];

export const PRODUCT_ADMIN_COLUMNS: string[] = [
  ...PRODUCT_PORTAL_COLUMNS,
  'review_note', 'reviewed_at', 'agent_model', 'agent_at',
  'raw_content', 'fetched_via', 'fetched_at', 'fetch_error',
  'enriched_at', 'enriched_by', 'deep_dived_at', 'feed_checked_at',
  'origin', 'found_url', 'found_title', 'run_id',
];
