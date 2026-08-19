-- Thesis-scoped gap diagnosis (the deal workflow's step 3): a per-thesis persisted
-- scan of the claims the thesis depends on that the map lacks. Same shape as the
-- argument_gap_scan singleton's payload ({generatedAt, recommendations[]}), stored
-- on the thesis row because each thesis carries its own scan. Recommend-only:
-- a recommendation pre-fills the authoring form; the form submit is the sole writer.

alter table theses add column if not exists gap_scan jsonb;
