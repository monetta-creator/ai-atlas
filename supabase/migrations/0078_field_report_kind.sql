-- 0078_field_report_kind.sql (2026-09-28): the Field Report kind, split from
-- 0079 because a new enum value cannot be used in the transaction that adds it.
alter type report_kind_t add value if not exists 'field_report';
