-- The company intel deck (2026-09-23): a generated_reports kind built each
-- weekday after the Intel Desk's last window from what the engine stored for
-- every tracked company (tier <> 'self'), for access-key holders and the
-- admin only. Enum value first (an enum value added in a transaction cannot
-- be used by a later statement of the same transaction; the unique index on
-- it is migration 0062). Prefs ride on the intel_prefs singleton.
alter type report_kind_t add value if not exists 'intel_deck';

alter table intel_prefs
  add column if not exists deck_enabled boolean not null default true,
  add column if not exists deck_model   text    not null default 'z-ai/glm-5.3-flash';
