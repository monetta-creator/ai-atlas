-- 0081_record_per_company.sql (2026-09-29): the public record, per company.
--
-- self_record was built for one company (the registry's `self` tier), so its
-- url was unique across the table. The Briefcase's deep packs extend the same
-- backfill to chosen peers (scripts/history-backfill.mts --company=<slug>),
-- and one article can be a record of two companies. Uniqueness moves to
-- (company_slug, url). Every reader already filters on company_slug.

alter table self_record drop constraint if exists self_record_url_key;
create unique index if not exists self_record_company_url_key on self_record (company_slug, url);
