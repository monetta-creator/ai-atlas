-- 0037: widen the signals FTS surface for Ask retrieval.
--
-- Rebuild signals.search_tsv (0027: title + summary + brief + counterpoint) to
-- also index the claim codes a signal touches (claim_touches) and the
-- per-touch direction/reason jsonb (touch_details), so retrieval matches a
-- signal whose relevance lives in its touch reasons ("supports 5.2, open-weight
-- parity") rather than in its headline prose. Generated columns cannot be
-- altered in place: drop + re-add + re-index (the 0027 pattern).
--
-- array_to_string(anyarray, text) is only STABLE in Postgres, so a generated
-- column cannot call it directly; the wrapper below is declared IMMUTABLE,
-- which is safe here (its output depends only on its text[]/jsonb inputs).

create or replace function atlas_touch_text(touches text[], details jsonb)
returns text
language sql immutable as
$$ select coalesce(array_to_string(touches, ' '), '') || ' ' || coalesce(details::text, '') $$;

drop index if exists signals_search_idx;
alter table signals drop column search_tsv;
alter table signals add column search_tsv tsvector
  generated always as (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' ||
    coalesce(brief->>'what_happened', '') || ' ' || coalesce(brief->>'why_it_matters', '') || ' ' ||
    coalesce(brief->>'whats_contested', '') || ' ' ||
    coalesce(counterpoint->>'the_other_read', '') || ' ' ||
    atlas_touch_text(claim_touches, touch_details))) stored;
create index signals_search_idx on signals using gin (search_tsv);
