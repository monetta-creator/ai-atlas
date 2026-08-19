-- 0033_queue_agent.sql — the research console's queue agent (recommend-only).
--
-- A bounded model pass over the pending review queue stamps each paper with a
-- recommended decision (tracked/noted/dismissed, reusing paper_review_t; the
-- agent never recommends 'pending'), a one-line reason, a 0-100 confidence,
-- and a short cluster label used to group dismissals by theme. The HUMAN
-- commits: per-row or per-group bulk accept flows through the same review
-- action as a manual decision. Recommendations are KEPT after the decision
-- (agreement rate is a future taste-audit signal).
--
-- research_agent_prefs is the standing steering note singleton (the admin's
-- "deprioritize X, hot on Y" instructions, fed into every run), mirroring the
-- scan-singleton pattern.

alter table papers
  add column agent_recommendation paper_review_t,
  add column agent_reason text,
  add column agent_confidence int check (agent_confidence between 0 and 100),
  add column agent_cluster text,
  add column agent_at timestamptz;

create table research_agent_prefs (
  id boolean primary key default true check (id),
  steering text,
  updated_at timestamptz not null default now()
);

alter table research_agent_prefs enable row level security;
