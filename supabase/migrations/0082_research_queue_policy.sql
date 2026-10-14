-- 0082_research_queue_policy.sql — the research review desk (/research/queue).
--
-- papers.review_basis records HOW a review decision was made. null = a human
-- read the paper and decided it alone (the review controls or the sprint);
-- 'bulk_agent' = a human bulk-accepted the agent's recommendations;
-- 'bulk_stale' = a human cleared everything past the staleness window;
-- 'agent_policy' = the auto-dismiss policy committed an agent dismissal on
-- its own. Only null rows count as revealed taste (getReviewTasteDigest) and
-- as agent-agreement evidence, so the agent never learns from its own calls.
--
-- research_prefs gains the auto-dismiss policy (the signal promotion policy's
-- shape, 0055): on by default, agent dismissals at or above the confidence
-- bar clear after every engine run. Dismissal is reversible and keeps the
-- row; rising citations resurface it (getRisingRejects). Track and note stay
-- human: both put a paper on a public shelf.

alter table papers add column review_basis text
  check (review_basis in ('agent_policy', 'bulk_agent', 'bulk_stale'));

-- Backfill: acceptAgentRecommendations wrote one reviewed_at per bulk accept
-- (one statement, one now()), so three or more agent-matching decisions
-- sharing a timestamp were a bulk accept, not paper-by-paper reads.
update papers p
   set review_basis = 'bulk_agent'
  from (
    select reviewed_at from papers
     where reviewed_at is not null and agent_recommendation is not null
     group by reviewed_at having count(*) >= 3
  ) b
 where p.reviewed_at = b.reviewed_at
   and p.review_status = p.agent_recommendation;

create index papers_review_queue_idx on papers (agent_recommendation, agent_confidence)
  where triage_status = 'kept' and review_status = 'pending';

alter table research_prefs
  add column auto_dismiss boolean not null default true,
  add column auto_dismiss_min_confidence int not null default 80
    check (auto_dismiss_min_confidence between 50 and 100),
  add column stale_days int not null default 21
    check (stale_days between 3 and 180);
