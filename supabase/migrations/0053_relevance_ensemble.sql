-- 0053: the relevance ensemble for the external scan.
--
-- relevance was the A/B-assigned model's single read and the three flash
-- models score the same anchored rubric on different rulers (GLM ~0.15 low).
-- The random split stays (it keeps the A/B fair); the score is ensembled:
-- every panel model gives a score-only read, relevance becomes the median of
-- the votes, and the raw votes + spread ride beside it (lib/scan/ensemble.ts).
alter table scan_items
  add column if not exists relevance_votes  jsonb,           -- {model id: 0..1}
  add column if not exists relevance_spread numeric(3,2);    -- max vote - min vote; null = single read
