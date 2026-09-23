# The AI Atlas

A strategic-intelligence tool for staying oriented in the AI-economy debate: where the disagreement actually is, what evidence would move it, and what happened this week that bears on it. One maintainer runs it; readers get a public layer, an access key unlocks Ask and the key-gated exports, and the admin password unlocks the personal layer and the consoles.

The core design position: **the model proposes, the human commits, with a few named exceptions.** Confidence on the argument map never moves without a human-written rationale, and generated reports cite only records that survive a deterministic citation gate. Most AI features recommend and a human commits; the exceptions are listed and bounded: the Daily Edition, the Friday research roundup, and the Monday tooling entrants report publish when they run; tooling products at or above a score threshold enter the catalog; high-significance pipeline signal drafts with a claim touch publish after a 48-hour window in which a human can archive them (the promotion policy); period reports are public on save. The goal is orientation, not proof.

![Ask the Atlas](public/showcase/ask.png)

## What's inside

One Postgres database (73 tables as of migration 0059) holding an argument graph, a signal feed, a research library, a company funnel, a tool catalog, and the collection engines' retained text, with the public portals in `lib/nav.ts` (`NAV_TREE`) over it:

| Surface | What it does |
|---|---|
| **Signal Board** (`/signals`) | A feed of tracked AI developments, each wired back to the falsifiable claims it touches. Fed by a weekday discovery pipeline; drafts publish by human review or, for high-significance drafts with a claim touch, by the 48-hour promotion policy. |
| **Claims & Theses** (`/map`) | The argument map: open questions → candidate stances → falsifiable claims → cross-domain bridge claims, plus investment-style theses mapped onto the graph. |
| **News Blotter** (`/blotter`) | The Daily Edition: a model-written AI newspaper each weekday, built only from what the engines already stored, with a citation gate against those records. |
| **Report Portal** (`/reports`) | Generated, citation-gated, PDF-downloadable reports: claim, lens, and whole-Atlas sheets, the research roundup, the tooling reports, the daily edition, period reports, and thesis reports. |
| **Data Portal** (`/datasets`) | The Atlas as a self-service data product: the datasets in `lib/datasets/registry.ts` (24 at this writing, 11 of them key-gated) with schema pages, an in-browser explorer, CSV/JSON downloads, and importer handoff docs. |
| **Research Portal** (`/research`) | An arXiv funnel: pull → triage → analyze → living research threads, with papers feeding the Ask corpus. |
| **Startup Scout** (`/scout`) | A company-discovery funnel: web discovery, an AI scoring agent, dossier enrichment, and a review queue. |
| **Tooling Monitor** (`/tooling`) | A weekly market scan of AI tools: discovery, homepage extraction, a rubric score that catalogs at a threshold, build-or-buy and new-entrants reports. |
| **Education** (`/education`) | Hand-kept guides to how the machinery works, each with a 16:9 deck. |

Plus **Ask** (`/ask`): a multi-turn chat workspace grounded in the database via hybrid full-text retrieval, with per-message citation maps, a citation peek panel, a retained-document viewer, an agentic deep-research mode, and a two-layer answer-faithfulness check (deterministic quote/number verification plus a model pass, with flags shown to the reader, never silently applied).

And **Traceroute** (`/traceroute`): a scripted 3D explainer of how a transformer processes a prompt, built from three.js primitives with no model assets.

## Architecture

- **Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 (CSS-first)** · Postgres (Supabase) accessed through a raw `pg` pool, server-side only. Every page that reads cookies or the DB is `force-dynamic`; the personal layer (confidence values, rationales, source priors) is stripped server-side before anything reaches a guest.
- **Two AI seams.** Anthropic calls route through `runStructured` (`lib/dossier.ts`): a single forced-tool call returning schema-validated JSON with bounded timeouts; the cheap open-weight models (triage, enrichment, the Daily Edition, the agent, research) go through an OpenAI-compatible client (`lib/scan/llm.ts`) with the same JSON discipline. Both are metered by `lib/cost.ts` (the `/costs` console). The web-enabled Anthropic calls (scout discovery, tooling deep dives, the breaking sweep fallback, the Ask web toggle) share one call shape; lens discovery itself is LLM-free Tavily search.
- **The human gate.** `moveConfidence` (`lib/mutations/core.ts`) is transactional: it requires a rationale, records it append-only, and snapshots all confidences for the `/calibration` time-slider. The discovery pipeline only ever creates drafts; publishing, by a human or by the promotion policy, materializes evidence rows atomically.
- **Collection engines and retention.** Crons (23 entries in `vercel.json`, most of them weekday) run the External Scan, discovery pipeline, Intel Desk, Research, and Tooling engines, the Daily Edition, the Friday roundup, a late feed sweep, and the Atlas Agent, over RSS feeds, Tavily search, SEC EDGAR, FDIC, CFPB, CourtListener, arXiv, Semantic Scholar, Greenhouse/Lever job boards, Hacker News, GitHub, and Product Hunt. Retrieved article, filing, and paper text is stored indefinitely (there is no retention job; archiving never deletes) and is what the models read. Every model call and every Tavily call is metered in `ai_cost_log`.
- **The citation gate.** Generated report sections pass through `lib/citations.ts` at generate, save, and render time; a sentence citing a record that isn't in the pack is dropped, not repaired.
- **Decomposed pipelines.** The discovery pipeline runs as many short, DB-checkpointed steps (one lens batch per invocation), so runs are resumable and retries are cheap. State lives in the run tables, not in memory.
- **Auth** is a signed HMAC admin cookie that fails closed (`lib/auth.ts`) plus a signed access-key cookie for keyholders; `proxy.ts` is open by default and fences only unlisted `/api/*` routes, with real authorization in each page and route.

## Docs

The long-form write-ups are in `docs/`:

- [`core-loop.md`](docs/core-loop.md) — the Signal Board → Map → Ask → Reports loop at three altitudes
- [`prompt-architecture.md`](docs/prompt-architecture.md) — what actually goes to the API: call shapes, caching, schemas
- [`discovery-pipeline-spec.md`](docs/discovery-pipeline-spec.md) — the web-acquisition pipeline, end to end
- [`web-research-pipeline-primer.md`](docs/web-research-pipeline-primer.md) — the non-technical companion
- [`traceroute.md`](docs/traceroute.md) — the 3D transformer explainer
- [`data-portal.md`](docs/data-portal.md) / [`data-portal-upgrade-paths.md`](docs/data-portal-upgrade-paths.md) — the datasets product and its deferred options
- [`research-section.md`](docs/research-section.md) — the arXiv research surface design

## Running it

```bash
npm install
cp .env.example .env.local   # fill in: Postgres connection, ADMIN_PASSWORD, AUTH_SECRET, ANTHROPIC_API_KEY
npm run db:migrate
npm run db:seed
npm run dev                  # http://localhost:3000
npm test                     # every scripts/test-*.mjs, read-only or rollback-only
```

This is a personal project run by one maintainer, published for reading; it runs, but it is not packaged as a product and there is no support.

## License

**All rights reserved.** This source is published for reading and evaluation only; see [LICENSE.md](LICENSE.md). The bundled fonts are separately licensed under the SIL Open Font License ([`lib/pdf/fonts/OFL.txt`](lib/pdf/fonts/OFL.txt)).
