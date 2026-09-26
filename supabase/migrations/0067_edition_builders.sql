-- 0067: the Daily Edition's builders strip (2026-09-26). The strip judges the
-- Hacker News front page for an AI builders pod inside a large regulated
-- company; builders_steering is an optional standing note that steers that
-- judgment (null = the code default in lib/edition/builders.ts). No UI yet:
-- set by SQL when the maintainer wants to steer it.
alter table edition_prefs add column if not exists builders_steering text;
