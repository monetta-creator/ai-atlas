-- 0050: enforce sources.url uniqueness (R5, 2026-09-01 cron audit).
--
-- ensureSource (lib/mutations/pipeline.ts) is a SELECT-then-INSERT keyed on
-- sources.url, and nothing has ever backed sources.url with a unique index
-- (the only index on sources is the search_tsv GIN from 0029). Pipeline
-- analysis runs 4-way concurrent (ANALYSIS_POOL = 4 in lib/pipeline/engine.ts),
-- so two candidates citing the same URL could race the SELECT and both insert,
-- twinning the sources row and splitting evidence tallies + reliability priors
-- across the twins. This migration cleans up any twins already in the table,
-- then adds the unique index the rewritten ensureSource relies on for a single
-- atomic INSERT ... ON CONFLICT.

-- ---- Step 1: one-time duplicate merge --------------------------------------
-- For every url shared by more than one sources row, keep the OLDEST row
-- (min created_at, tie-break min id) and repoint every foreign key into
-- sources onto that keeper before dropping the other rows. Five FKs
-- reference sources(id) across the schema (grep "references sources"):
-- evidence.source_id, extraction_queue.source_id, signals.source_id,
-- signal_candidates.source_id, papers.source_id.

create temporary table dup_keeper as
select s.id as loser_id, k.keeper_id
from sources s
join (
  select url, (array_agg(id order by created_at asc, id asc))[1] as keeper_id
  from sources
  where url is not null
  group by url
  having count(*) > 1
) k on k.url = s.url
where s.id <> k.keeper_id;

update evidence e set source_id = dk.keeper_id
from dup_keeper dk
where e.source_id = dk.loser_id;

update extraction_queue eq set source_id = dk.keeper_id
from dup_keeper dk
where eq.source_id = dk.loser_id;

update signals sg set source_id = dk.keeper_id
from dup_keeper dk
where sg.source_id = dk.loser_id;

update signal_candidates sc set source_id = dk.keeper_id
from dup_keeper dk
where sc.source_id = dk.loser_id;

update papers p set source_id = dk.keeper_id
from dup_keeper dk
where p.source_id = dk.loser_id;

delete from sources s
using dup_keeper dk
where s.id = dk.loser_id;

drop table dup_keeper;

-- ---- Step 2: the unique index -----------------------------------------------
-- Partial (WHERE url IS NOT NULL): url is nullable (pasted/manual sources with
-- no URL), and multiple NULLs must stay allowed. ensureSource's rewritten
-- INSERT ... ON CONFLICT (url) WHERE url IS NOT NULL targets this exact index
-- (a partial unique index needs a matching WHERE clause on the conflict target).
create unique index sources_url_key on sources (url) where url is not null;
