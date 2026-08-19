-- 0022 — Cached signal analysis.
-- Two AI-generated artifacts the admin produces once per signal and everyone reads:
--   brief        — the deep-dive briefing that expands the one-paragraph summary
--                  (what happened / why it matters / what's contested / what to watch).
--   counterpoint — "the other read": the opposing interpretation + what would deflate it.
-- Both are editorial narration grounded in the signal's source + touched claims (no
-- personal layer), so they are public reads like signals.summary. Mirrors the
-- jsonb-on-the-row pattern of sources.dossier; written by lib/mutations.setSignalAnalysis.
-- RLS is already enabled on `signals` (deny-by-default, app role bypasses); new columns
-- inherit it, so no policy change is needed.
alter table signals add column if not exists brief jsonb;
alter table signals add column if not exists counterpoint jsonb;
