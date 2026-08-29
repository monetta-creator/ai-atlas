# The External Scan

A weekday, cron-driven sweep of public news across configurable topics
(financial services, technology, and whatever else the topic registry names),
hydrated to full text, lightly enriched by a small model, and published as the
key-gated `external-scan` dataset. Weekends are scheduled off; Monday's run
looks back three days, so it collects the weekend's news in one larger file. The design goal: an **outside** system does the
web-facing work (discovery, fetching, tagging) and ships a clean JSON corpus a
**downstream tool in a restricted environment** imports and triages on its own
terms. Nothing here writes signals, claims, or evidence; the scan's judgment
ends at advisory tags and a relevance score.

## Architecture

Three tables (migration `0038`):

- **`scan_topics`** — the registry (the `scout_verticals` pattern): slug, name,
  description, a `taxonomy_code`, `search_queries text[]` (with `{year}`/
  `{month}` tokens resolved per run day), `feed_urls text[]`, and `active`.
  An empty `search_queries` makes a topic feeds-only; that array is the cost
  knob. `active` also controls whether the topic's code is offered to
  enrichment tagging. The REAL topic set is seeded from
  `private/scan-topics.json` (untracked) by `npm run db:seed:scan`; the
  migration ships only a generic two-topic example.
- **`scan_runs`** — one row per UTC day (`day` is unique and is the resume
  key). The row IS the checkpoint state: `step` (feeds → search → hydrate →
  enrich → complete), `searched_topics` (per-topic search checkpoints),
  counters, and `lease_until`, the overlap guard that lets two invocations
  fire without double-working.
- **`scan_items`** — one discovered item: url, `normalized_url` (the pipeline's
  canonical dedupe form), headline, source_domain, published_date,
  `discovered_via` (the topic slug for a feed item, `web_search` otherwise),
  `raw_content` + `fetched_via` + `fetch_status`, and the enrichment fields
  (`summary`, `tags`, `entities`, `relevance`, `enrich_status`). Dedupe is the
  `unique (run_id, normalized_url)` constraint within a day plus a
  check-before-insert against the trailing 14 days globally.

The step engine (`lib/scan/run.ts`) advances one bounded unit at a time,
persisting after each, under a caller-supplied deadline:

1. **feeds** — every active topic's RSS/Atom feeds in parallel
   (`lib/scan/feeds.ts`, hand-rolled parser in `lib/scan/core.ts`); free, and a
   dead feed is a note, never a failure. The discovery window is
   `lookbackDays(day)`: one day normally, three on Mondays (the weekend
   catch-up); the search leg uses the same window for its "since" date.
2. **search** — one `web_search` call per active topic with queries
   (`lib/scan/web.ts`, the scout call shape on `claude-sonnet-4-6`, one search
   per topic), checkpointed per topic; the budget is checked before each.
3. **hydrate** — `fetchCandidateText` (direct + reader fallback) in small
   waves; failures mark the item and ship it textless.
4. **enrich** — one `claude-haiku-4-5` `runStructured` call per item
   (`lib/scan/enrich.ts`): summary, taxonomy codes (allow-listed from the
   active topics), entities, relevance. Budget-capped; past the cap items ship
   with `enrich_status = 'skipped'`.

Drivers: two weekday Vercel crons (`vercel.json`, `0 9 * * 1-5` and
`0 11 * * 1-5`) hit `GET /api/cron/scan` (Bearer `CRON_SECRET`,
`maxDuration 300`, ~240s work budget per invocation; the second cron finishes
what the first could not), and the admin `/scan` console's Run/Resume button
ticks the same engine one unit at a time (a manual weekend run works and gets
the normal one-day window; Monday's overlap dedupes away).

Cost discipline: scan model calls log to `ai_cost_log` as `scan_search` /
`scan_enrich` with provenance in `metadata.scan_run` (NEVER `pipeline_run_id`,
which is FK'd to `pipeline_runs`); `checkScanBudget` (`lib/scan/budget.ts`)
sums them against `SCAN_DAILY_BUDGET_USD`. Measured day one: 9 searches
$0.70, 40 enrichments $0.22.

## The export contract

`GET /api/datasets/external-scan?format=json` (or `format=csv`) with the
portal key cookie (`/datasets/enter?k=<PORTAL_KEY>` sets it). Default is the
**latest completed day**; `?day=YYYY-MM-DD` selects a specific day (400 on a
malformed value). JSON renders inline in a browser by default; add
`&download=1` to force a saved file (CSV always downloads). The filename is
date-stamped with the day the download served
(`atlas-external-scan-YYYY-MM-DD.json`), including on the latest-completed
default. This section is the interface a downstream importer builds
against.

JSON envelope:

```json
{
  "dataset": {
    "slug": "external-scan",
    "title": "External scan, daily",
    "description": "...",
    "methodology": "...",
    "category": "scan",
    "lens": null,
    "day": "2026-08-28",
    "row_count": 43,
    "columns": [ { "key": "...", "label": "...", "type": "...", "def": "..." } ]
  },
  "rows": [ ... ]
}
```

`dataset.day` echoes the requested `?day=` filter and is `null` when the
download used the latest-completed default; read the per-row `run_day` for the
actual day either way.

Row fields (all values are string, number, or null; CSV uses the same keys as
headers, UTF-8 BOM, CRLF):

| key | type | contents |
|---|---|---|
| `item_id` | string | Stable UUID of the item. |
| `run_day` | string date | The scan day, YYYY-MM-DD (UTC). |
| `url` | string | The item URL as discovered. |
| `normalized_url` | string | Canonical dedupe form: host + path + sorted query, tracking params stripped, scheme and www ignored. |
| `headline` | string or null | Headline as reported by the feed or search. |
| `source_domain` | string or null | Hostname, www stripped. |
| `published_on` | string date or null | Publication date when known. |
| `discovered_via` | string | The discovering topic's slug for a feed item, or `web_search`. |
| `topic_slug` | string or null | The topic that discovered the item. |
| `topic_code` | string or null | Taxonomy code of that topic. |
| `summary` | string or null | Two to three model-written sentences. Null when enrichment was skipped or errored. |
| `tags` | string | Taxonomy codes enrichment assigned, joined with `; `. Empty string when none. |
| `entities` | string | Companies, agencies, people named, joined with `; `. |
| `relevance` | number or null | Advisory 0 to 1 relevance from enrichment. |
| `enrich_status` | enum | `done`, `skipped` (budget or no text), `error`, `pending`. |
| `fetch_status` | enum | `done`, `failed`, `skipped`, `pending`. |
| `fetched_via` | string or null | `direct` or `jina`. |
| `text_chars` | number or null | Character count of the retained text. |
| `full_text` | string or null | The complete retained page text, capped at 24,000 chars. |

Importer guidance: key on `item_id` (stable) or `normalized_url` (stable
across rediscovery); treat `tags`/`relevance` as advisory input to your own
triage, not verdicts; `enrich_status != 'done'` rows still carry discovery
metadata and (when fetched) full text, so import them too.

## The signals export (the contract's sibling)

`GET /api/datasets/signals-export?format=json&download=1` (key-gated, same
unlock) serves EVERY published Signal Board signal **in the external-scan row
shape**: the first nineteen columns mirror the contract above key for key
(same types, same nullability), so the same firewall intake ingests both
files unchanged. Differences are semantic, documented in its own handoff
(`buildSignalsExportHandoff`, copyable from the /scan "Firewall export"
panel):

- Full corpus every download, not a day; `run_day` varies per row (the
  signal's editorial date). Idempotent upsert on `item_id` (the signal UUID);
  a re-download is a full refresh that also picks up post-publish edits.
- `url` falls back to the signal's Atlas page when no source article is
  linked, so `normalized_url` may repeat across signals sharing one source;
  key on `item_id` for this file.
- `discovered_via` is always `atlas_signal`; `tags` carries the audience
  lenses; `relevance` encodes significance (high 0.9 / medium 0.6 / low 0.3).
- `full_text` is always present: a composed document (title, summary, the
  brief sections, counterpoint, argument-map touches with reasoning, then
  `SOURCE ARTICLE TEXT` with the retained article), capped at 24,000 chars.
- Appended signal-native columns (the contract is additive; intakes tolerate
  them): significance, lenses, origin, claim_touches, `touch_details` (a
  JSON-encoded array of `{code, direction, reason, statement}`), the three
  brief fields, counterpoint, atlas_url, source_title. The per-touch
  direction + editorial reason is admin-only in the app; the portal key is
  the boundary that lets it ride this dataset (the one scoped exception to
  the guest-safety ban, enforced in `scripts/test-datasets.mjs`).

## Operating it

- **`/scan` is the whole surface** (admin nav item "Scan"): the daily JSON
  download links, schedule and config (live from `vercel.json` plus env
  status and today's spend), the crons on/off toggle, manual Run/resume, the
  topic registry with every query and feed visible, the import contract
  rendered from the live dataset registry, and a **Copy importer handoff**
  button. The handoff (`lib/scan/handoff.ts`) is an orientation document for
  the assistant building the intake on the far side of a firewall: system
  overview and division of labor, a **formal JSON Schema (draft 2020-12)**
  for the envelope and rows generated from the registry columns plus a
  per-field facts map (nullability, enums, formats; `scripts/test-scan.mjs`
  fails if a new column misses the map), field guarantees and invariants
  (stable ids, normalization, ordering, immutability of completed days),
  status semantics, live taxonomy codes, intake design guidance (idempotent
  upsert on item_id, additive-change tolerance, drift detection via the
  envelope's columns array), and transport last.
- **Pausing vs rescheduling**: the toggle writes the `scan_prefs` singleton
  (migration `0039`); a paused scan makes cron firings no-ops while manual
  runs keep working. Cron TIMES and DAYS are deploy-time config: edit
  `vercel.json` and push (weekday-only since 2026-08-29; the Monday catch-up
  window lives in `lookbackDays`, `lib/scan/core.ts`). The health panel and
  day grid treat runless weekends as scheduled off, never as misses.
- Seed or update topics: edit `private/scan-topics.json`, run
  `npm run db:seed:scan` (upserts on slug; never touches `active`, which the
  `/scan` console toggle owns; never deletes).
- Env: `CRON_SECRET` (required for the cron route; it fails closed unset) and
  `SCAN_DAILY_BUDGET_USD` (default 1.50). Set both in Vercel and redeploy.
- Manual run/resume: the `/scan` console (admin), or
  `curl -H "Authorization: Bearer $CRON_SECRET" <host>/api/cron/scan`
  repeatedly until `"done": true`.
- Watch spend on `/costs` (features `scan_search`, `scan_enrich`); per-run cost
  shows in the `/scan` run history.
- Feed URLs 404 quietly over time as agencies restructure sites; run-history
  notes name the dead ones, and the fix is a JSON edit + reseed.
