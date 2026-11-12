# Savant (/savant/*)

The Atlas's autonomous weekly research report, Fridays, for people doing AI transformation in banking and read by their executives. Its own imprint under The AI Atlas (script signature beside the Atlas wordmark; strapline "An autonomous research agent with an editorial point of view. Produced by The AI Atlas."). Migs `0068`-`0069`.
Full write-up: docs/savant.md

## Access & guest safety
- Key-gated (keyholder/portal + admin) because it names the private intel registry's tracked companies.
- `/savant` (latest): guests see title + `SAVANT_TOC` only (the intel deck's `identity.tier === 'admin' || identity.active` gate).
- Public data only, nothing may lean confidential. The reader organization is the registry's `self` tier; its name comes from the DB and never appears in code.
- The ONE registry field allowed into a prompt is `intel_companies.public_blurb` (never `notes`, never `dossier`).
- The `peers` section is keyholder/admin only.
- Admin console `/savant/desk`: `adminGate`, `maxDuration = 300`.
- `/reports` shows the issue card portal-only (`PORTAL_ONLY_KINDS`).
- `/savant/record`: see lib/history/CLAUDE.md.

## Surfaces and files
- Pages: `/savant`, `/savant/[week]`, `/savant/archive` (Report Portal cover-page cards, `ReportCover`, one per issue), `/savant/[week]/pdf` (Letter, `lib/pdf/savant-doc.tsx`; Sacramento script signature bundled as `Savant` in `lib/pdf/fonts`), `components/savant/SavantView.tsx`.
- Nav: own group `key: 'savant'`, nib icon `PORTAL_ICONS.savant`, after News Blotter; leaves Latest issue + Archive for keyholders, Desk for admin; guests see the group and the teaser.
- Desk: Issues first (every issue with Read/PDF links and a Run / resume / two-click Rebuild button via `runSavantIssueAction`, one 270s leg per click), then notebook by day, the ledger, prefs. `/blotter/desk` redirects here.

## Phase 1: the notebook
- `lib/savant/notebook.ts` `runNotebookDay(day)`: weekdays 17:15 UTC via `/api/cron/savant` (after the edition's press); `?day=` backfills. By hand: `scripts/savant-notebook.mts <day> [--skip-plan] [--skip-note] [--show]`.
- Appends idempotent rows to `savant_notebook`, unique on `(week_end, day, kind, key)`; week = the Friday via `weekEndFor`.
- Connections (`connections.ts`): the day's new scan/intel items, facts and kept papers joined to claims/bridges/stances by cosine over the shared `embeddings` table in plain SQL, sim >= 0.55, 2 per record, 40 per day. Echoes: cross-kind record pairs >= 0.6.
- Anomalies (`anomalies.ts` + pure `anomalies-core.ts`): curated metric series from `lib/savant/metric-codes.ts` (FDIC ratios like `fdic_eeffr`, Y-9C BHCK items, EDGAR standard codes, CFPB monthly, ATS counts) more than 2σ off their trailing 8 periods. Key on codes, never slugs. Select by latest PERIOD, never `fetched_at`. Also scan-topic and company item-volume spikes vs trailing 4 weeks; lenses with no signal (Friday only).
- Misses (`misses.ts`): coverage misses through `cleanBlindSpots`, topics with 12+ relevant items and no approved candidate, questions with no new evidence.
- Monday plan (`plan.ts`, feature `savant_plan` on `savant_prefs.notebook_model`): topic, question, why, and the week's NEW hypothesis. `plan-core.ts` supplies the rotation fallback. `savant_prefs.lead_override` is honored once.
- Ledger `savant_hypotheses` is Savant's memory: every issue poses one, later issues update the open ones.
- Daily note (`note.ts`, `savant_note`, ~120 words).
- Budget per ISSUE WEEK: `checkSavantBudget` sums `savant_*` features stamped `metadata.week_end` against `SAVANT_WEEKLY_BUDGET_USD` (6).

## Phase 2: the Friday issue
- `lib/savant/issue.ts` `runSavantIssue(weekEnd, { deadlineMs, force, email, origin })`. Crons: Fridays 20:00 UTC `/api/cron/savant/issue`, resume sweeps 20:20 `/sweep` and 20:40 `/sweep2`; `?week=` backfills, `?force=1` rebuilds.
- Each finished leg is PARKED in the notebook as kind `query` key `leg:<name>` so a later 300s call resumes. Local loop: `scripts/savant-issue.mts <week> [--force] [--reset-legs] [--email]`.
- Poll-mode job wrapper: `lib/savant/issue-job.ts` `runSavantIssueJob`, steps in `lib/savant/issue-steps.ts` `SAVANT_ISSUE_STEPS`; parks the job on a partial return; the cron creates it with actor `cron`.
- Legs in order:
  - plan-if-missing.
  - `pack.ts` `buildSavantPack`: the frozen data half (notebook, what moved by direction/lens, top positions, signals; regulation = 2.x scan topics + regulatory-lens signals; research via `loadEditionPapers`; tools = entrants, releases, the week's edition builder reads; `calendar.ts` dated items; counts; `mapHrefs` = every claim/bridge href).
  - `peers.ts`: the `self` row beside its tiers from `intel_metrics`; citations BUILT from registry ids via `metricSourceUrl` (CIK → EDGAR companyfacts, `fdic_cert` → BankFind, `rssd_id` → FFIEC NIC, `cfpb_name` → the complaint database); AI-mention density from `tech_ai` items; CFPB and ATS latest.
  - `lead.ts` `researchLead`: Savant's OWN bounded tool loop over the /ask tools `search_atlas`/`fetch_record`/`search_articles` in PORTAL mode + `web_search` <= 3, 4 rounds, Sonnet, forced `submit_lead` final. Records cited by tag `[S3]`/`[P1]`/`[I4]`/`[X2]`, resolved to hrefs afterwards; positions linked by exact href. Deliberately not a refactor of the streaming deep route.
  - `write.ts`: three Sonnet legs (summary + hypotheses readings, six departments, the peer watch); feature `savant_sections`.
  - `editor.ts`: pure `editor-core.ts` `deterministicChecks` first (machinery words, bare codes, em dashes, a sentence naming the `self` company with no linked record in its paragraph, lead length, unlinked summary bullets, no "What we will watch"); then the editor persona `savant_prefs.editor_name` on `editor_model`, feature `savant_editor`: verdict, required edits, cuts, a signed note.
  - One `reviseSection` round (`savant_revise`) over the sections named.
  - `enforceCitations` against `allowlist.ts` `allowlistForSavant` (+ the lead's tag hrefs).
  - `figures` leg (below).
  - `saveGeneratedReport` kind `savant`, published (the fifth auto-publishing kind; one per week, unique index `0069`).
  - Ledger: `updateHypothesis` per reading; the lead's reading of the fresh one.
  - Email.
- PDF: full-bleed cobalt cover (issue number, week, lead title, the week's question), a contents page linking section anchors, executive summary first, sources as Appendix B.

## Phase 3: email
- `email.ts` `sendSavantIssue`: executive summary + TOC + link, one Resend send per recipient: `AGENT_EMAIL_TO`/`agent_prefs.email_to` + every active key with `portal_keys.savant_email` (toggled per key on `/access`).
- Gated by `savant_prefs.email_enabled`, default off. A verified Resend sending domain is the maintainer's action before readers receive mail.

## Figures
- Savant never draws raw SVG. After the text is final, the `figures` leg (`lib/savant/figures.ts`, feature `savant_figures`) proposes 2-6 specs: `entities` favicon-card grid, `map` two-axis placement labeled as Savant's reading, `relation` grouped node-edge diagram, `timeline`, `compare` bars over stated numbers, `steps`. Each is bound to catalog hrefs.
- `figures-core.ts` validates against the citation allow-list (an unknown href drops the figure whole), caps 2/section and 6/issue, lays each out as a primitive list.
- Painted by `components/savant/Figure.tsx` (inline SVG) and `lib/pdf/savant-figures.tsx` (react-pdf Svg; entity favicons baked as PNG data URIs at plan time).
- Stored on `narrative.figures`, placed after the block each names (`interleave`). `scripts/savant-figures.mts <week>` re-plans a saved issue's figures.
- Landmine: a six-shape strict tool schema is "too large a compiled grammar" for the API, so the per-kind body travels as a JSON string.

## Model picks and cost
- Desk prefs offer each role a picker over `SAVANT_MODEL_OPTIONS` (`lib/savant/cost-model.ts`, dependency-free).
- Anthropic tier: Fable 5.1 / Opus 5.5 / Sonnet 5 (rate cards mig `0070`; these tokenize ~30% longer than 4.6, `tokenFactor` 1.3 in the estimate) + Sonnet 4.6 + Haiku 4.5.
- Open-weight reasoning (mig `0071`): DeepSeek V4 Pro, GLM-5.3, Qwen3.8 Max, Kimi K3, MiniMax M3, Nemotron 3 Ultra.
- Open-weight flash: the six scan models; parity with `SCAN_ENRICH_MODELS` is test-asserted.
- Estimate is live from `SAVANT_TOKEN_PROFILE` × the live rate cards (`getModelRates`).
- The lead loop is Anthropic-only: a non-Anthropic writer hands that leg to `LEAD_FALLBACK_MODEL` (`issue.ts` and the estimate must agree).
- Sonnet everywhere ≈ $0.41/week; GLM writer + Haiku editor ≈ $0.15.

## Tests
- `scripts/test-savant-core.mjs`, `scripts/test-savant-issue.mjs`, `scripts/test-savant-figures.mjs`.
