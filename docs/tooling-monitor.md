# The AI Tooling Monitor

Route `/tooling`. The eighth portal: a market scanner for AI tools, built for an AI-transformation team in corporate strategy at a large regulated financial-services company. It answers four questions: what is on the market, how does the market dimensionalize, who just entered, and should we build or buy.

Shipped 2026-09-17 (migration `0054`). Code lives in `lib/tooling/*`, pages in `app/tooling/*`, components in `components/tooling/*`, data reads in `lib/data/tooling.ts`, writers in `lib/mutations/tooling.ts`, server actions in `lib/actions/tooling.ts`.

## What it is not

Not a Scout extension. Scout's `companies` table carries M&A semantics (funding-stage enum, pursue/watch/pass verdicts, a youth screen that excludes incumbents, a global dedupe with no scope key, and disclosure defaults that hide the funnel). A market monitor wants incumbents and big tech in the same table as a two-person startup, scores products rather than acquisition targets, and shows its evaluations to the team. So: own tables, Scout's pure helpers copied and adapted (`lib/tooling/core.ts`), and the Intel Desk's engine spine (day-keyed run row, lease, swept units, notes).

## Access

| Viewer | Sees | Can do |
|---|---|---|
| Guest | Cataloged products, their facts, features, dossier summary, events, published tooling reports | Browse, search, filter |
| Portal keyholder | Guest view plus parked and candidate products, the agent read (fit, scores, reason), deep dives, unpublished tooling reports | Add a product, run a deep dive (budget-gated), generate reports |
| Admin | Everything, including review notes, raw text, provenance | The console: engine runs, prefs, categories, curation, datasets |

Column lists in `lib/data/tooling.ts` (`PRODUCT_PUBLIC_COLUMNS`, `PRODUCT_PORTAL_COLUMNS`, `PRODUCT_ADMIN_COLUMNS`) enforce this at the SELECT, not in the UI. `getProduct(slugOrId, viewer)` returns null for a status outside the viewer's set, so a parked product's slug 404s for a guest.

`proxy.ts` allow-lists `/tooling` and `/tooling/*` except `/tooling/console`. Portal keyholders carry no `atlas_*` session cookie, so `/tooling/reports` renders an inline "team key required" panel instead of bouncing to `/login`.

## Data model (migration 0054)

- `tooling_categories`: the curated registry. `slug`, `name`, `description`, `search_queries` (weekly, news-shaped, `{year}`/`{month}` tokens), `pull_queries` (evergreen), `hn_query`, `github_query`, `active`, `sort_order`. The migration ships a generic starter set; the real list seeds from the untracked `private/tooling-categories.json` via `npm run db:seed:tooling`. Query columns are admin-only at read time.
- `tooling_products`: library and funnel state on one row. Identity: `slug` (readable, unique, generated once), `name_key` (generated), `url_key` (normalized host + path, unique where not null), `vendor_domain`. Facts: category, one-liner, description, target buyers, deployment, pricing model, maturity, founding year, HQ, funding note, notable customers, integrations, compliance claims, models used, `features` (normalized free-form tags), feed and changelog URLs. Curation: `status` (candidate, cataloged, parked, dismissed), `pinned`, `review_note`, `reviewed_at`. Agent: `agent_fit` 0-100, `agent_scores`, `agent_reason`, `agent_model`, `agent_at`. Fetch cache: `raw_content`, `fetched_via`, `fetch_error`. Enrichment: `enriched_at`, `enriched_by`, `dossier` (monotone merge), `deep_dive`, `deep_dived_at`. Provenance: `origin`, `found_url`, `found_title`, `run_id`, `first_seen`, `last_seen`. `search_tsv` indexes name, vendor, one-liner, description, features and category (partial GIN on cataloged and parked).
- `tooling_events`: per-product timeline (launch, funding, feature, pricing, partnership, news, changelog, note) with `source` (feed, deepdive, discover, manual). `note` is working provenance and never exported.
- `tooling_runs`: one row per `(kind, day)`; `kind` is `weekly` (day = the Monday UTC) or `pull` (day = the start day). Step, swept units, counters, `report_id`, lease, notes.
- `tooling_prefs`: singleton. `enabled` (gates the cron only), `steering`, `rubric`, `utility_model`, `enrich_model`, `catalog_threshold` (60), `deep_dive_threshold` (75), `deep_dive_cap` (15), `auto_publish_entrants` (true).
- `report_kind_t` gained `tooling_landscape`, `tooling_brief`, `tooling_entrants`, `tooling_features`.

### The dedupe rule

`insertProducts` (one transaction): match on `url_key` first; otherwise `name_key` equal AND (`vendor_domain` equal or either side null). A match bumps `last_seen` and logs a `news` event if the found URL is new; facts are untouched. Dismissed products never re-enter. A triaged product URL on a news or aggregator host (`isNewsHost`) is rejected, so the hit URL lands in `found_url` and the product row has no homepage until enrichment or a human supplies one.

### Human decisions are sticky

The scorer writes `status` only where `status = 'candidate' and not pinned`. A cataloged product is never demoted by the agent; a pinned product is never rescored. Admins can move any product between statuses, pin it, annotate it, and bulk "rescore parked" after changing the rubric.

## The engine

`lib/tooling/engine.ts` `advanceToolingRun(runId, deadlineAt)` is the intel loop: re-read the run row each iteration, renew the lease, do one bounded unit, mark it swept, continue; on exit persist notes and release the lease. Every model call carries `metadata.tooling_run`, which is what the per-run budget sums.

| Step | Unit | Work |
|---|---|---|
| discover | `cat:<slug>` | Tavily (weekly: one query rotated per ISO week, news, 7 days; pull: up to three evergreen queries, general, undated) + Hacker News (Algolia) + GitHub search, merged, then one cheap-model triage call extracting distinct AI products, then `insertProducts` |
| discover | `ph` | Product Hunt AI-topic posts (only when `PRODUCTHUNT_TOKEN` is set; their API terms restrict commercial use), redirects resolved, triaged |
| discover (pull) | `enum:<slug>:leaders`, `enum:<slug>:emerging` | Sonnet with web search enumerates the established products, then the recent entrants, per category |
| hydrate | page of 4 | `fetchCandidateText` on the homepage, 24k chars, 15s; failures stamp `fetch_error` and retry after 6 days |
| enrich | page of 12, pool 3 | Structured extraction on the enrich model (GLM-5.3-flash by default): facts fill only nulls, features are normalized, the dossier merges monotonically |
| score | chunk of 10 | The rubric on the utility model (qwen flash by default): fit 0-100, five 1-5 dimensions, up to three features worth stealing; candidate becomes cataloged at or above the threshold, else parked; a product whose homepage never fetched is always parked |
| finish | page of 8 | For newly cataloged products: the pricing page appended to the retained text, and the homepage HTML scanned for an RSS or Atom link |
| events | page of 12 | Vendor feeds polled for products with a feed URL, new items since `last_seen` become changelog events |
| deepdive | `dd:<id>` | Sonnet with web search (three uses) on cataloged products first seen this run with fit at or above the threshold, best fit first, capped by the pref; skipped when the run budget trips |
| report | `report` | Weekly only: the entrants pack for the week, two Sonnet narrative legs, saved and (by default) published |

Budget: `checkToolingBudget(runId, kind)` sums the run's cost rows against `TOOLING_WEEKLY_BUDGET_USD` (4) or `TOOLING_PULL_BUDGET_USD` (12). A trip skips the remaining deep dives, any remaining enumeration units, and the report; the run still completes. A failed enrichment or scoring call leaves the row untouched for the next invocation (the loop skips it in memory so the window is not spent re-trying it).

Cost model at design volumes: weekly (16 categories, ~40 new candidates, 15 deep dives) about $2 and ~1,100s of wall clock; the big pull (16 categories, two enumeration passes, ~400 candidates) about $5 without deep dives and about $7 with the 15-cap, ~5,400s of wall clock.

## Crons and drivers

`vercel.json`: `/api/cron/tooling` Monday 07:00 UTC, `/api/cron/tooling/sweep` 08:20 UTC, `/api/cron/tooling/sweep2` 17:00 UTC (after the daily engines' last windows). Each carries `maxDuration 800` with a 700s work budget, Bearer `CRON_SECRET`, and returns `alreadyComplete`, `busy`, or the progress as data. `prefs.enabled` pauses the weekly cron only.

The big pull has no cron. Start it from the console ("Start the big pull"), then either keep the console open (the tick loop advances one unit per 5s slice, 400-tick cap) or push it headlessly:

```
for i in 1 2 3 4 5 6 7 8; do
  curl -s -H "Authorization: Bearer $CRON_SECRET" "https://<host>/api/cron/tooling?kind=pull"; echo
done
```

Each hit does up to 700s of work and returns `{done: true}` when the run completes. Never smoke-test the cron routes between 00:00 and 09:00 UTC (the standing rule for every day-keyed engine).

## Sources

- Tavily: `topic 'news'` with `days 7` for the weekly run; `topic 'general'` with no window for the pull (Tavily ignores `days` outside news). Every call logs a $0 cost row with `metadata.queries` so the monthly quota tile counts it.
- Hacker News (Algolia, no key): weekly `search_by_date` on stories and Show HN since seven days with more than 10 points; pull relevance search with more than 50 points.
- GitHub (optional `GITHUB_TOKEN`): weekly `pushed:>7d stars:>200 <keywords>`; pull `stars:>500 <keywords>`; one request per category.
- Product Hunt (`PRODUCTHUNT_TOKEN`): the AI topic, newest first, two pages. The `website` field is a Product Hunt redirect and is resolved (HEAD, three hops, SSRF-guarded) so the dedupe sees the vendor's real host.
- Vendor feeds: RSS or Atom links discovered from the homepage HTML at finish time, editable on the product.

## Reports

Four kinds on the shared `generated_reports` table, generated from `/tooling/reports` (portal) or by the weekly cron (entrants):

- **Tooling landscape**: a category on chosen dimensions (deployment, pricing, maturity, compliance, buyer, integrations) for an audience (executive, engineering, procurement). Sections: The field, Where the gaps are, Watch.
- **Build or buy brief**: a capability in the team's words, optional category, and an internal context note. Sections: What the market offers, Build or buy, Risks and next steps. The internal context rides in the pack under `internal` and renders only for admins and keyholders; the narrative is told to use it without quoting it. This kind never auto-publishes, and publishing makes the narrative public.
- **New entrants**: products first seen in a window (the cron uses the seven days ending on the run day), plus moves on cataloged products. Sections: New this week, Moves on tracked products, Watch. The Monday cron writes and publishes one per week (`auto_publish_entrants`).
- **Feature sheet**: the feature matrix of a category, novelty flagged. Sections: Features worth stealing, Who does what, Watch.

The mechanics mirror the research roundup: `lib/tooling/reports.ts` builds a guest-safe pack, two Sonnet `runStructured` legs write sections and the bottom line, `enforceCitations` gates every link to the pack's product pages and URLs, and `SheetReadView`, the PDF and the portal row branch on the kind. Unpublished tooling reports are readable by keyholders.

## Datasets

Key-gated: `tooling-products` (every non-dismissed product with the agent read, dossier summary, customers and sources; never review notes or raw text), `tooling-events` (no notes), `tooling-features` (long table, product by feature). Public: `tooling-catalog` (cataloged products, descriptive columns only). The console's "Copy importer handoff" produces the orientation doc (`lib/tooling/handoff.ts`) with each dataset's JSON Schema, join keys, the live category roster, and intake guidance.

## Console

`/tooling/console` (admin): run or resume this week's run, start the big pull, prefs (enabled, thresholds, cap, auto-publish, models, steering, rubric), the category manager, the curation queue (unreviewed entrants, parked, candidates; bulk catalog, park, dismiss, mark reviewed, rescore), run history with notes and spend, the Tavily quota line, dataset downloads and the handoff button, and the enrichment model A/B by `enriched_by`.

The nav badge counts cataloged products first seen in the last seven days that nobody has marked reviewed.

## Verify after the first Monday

Every unit swept in order, the entrants report published on `/reports` with `tooling_runs.report_id` set, `tooling_*` rows in `/costs`, the Tavily quota tile counting the queries, no product cataloged with `raw_content` null, and the second and third windows returning `alreadyComplete`.
