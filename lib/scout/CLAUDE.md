# Startup Scout

The 7th portal (`scout/*`, migrations `0034`, `0035`): the acquisition-target funnel. Public for tracked companies only; everything about M&A intent is admin-only.

Tables: `scout_verticals` (registry, query templates on the row), `companies` (library + funnel state on one row, generated `name_key`, partial unique on `domain`), `company_events`, `scout_runs`, `scout_prefs` (steering + rubric singleton), `company_documents` (`0035`, retained browser-extracted PDF text; the file is never stored).

## Pages and access
- `scout/page.tsx` (public): tracked companies grouped by vertical + a recent-activity strip. Portal keyholders also get a "review queue" strip.
- Never SELECT the agent layer (verdict/scores/reasons), review notes, the queue, or non-tracked companies for guests: a public "pursue" chip on a named startup would disclose M&A intent.
- `scout/[id]/page.tsx`: profile (facts, ai_tech, events timeline). Public ONLY once tracked, else 404 for guests.
- Admin on the profile: dossier panel, agent read, review controls (Track requires a why; star prefills the agent's reason), fact edits (human text always wins), enrich button, provenance.
- `scout/console/page.tsx` (admin, `adminGate`, `maxDuration = 60`): discovery runs, scoring agent, pursue-first queue, manual adds, verticals manager. Admin nav row "Scout" with a queued-count badge.
- Portal keyholders see tracked + queued profiles (PUBLIC columns only; `getCompany(id, {admin, portal})`), can add targets (`addTargetAction`, `requirePortal` gate; adds land queued) and run `ResearchPanel` on any visible profile.

## Discovery and agent
- `ScoutConsole` drives one vertical query batch per invocation over `lib/scout/web.ts` `searchCompanies`: the pipeline's web_search call shape with a youth screen (founded about 6y or less, pre-seed to Series B, no fit judgment).
- `insertCompanies` dedupes GLOBALLY by domain + `name_key`. Never re-queue a dismissed company.
- `scout_verticals` registry rows carry the discovery query templates (`{year}`/`{month}` tokens).
- Scoring agent `lib/scout/agent.ts` (the 0033 queue-agent pattern): 10-company `runStructured` chunks, feature `scout_agent`, pursue/watch/pass + five 1-5 rubric scores. Rubric editable in `scout_prefs`, `DEFAULT_RUBRIC` fallback. Pass `DEFAULT_RUBRIC` into the client panel as a PROP from the console page; never import it into a client component.

## Enrichment and research tools
- `lib/scout/enrich.ts`, feature `scout_dossier`: homepage fetch via `fetchCandidateText` + one structured skeptical read; fill-only-null facts + `dossier` jsonb.
- ResearchPanel: a one-off steering textarea (never persisted) + web intel sweep (`lib/scout/intel.ts`, Sonnet + web_search x3, about $0.10) + document upload (browser unpdf extraction, text retained in `company_documents`, `lib/scout/docread.ts` structured read, Re-extract on stall).
- Admin-only: competitor scan (`lib/scout/competitors.ts`, queues similar young companies, provenance note event on the source) and homepage-dossier refresh.

## Write discipline
- Facts fill only nulls.
- The dossier MERGES monotonically: `mergeDossier` in `lib/scout/core.ts`; `updateCompanyEnrichment` = `fillCompanyFacts` + `mergeCompanyDossier`, so three writers cannot clobber each other.
- Events dedupe by URL/normalized title with NEUTRAL public notes. No filenames: event notes render to guests on tracked profiles.
- Gate template for portal actions: re-check target visibility with a generic error (no probing for dismissed companies), then the daily budget.

## Cost slugs
- Portal calls log `portal_scout` (summed by `checkPortalBudget` beside `portal_ask`).
- Admin calls log `scout_intel`, `scout_doc`, `scout_competitors`.
- Scout calls carry provenance in `metadata` (`scout_run`) and never set `pipelineRunId` (FK to `pipeline_runs`; `recordApiCall` would drop the cost row silently).

## Tests
- Pure core `lib/scout/core.ts` is Node-testable: `scripts/test-scout.mjs`
