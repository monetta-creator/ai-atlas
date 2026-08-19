-- 0024 — Plain-language paper summary at triage.
--
-- The review queue showed only the triage RELEVANCE reason ("why this survived"),
-- which is not enough to decide track/note/dismiss: the admin also needs "what
-- does this paper actually claim and show" in plain language. Triage already
-- reads the abstract, so it now writes a 1-2 sentence summary for kept papers.
-- Additive, no backfill in SQL (a one-time script summarizes the live queue).

alter table papers add column triage_summary text;
