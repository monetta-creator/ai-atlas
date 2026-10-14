-- 0083_research_queue_cap.sql — the review desk's "triage down to N" pass.
--
-- papers.review_basis gains 'bulk_cap': a paper dismissed because the queue
-- was cut down to the N the editor will read (lib/research/queue-cap.ts).
-- Like every non-null basis, it never counts as revealed taste or as agent
-- agreement evidence. A separate migration rather than an edit to 0082, so a
-- database that already applied 0082 picks the new value up too.

alter table papers drop constraint if exists papers_review_basis_check;
alter table papers add constraint papers_review_basis_check
  check (review_basis in ('agent_policy', 'bulk_agent', 'bulk_stale', 'bulk_cap'));
