-- Company intel deck: default the sentence model to Haiku.
--
-- Measured 2026-09-23 on the live pack (24 companies): GLM-5.3-flash needed
-- 61s and 77s for a 12-company batch and hit the 75s/90s timeouts on the
-- first attempt each time, so the deck kept publishing without its one-line
-- reads. Haiku answers the same forced-tool call in a fraction of that for
-- about two cents a day. The pref stays editable on /intel; only the default
-- and the still-default rows move.

alter table intel_prefs alter column deck_model set default 'claude-haiku-4-5';

update intel_prefs set deck_model = 'claude-haiku-4-5' where deck_model = 'z-ai/glm-5.3-flash';
