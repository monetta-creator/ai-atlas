-- 0025 — Author track record: the day-zero quality prior.
--
-- The review queue needed one "is this a good paper or junk" signal that exists
-- BEFORE peer review and citations: the highest h-index among the paper's authors
-- (Semantic Scholar, no key, no AI cost). A prior, not a verdict: it penalizes
-- newcomers and unlinked authors on very fresh papers (S2 disambiguation lags),
-- and it is refreshed alongside citation counts. Additive.

alter table papers add column author_hindex int;
