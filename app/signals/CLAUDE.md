# Signal Board (public feed + admin desk)

Public feed of tracked AI developments, plus the admin desk for drafts. Guests see published signals only.

## Pages
- `signals/page.tsx`: feed with lens + significance filters. Guests see published; admin also sees drafts.
- `signals/[id]/page.tsx`: one signal (touched claims/bridges). Drafts 404 for guests. Admin gets publish/edit/delete.
- `signals/new/page.tsx` and `signals/[id]/edit/page.tsx`: create/edit via `SignalForm`.
- `signals/drafts/page.tsx`: the backlog desk (mig `0055`). `DraftBacklogBar` has three judgment-free bulk cuts via `archiveDraftsBulk`: no claim touches, low significance, older than 45 days. `signals.archive_reason` records why. Then `DraftSprint`: one draft at a time (P publish, A archive, S skip, left-arrow back), touches shown with statement + direction + reason via `getSprintDrafts` + `getTargets`. Then the `DraftQueue` list + dedupe scan behind a details block.
- `signals/digest/page.tsx`: print-friendly digest, `?since/&lenses/&significance`, not in nav. Header-less, so it redirects a non-admin to the public parent.
- Every page except the public ones uses `adminGate`.

## `signals` table (mig `0004`)
- `significance` (`significance_t` high/medium/low).
- `lenses`: array of `signal_lens_t` (`market`/`labor`/`geopolitics`/`regulatory`/`capability`/`society`). A separate enum from the map's `lens_t`; don't conflate.
- `claim_touches`: `text[]` of claim/bridge codes on the row, not a join table. Resolved at read time, GIN-indexed for the reverse "signals touching this claim" query.
- `touch_details jsonb` (`0006`): `{code: {direction, reason}}`, the draft-stage detail the admin reviews. Materialized into `evidence` on publish.
- `source_id`: soft ref. `origin` (`signal_origin_t`): manual/pipeline (plus `backfill`), drives the pipeline badge.
- `published_at` is the editorial date (ordering + digest range). `is_published` is the visibility gate. Publish also materializes evidence.
- `digest_snapshots` (`0004`): audit log for the not-yet-built digest sender.

## Publishing is a gate
- `setSignalPublished` / `createSignal` / `updateSignal` call `syncSignalEvidence` (transactional), which materializes one `evidence` row per touched claim/bridge carrying `signal_id`, `lens`, `direction`, and the touch reason as `excerpt`. A signal's findings enter the Argument Map only on publish; unpublish or delete removes them.
- Every publishing writer stamps `signals.first_published_at` once and never moves it (the Daily Edition windows on it).
- Because the reason lands in `evidence.excerpt`, `getEvidenceFor` and `buildEvidenceLedger` null the excerpt on signal-anchored rows for guests.
- `resolveTouches` flags unresolved touch codes for admins (drift guard).
- Pipelines and the manual *Turn into signal* flow (`prepareSignalFromSourceAction` / `overrideAndApproveAction`) only ever create drafts, through the shared `analyzeCandidate` → `createDraftForCandidate`.

## Promotion policy (the maintainer's option B)
- Prefs on `pipeline_prefs`: `pipeline_prefs.auto_publish_high` (default on), `auto_publish_after_hours` (48), `auto_publish_from`.
- `publishDueDrafts` publishes high-significance pipeline drafts with >=1 claim touch that are still active (archive = veto) and were created at or after the policy start, so the pre-existing backlog stays a human sprint.
- It runs on every `/api/cron/pipeline` window, before the run logic (so also when the day's run is already complete), and from the bar's "Run now".
- `signals.auto_published_at` stamps policy publishes.
- Low-significance pipeline drafts archive at intake (`low_at_intake`) inside `createDraftForCandidate`.

## Rules
- Nothing the crons pull is ever deleted. Dedupe "discard" archives (`dedupe_discard`). A dedupe merge archives the losers as `dedupe_merge` (rows and candidate links survive). `mergeDraftSignals` works on unpublished drafts only.
- Archive is reversible for unpublished rows (`setSignalArchived(id, false)`). A published signal never carries `archived_at`.
- Guests: only published signals. A touched claim's confidence word and the per-touch reason (`touch_details`) are admin-only; the touch direction is public.
