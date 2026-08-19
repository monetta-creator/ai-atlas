# The core loop

How the AI Atlas turns published material into a position you can defend, and how
that position stays current.

Four surfaces carry the loop. Material enters at the **Signal Board**. It lands on
the **Claims & Theses** map as evidence against falsifiable statements. **Ask the
Atlas** reads that corpus back as cited answers and checks its own work. The
**Report Portal** freezes a slice of it into a document you can hand to someone.

Each section below is written three times, at three altitudes:

- **The product view.** What it does, in plain language.
- **How it works.** The mechanics, for someone who will operate or explain it.
- **The specification.** Schema, functions, constants, and guarantees, for someone
  who will extend it or audit it.

---

## 1. The Signal Board

### 1.1 The product view

The Signal Board is the feed of tracked developments. Every item is a real thing
that happened, with a link to its source, sorted by which audience it speaks to
and how much it matters.

Two doors lead into it. A **discovery pipeline** searches the web on demand and
proposes what it found. A **manual upload** lets you drop in a PDF or a link you
already care about. Both doors open into the same room: whatever comes in is a
draft that a person reads and publishes, or does not.

The publish click is the moment that matters. Publishing a signal does more than
make it visible. It files the signal's findings as evidence against the specific
claims it bears on, which is what makes the rest of the system move. Nothing
reaches the argument map without a person putting it there.

### 1.2 How it works

**The automatic path** runs as a sequence of short, checkpointed steps rather
than one long job, so a run can be stopped and resumed and a failure costs one
step instead of the whole run.

1. **Discovery.** For each audience lens, a web-search call returns candidate
   URLs with titles and one-line reasons. A second, lens-agnostic sweep looks for
   the period's biggest developments over a curated outlet list, on the theory
   that significance and lens-fit are different questions.
2. **Triage.** Candidates are scored in chunks against the run's brief: approve,
   reject, or mark duplicate. A URL already present as a manual source or a prior
   draft is marked duplicate before anything is spent on it. A major development
   from a weak outlet can still be approved under a materiality override.
3. **Hydration.** The approved candidate's text is fetched and cached. Direct
   fetch first, PDF extraction where needed, and a reader fallback for hosts that
   block automated retrieval. Failures are classified as terminal or transient so
   a retry is only attempted where it could work.
4. **Analysis.** One model call per candidate drafts the signal: title, summary,
   brief, significance, lenses, and the claims it touches with a direction and a
   reason for each touch.
5. **Coverage check.** After the run, a separate pass re-derives the period's
   biggest developments in independent wording and marks each as covered or
   missed against what the run actually produced. This is advisory. It grades the
   run without changing it.

The pipeline also learns where not to look. Domains that have produced candidates
for 90 days without a single approval or duplicate are added to the blocked list
for future searches, with an allowlist protecting primary sources and wires from
ever being auto-blocked.

**The manual path** skips discovery and triage's search half. An uploaded source
enters the same funnel as a pre-approved candidate, so a hand-picked document and
a machine-found one produce a draft signal by the identical code path. There is no
separate manual editor and no second set of rules.

**Publishing** materializes evidence. For every claim code the signal touches, the
system writes one evidence row carrying the direction the model proposed, the
reason as an excerpt, and the audience lens. Unpublishing removes those rows.
Evidence and publication state stay consistent because one function owns both.

### 1.3 The specification

**Tables.** `signals` holds the feed: `significance significance_t`
(high/medium/low), `lenses signal_lens_t[]` (a separate enum from the argument
map's `lens_t`), `claim_touches text[]` carried on the row and GIN-indexed for the
reverse lookup, `touch_details jsonb` shaped `{code: {direction, reason}}`,
`published_at` (editorial date, drives ordering) distinct from `is_published`
(visibility gate), and `origin signal_origin_t` (manual/pipeline).

`pipeline_runs` and `signal_candidates` are the run's checkpoint state, which is
what makes runs resumable. `pipeline_runs` carries `status run_status_t`,
`step run_step_t` (discovery/triage/analysis/complete), `cadence run_cadence_t`
(manual/daily/weekly/source), and `coverage jsonb`. `signal_candidates` carries
`triage_status triage_status_t`, `analysis_status analysis_status_t` tracked
independently of triage, `unique (run_id, url)`, `fetched_via` (direct/jina), and
`source_id` set when the candidate originated as a manual upload.

**Discovery** (`lib/pipeline/web.ts`). `searchCandidates` is a standard
`messages.create` on `claude-sonnet-4-6` with the GA `web_search` tool
(`web_search_20250305`, no beta header) plus a `submit_candidates` client tool.
One lens batch per invocation, at most 3 searches, roughly 45s. `searchBreakingSweep`
is the significance-first variant over a curated `allowed_domains` list. Every
entry in that list must be crawlable by Anthropic's agent or the API returns 400,
which rules out most major wires and papers. Run-static prompt halves live in the
cached system block.

**The learning loop** (`getZeroYieldDomains` in `lib/data.ts`) selects domains
over a trailing 90-day window `having count(*) >= threshold and count(*) filter
(where triage_status = 'approved' or triage_reason like 'unanalyzable:%') = 0 and
count(*) filter (where triage_status = 'duplicate') = 0`. Duplicates count as
yield, since finding something already tracked is evidence the domain is useful.
The 90-day window lets a block decay.

**Fetch layer** (`fetchCandidateText`). Direct HTML or PDF retrieval with `unpdf`
extraction, NUL and control-character sanitization, `MAX_DOWNLOAD_BYTES` of 20MB,
a `TERMINAL_HTTP` set of `{400, 401, 402, 403, 404, 405, 406, 410, 451}`, a
`NO_FALLBACK_HTTP` subset that skips the reader retry, and an `r.jina.ai` fallback
for bot-walled hosts. `JINA_API_KEY` lifts the keyless rate limit.

**Triage** (`lib/pipeline/triage.ts`). `TRIAGE_CHUNK = 40` candidates per
structured call.

**Analysis** (`lib/pipeline/analysis.ts`). `analyzeCandidate` is the single signal
proposer for both the pipeline and the manual flow. Split across two server
invocations, `hydrateCandidateAction` then `analyzeCandidateAction`, so the fetch
and the model leg each fit comfortably inside the function budget.

**Coverage** (`lib/pipeline/coverage.ts`). `runCoverageCheck` on
`claude-sonnet-4-6`, `MAX_TRACKED_LINES = 600`, persisted to
`pipeline_runs.coverage` as `{since, checked_at, developments:[{headline, url,
covered, matched}]}`. Advisory only, never mutates the run.

**The publish gate** (`syncSignalEvidence` in `lib/mutations.ts`, transactional).

```
delete from evidence where signal_id = $1
if (!publish) return
resolve every code in claim_touches to (type, id) in one union query
for each code:
  direction = touch_details[code].direction if in {supports, contradicts, neutral}, else 'neutral'
  insert evidence (signal_id, source_id, target_type, target_id,
                   direction, 'medium', reason, lens)
```

A code that no longer names a live claim or bridge is skipped rather than failing
the transaction. `lens` is the signal's first lens as a representative value.
Weight is fixed at `medium` for signal-derived evidence; hand-entered evidence
carries its own weight. `evidence.signal_id` is `on delete cascade`, so a finding
dies with its signal.

---

## 2. Claims & Theses

### 2.1 The product view

This is where the argument lives. A **claim** is a statement that could turn out
to be wrong, and it is required to say what would prove it wrong. A **thesis** is
your hypothesis in plain language, the way you would say it in a meeting.

You write a thesis. The system proposes which claims it stands on. You confirm the
mapping, and from then on the thesis has a spine: a set of claims, each carrying
its own evidence for and against, each with a confidence value that moves as
material arrives.

Confidence only moves when a person moves it, and only with a written reason. That
reason is kept forever, next to the old value and the new one. Months later you can
read why your view changed and what changed it.

The system also argues with you about what is missing. A gap scan reads your thesis
and the claims it maps to, finds the recent material that touches none of them, and
proposes the claims your argument depends on but does not yet have. It proposes.
You commit.

### 2.2 How it works

**The object model.** Questions sit at the top. Stances are the candidate answers
to a question. Claims bear on stances through typed edges. Bridge-claims are
first-class objects linking two domains, fed by the claims beneath them. Frames
organize other claims and are held apart from evidence entirely, since a frame is
a way of cutting the problem rather than a statement that could be false.

**Confidence** is stored as a number and displayed as a word, so the interface
never implies more precision than the evidence supports. The word is computed by
the database, not the application, so every surface agrees.

**The human gate** is one transaction. It reads the current confidence, writes the
new one, records a rationale row carrying both values and the required reason plus
an optional citation to the specific evidence that caused the move, and snapshots
the confidence of every node in the system. The snapshot is what makes the
calibration view possible: you can scrub back to any past state and see what you
believed then.

**Authoring a claim** requires wiring it into the graph. The form takes the
statement, the falsification test, and the edges to the stances it bears on and
the bridges it feeds. A model can suggest that wiring, and a live preview shows the
proposed node on the real question map before anything is written. The write
refuses a dangling edge and requires at least one stance, so every node has a home.
New nodes start neutral, and the first confidence move records its own reason.

**Theses** map to claims through a recommend-only call: the model proposes codes
with a one-line justification each, and only the confirmed set is written. An empty
mapping is a valid outcome; the report then runs on text matches and says so.

**The gap scan** is deliberately reluctant. Every recommendation must cite the
material that grounds it or it is dropped before you see it. Recommendations are
capped, checked for novelty against existing nodes, and returning nothing is a
normal result. Starting a draft from a recommendation pre-fills the authoring form
from the persisted scan, and creating the claim maps it onto the thesis and clears
the recommendation.

### 2.3 The specification

**Schema.** `claims` carries `statement`, a stable `code`, `test`, `domain`,
`confidence numeric(3,2)` bounded 0 to 1, and `is_frame`. Two constraints enforce
falsifiability:

```sql
constraint claims_test_required   check (is_frame = true or (test is not null and length(btrim(test)) > 0)),
constraint claims_domain_required check (is_frame = true or domain is not null)
```

`confidence_label` is a generated column over `conf_label(numeric)`:

| Range | Label |
|---|---|
| `< 0.40` | thin |
| `< 0.60` | contested |
| `< 0.80` | leaning |
| otherwise | settled |

`lib/db.ts` registers `pg.types.setTypeParser(1700, parseFloat)` so numerics
arrive as JS numbers rather than strings, since they feed sliders and `toFixed`.

`edges` is the polymorphic argument graph: `(from_type, from_id) -> (to_type,
to_id)` with `relation` in `{supports, contradicts, depends_on, organizes}` and
`*_type` in `{stance, claim, bridge_claim}`. `bridge_claims` are their own table
with `domain_from`, `domain_to`, their own `test` and `confidence`.

`evidence` is polymorphic over `target_type`/`target_id` and carries provenance
through `source_id` (manual ingest) and/or `signal_id` (publish-time
materialization), both nullable with a CHECK requiring at least one.

`theses` carries `statement`, `claim_codes text[]` (stable codes resolved at read
time), `mapping_note`, `status thesis_status_t`, and `gap_scan jsonb`.
`thesis_reports` is insert-only with `pack jsonb`, `narrative jsonb`, and
`signal_ids uuid[]` which is what makes run-to-run deltas computable.

**The human gate** (`moveConfidence`, `withTx`):

```
select confidence from <table> where id = $1     -- old value
update <table> set confidence = $1 where id = $2
insert into rationales (target_type, target_id, old_confidence,
                        new_confidence, reason, evidence_id)
snapshotOnClient(c, 'post_commit')               -- all claims (is_frame=false),
                                                 -- stances, bridge_claims,
                                                 -- positions_crosscutting
```

All four steps share one transaction. A confidence value cannot exist without its
rationale row, and no snapshot can disagree with the state that produced it.
`lib/actions.ts` rejects an empty reason before this is reached.

**Authoring writers.** `createClaimWithEdges` / `createBridgeWithEdges` resolve
edge codes to ids inside one transaction and refuse a dangling edge, since `edges`
carries no foreign key. A claim must bear on at least one stance. New nodes are
created at `0.50`.

**Gap diagnosis.** `lib/argument-gaps.ts` runs map-wide and is report-grounded: it
reads the latest reports plus recent published signals, weighting those touching no
existing claim. `lib/thesis/gaps.ts` runs thesis-scoped over the thesis text, its
mapped claims in full, and the pack signals matching the thesis but touching none
of its claims. Both pass through `validateGapRecommendations` in the pure
`lib/gaps-core.ts`, with `requireRef: false` for the thesis scan whose grounding
can legitimately be the thesis's own uncovered leg. Scans persist to the
`argument_gap_scan` singleton or `theses.gap_scan` and are reconciled against live
codes on read, so a recommendation whose code has since become a real claim never
resurfaces.

**Leak discipline.** `getThesisTreeData` is an admin-only caller and confidence
must be stripped before any thesis view reaches a guest. The personal layer is
removed server-side in `lib/data.ts` (`strip`, `stripClaim`, `getEvidenceFor`)
rather than hidden in the client, so it never enters the RSC payload.

---

## 3. Ask the Atlas

### 3.1 The product view

Ask a question in plain language and get an answer built only from records the
system actually holds, with every statement pointing at the record behind it.
Click a citation and the record opens in a panel beside the answer. Click again
and you can read the retained text of the original article, with your question's
terms highlighted.

Then you can ask the system to check its own answer. It re-reads every record it
cited and reports which statements the records support and which they do not,
statement by statement. Problems are shown to you as flags. Nothing is silently
corrected, and no flag is hidden.

The check earns its place by failing usefully. It has caught a wrong figure, a
fabricated quote, and a claim attributed to the wrong source, and it flags figures
that appear nowhere in the cited records even when the surrounding reasoning is
sound.

### 3.2 How it works

**Retrieval is lexical and structural rather than vector-based.** Two things are
assembled for every question:

1. **A skeleton** of every citable record in the system, one short line each,
   prefixed with the exact citation token to use. The model sees the complete
   valid-ID namespace on every single call, so it can only cite a string it has
   already been shown.
2. **Deep detail** for the records the question actually matched: full-text search
   over the text-heavy columns, exact code and slug lookups for identifiers named
   in the question, and one-hop neighbour expansion so a question about a claim
   also carries its evidence and the signals touching it.

Embeddings were considered and set aside. The citable corpus is small enough that
the entire namespace fits in the prompt, which removes the vector infrastructure
and the per-query embedding round trip from a latency-sensitive path, and gives a
stronger guarantee than similarity search does: an ID the model has not been shown
cannot be produced.

**Answers carry stable citation tags.** Signals and papers mint numbered tags on a
shared counter. In a multi-turn conversation the client sends its accumulated
offset so tags issued in an earlier turn keep pointing at the same record, and a
rediscovered record keeps the tag it already had.

**Deep research** is the same corpus reached through a bounded agentic loop. The
model searches, fetches specific records, and searches article text across several
rounds, then is forced into writing the answer with tools disabled. Every step it
takes is streamed to the reader as a research trail.

**Verification runs in two layers.** The first is deterministic and involves no
model: quoted spans and numeric values in the answer are extracted and matched
against the literal text of everything gathered. A quote that does not appear is
reported. A figure whose digits appear nowhere in the corpus is reported. This
layer cannot be talked out of its result.

The second layer is a model pass over the same conversation, forced through a
tool that returns per-statement verdicts: how many citation-bearing statements
were examined, and one flag per problem with the statement's opening words and a
one-sentence description of what the record actually says. It runs over the cached
conversation, so it re-reads the records rather than re-fetching them.

Deep answers are always checked. Quick answers are checked on request. Answers
informed by web search skip the check, since web facts sit outside the corpus and
would flag as unfound.

### 3.3 The specification

**Context assembly** (`lib/ask/retrieve.ts`, `buildAskContext`). `MAX_DETAIL =
6500` characters for the deep-detail blob, `FIELD_CAP = 600` characters per long
field so no single record can crowd out the rest.

Query construction matters more than it looks. `websearch_to_tsquery` ANDs every
term, which means a long natural-language question rarely matches any single
record. The fix is to OR-combine the lexemes while keeping rank ordering:

```sql
replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery
```

`ts_rank` still orders records matching more of the terms first, so recall improves
without precision collapsing.

**Search surface** (`lib/ask/search.ts`). `searchAtlas(q, query, {kinds, limit,
admin, tagFor, paperTagFor})` over `PeekKind` in `{claim, bridge, stance,
question, concept, signal, paper, thread}`, per-kind limit clamped to
`min(8, max(1, limit))`. Snippets are whitespace-normalized and truncated (200
characters by default). `fetchRecord` backs both the peek panel and the deep loop's
fetch tool. Signal rows are filtered `and is_published = true` unless the caller is
admin, applied in SQL rather than after the fact.

**Modes.** `admin` may include the personal layer. `portal` is guest-safe by
construction: personal columns are nulled in the SQL projection, signals are
published-only, evidence is excerpt-only. The article-excerpt leg surfaces text
only through a published signal or a publicly cited source, so it is safe in
either mode.

**Quick path** (`app/api/ask/route.ts`). `claude-haiku-4-5`, `max_tokens: 1500`,
system block marked `cache_control: {type: 'ephemeral'}`, `maxDuration = 60`.

**Deep path** (`app/api/ask/deep`, `lib/ask/deep.ts`, `maxDuration = 300`):

| Guard | Value |
|---|---|
| `MAX_ROUNDS` | 4 |
| `MAX_CALLS_PER_ROUND` | 6 |
| `RESULT_CAP` | 1500 characters per tool result |
| `INPUT_TOKEN_CAP` | 40,000 |
| Wall deadline | 280s, with a 60s reserve for the final answer |
| Tags | `TAG_RE = /^[SP]\d{1,4}$/i` |

Tools are `search_atlas`, `fetch_record`, `search_articles`, all backed by
`lib/ask/search.ts`. The final answer is forced with `tool_choice: none`. The
protocol is NDJSON with `status`, `delta`, `verify`, `error`, and `done` lines;
the `done` line carries the tag map. A rolling cache breakpoint on the newest tool
results keeps a full session at roughly two cents.

**Layer 1, deterministic** (`runDeterministicChecks(answer, corpus)`):

```
hay      = normalize(corpus.join('\n'))
quotes   = extractQuotes(answer)
missing  = quotes.filter(t => !(hay.includes(t) ||
                                (t.length > 60 && hay.includes(t.slice(0, 60)))))
           .slice(0, 6)
hayCores = every /\$?\d[\d,]*(?:\.\d+)?%?/ match in hay, stripped of $ , %
numbersMissing = extractNumbers(answer).filter(n => !hayCores.has(n)).slice(0, 6)
```

The 60-character head match exists so a long quote clipped by a record's own
ellipsis still passes while wholesale fabrication does not. Number comparison
strips currency, thousands separators, and percent signs so `$1,200` and `1200`
are the same value. Both miss lists are capped at 6 entries for display.

**Layer 2, model** (`VERIFY_TOOL` / `submit_verification`). Forced single-tool call
returning `{checked: integer, flags: [{excerpt, issue}]}`, where `excerpt` is at
most 120 characters of the offending statement's opening and `issue` is one
sentence on what the record actually says. The verifier's system prompt forbids
rewriting the answer, adding outside information, and em dashes. It is skipped when
the deadline is near, and layer 1 results ship regardless.

**On-demand check** (`app/api/ask/verify`, admin-gated, off the proxy allow-list,
`maxDuration = 60`, feature slug `ask_verify`). Takes the finished answer plus its
frozen signal map, fetches every cited record via `fetchRecord`, runs both layers,
and persists through `store.setMessageVerify`, roughly half a cent per check.

**Document viewer** (`GET /api/ask/doc?signal=<uuid>`). Allow-listed in the proxy
but gated in-route by `isPortal()`, returning 401 otherwise; drafts are admin-only.
Text resolves as `coalesce(sources.raw_text, newest candidate raw_content)` capped
at 200k characters. Highlights are built as React `<mark>` nodes, never via
`innerHTML`.

---

## 4. The Report Portal

### 4.1 The product view

The Report Portal is where the corpus becomes a document. Pick a subject and a
scope, and the system produces a written, cited report with a branded PDF: a tear
sheet on one claim, a deep report on one audience lens, an executive briefing on
the whole map, a period report across a date range, or a thesis report re-run
against current evidence.

The numbers in a report are counted, not written. The model receives a frozen set
of facts and writes prose over it, so a figure in a report can be traced to the
rows it came from. Every link in that prose is checked against the set of records
the report is allowed to cite, and a link outside that set is stripped before you
ever see it.

Reports say what they do not know. A report on thin evidence says so. A report
where all the evidence points one way says that this may reflect coverage rather
than reality. Re-running a thesis report tells you what arrived since last time,
which is what turns a document into a tracked position.

### 4.2 How it works

**The pack comes first.** Before any model call, a deterministic builder assembles
the evidence and computes every statistic in code: evidence totals by direction and
by weight, the signals touching the subject, their date span, quarter buckets, and
the coverage warnings. This pack is guest-safe by construction, since the columns
that carry the personal layer are never selected into it. The same pack is stored
with the report, so the numbers in a saved report can be re-derived and compared to
what was rendered.

**The narrative is written in two passes** over that frozen pack: one for the body
sections, one for the closing bottom line. Both are single structured calls with a
tight timeout and no in-call retries, because the orchestrator retrying on a fresh
invocation is cheaper and more predictable than a hung call.

**The citation gate** runs on the generated HTML. Every anchor is checked against
an allowlist of hrefs built from the pack. An allowed link keeps its href and is
recorded as a citation. A link outside the allowlist is downgraded to a plain span
and recorded as dropped. The gate runs at generation, again at save, and again at
render, so a report cannot acquire an uncited link at any stage.

**Publication is a human gate**, matching the signal convention. A generated report
is a draft until a person publishes it, and publication is what lists it on the
public shelf and opens its PDF.

**Saved reports are immutable.** Re-running produces a new row rather than editing
the old one, which is what makes the delta between runs meaningful and what keeps a
public link pointing at the document that was actually shared.

### 4.3 The specification

**Tables.** `generated_reports` (migration 0030) holds the three new kinds:

```sql
create type report_kind_t as enum ('claim', 'bridge', 'lens', 'atlas');

create table generated_reports (
  id           uuid primary key default gen_random_uuid(),
  kind         report_kind_t not null,
  subject      text,          -- claim/bridge code or lens slug; null for 'atlas'
  title        text not null default 'Untitled report',
  scope_from   date,          -- both null = all-time scope
  scope_to     date,
  pack         jsonb not null,       -- deterministic, guest-safe evidence pack + stats
  narrative    jsonb not null,       -- sanitized, citation-gated HTML + audit
  is_published boolean not null default false,
  generated_at timestamptz not null,
  created_at   timestamptz not null default now()
);
```

Insert-only, with `is_published` as the single mutable field. Period reports live
in `reports` and thesis reports in `thesis_reports`, each with the same
pack-plus-narrative shape.

**Pack builders** (`lib/tearsheet/pack-core.ts`, pure and Node-testable via
`scripts/test-tearsheet.mjs`, 17 checks, dependency-injected query function):

| Constant | Value |
|---|---|
| `CLAIM_EVIDENCE_CAP` | 40 |
| `CLAIM_SIGNAL_CAP` | 30 |
| `LENS_SIGNAL_CAP` | 60 |
| `ATLAS_SIGNAL_CAP` | 12 |

Entry points are `buildClaimSheetPack`, `buildLensSheetPack`, and
`buildAtlasSheetPack`. Frames are refused as subjects. Signal-anchored evidence is
included only when the signal is published.

**Computed warnings**, in code and not by the model:

```js
oneSided = (supports >= 2 && contradicts === 0) ||
           (contradicts >= 2 && supports === 0)
thin     = evidence.length < 5
```

`corpusNote` is assembled from deterministic sentence parts: the evidence tally,
the one-sided warning when it applies, the thin-coverage warning when it applies,
the span of touching signals, and the scope sentence. This is the sentence a reader
sees describing what the report rests on, and no model wrote it.

**Narrative legs** (`lib/tearsheet/generate.ts`). Two `runStructured` calls, slugs
`tearsheet_sections` and `tearsheet_close`, `effort: 'medium'`,
`timeoutMs: 55_000`, `maxRetries: 0`. Section titles live in `lib/format.ts` rather
than `generate.ts`, which is server-only: importing the generator into a client
component pulls the Anthropic SDK into the browser bundle and 500s the page.

**The single AI seam** (`runStructured` in `lib/dossier.ts`). One forced-tool,
non-web call on `claude-sonnet-4-6` with `thinking: {type: 'disabled'}`,
`output_config: {effort}`, an ephemeral cache breakpoint on the system block,
`tool_choice: {type: 'tool', name}`, and `strict: true` on the schema. Every call
is metered through `recordApiCall` with its feature slug, model, usage, and wall
time, priced against a rate card frozen at call time. Swapping providers is a change
to this one function.

**The citation gate** (`lib/citations.ts`, `enforceCitations(html, allow)`):

```js
transformTags: {
  a: (tagName, attribs) => {
    const href = attribs.href ?? '';
    if (!allow.hrefs.has(href)) { dropped.add(href || '(no href)');
                                  return { tagName: 'span', attribs: {} }; }
    const tag = allow.tagByHref.get(href);
    if (tag) cited.add(tag);
    ...
  }
}
```

It returns `{html, cited, dropped}`, so the report stores an audit of which records
it cited and which links were removed. `lib/thesis/citations.ts` builds on this
generic gate rather than duplicating it. External `http(s)` links keep
`target="_blank" rel="noopener"`.

**PDF pipeline.** `lib/pdf/shell.tsx` is the branded kit with fonts embedded from
`lib/pdf/fonts/` (Anton, Schibsted, JetBrains, all OFL) registered by filesystem
path and traced through `outputFileTracingIncludes` in `next.config.ts`.
`sheet-doc.tsx`, `thesis-doc.tsx`, and `period-doc.tsx` render the documents. Two
constraints of react-pdf 4.6 with React 19 are encoded in the shell: `fixed`
elements must be mounted last inside their `Page` or they vanish silently, and the
render-prop `Text` for page numbers never renders, so footers are static labels.
Italic must be mapped onto the upright Schibsted faces or any `<em>` in report
prose 500s the route. PDF routes live under the page prefixes rather than `/api`,
because the proxy matcher does not exempt `/api`.

---

## 5. How the four connect

The loop closes rather than running in a line.

```
                 web search            manual upload
                      \                    /
                       \                  /
                     draft signal (model proposes)
                              |
                       [ human publishes ]
                              |
                       evidence rows
                              |
              +---------------+---------------+
              |                               |
        Claims & Theses                 Ask the Atlas
      confidence moves with          cited answers over
      a written rationale            the same records,
              |                      checked against them
              |                               |
              +---------------+---------------+
                              |
                       Report Portal
                  frozen pack + cited prose
                              |
                     grounds the next gap scan
                              |
                    proposes the claims missing
                              |
                     back to Claims & Theses
```

Three properties hold across all four surfaces.

**The model proposes and a person commits.** Discovery proposes candidates, triage
proposes a verdict, analysis proposes a draft signal and its claim touches, the
mapping call proposes claim codes, the gap scan proposes new claims, and the report
generator proposes prose. Publishing, mapping, authoring, moving confidence, and
publishing a report are all human actions, each leaving a record of who decided and
why.

**Numbers are counted and prose is written.** Every statistic in the system comes
from a query. The model writes narrative over statistics it received, which is why
a figure in a report can be traced back to rows and why the verification layer can
check a figure in an answer against literal text.

**Citations are enforced, not requested.** The report gate strips links outside the
allowlist. The Ask skeleton ships the complete ID namespace so an invented ID has
nowhere to come from. The mapping and gap proposers post-filter anything outside
the code namespace. In each case the prompt asks and the code enforces.
