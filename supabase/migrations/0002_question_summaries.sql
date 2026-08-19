-- Question state summaries: an append-only log of AI-generated one-page summaries
-- of a question's current state, captured over time so the question's evolution
-- is visible across snapshots. `summary` is the structured one-pager; `metrics`
-- holds the counts computed (in code) at generation time, for the timeline.
create table question_summaries (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  summary     jsonb not null,
  metrics     jsonb not null,
  created_at  timestamptz not null default now()
);

create index on question_summaries (question_id, created_at desc);

-- Deny-by-default like the rest of the schema; the app's DB role bypasses RLS.
alter table question_summaries enable row level security;
