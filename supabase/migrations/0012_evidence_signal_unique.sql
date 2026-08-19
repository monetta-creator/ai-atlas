-- 0012_evidence_signal_unique.sql — schema-enforce the signal→evidence invariant.
-- syncSignalEvidence (lib/mutations.ts) materializes exactly ONE evidence row per
-- touched claim/bridge per published signal. The discovery-pipeline analytics (the
-- getPipelineAnalytics impact rollup) and the home dashboard's "From feed to map" view
-- rely on that one-row-per-(signal,target) invariant: they read count(distinct signal_id)
-- as the touch count and count(*) filter (direction = …) as the per-direction split,
-- which only agree when there is at most one row per (signal, target). Until now the
-- invariant was application-enforced only; this makes it a hard guarantee.
--
-- Partial (where signal_id is not null) so it covers ONLY signal-sourced evidence: manual,
-- source-anchored rows (signal_id null) are untouched and may still attach the same source
-- to a target more than once. Additive; verified zero existing violations before adding.

create unique index evidence_signal_target_uniq
  on evidence (signal_id, target_type, target_id)
  where signal_id is not null;
