# The Strategy Atlas

A strategic-intelligence tool for an operating team: the hypotheses the strategy leans on, the evidence for and against each, and the conviction the team has committed, all in one auditable place.

The core design position: **the model proposes, the human commits.** Every AI feature in this codebase is recommend-only. Conviction never moves without a human-written rationale, drafted signals enter the public record only when a human publishes them, and generated reports cite only records that survive a deterministic citation gate. The goal is orientation, not proof.

## What's inside

One Postgres database holding a hypothesis board, a signal feed, and a research library, with six public surfaces over it:

| Surface | What it does |
|---|---|
| **Hypotheses** (`/map`) | The board: falsifiable statements with required tests, per-link evidence weights, and the gated conviction on each. |
| **Signal Board** (`/signals`) | A feed of tracked internal and external developments, each wired back to the hypotheses it touches. Fed by manual intake with a human review gate. |
| **News Blotter** (`/blotter`) | A broadsheet-style dashboard: health strip, hypothesis ledger, signal wire, candidate archive. |
| **Report Portal** (`/reports`) | Generated, citation-gated, PDF-downloadable reports: period reports and per-hypothesis reports. |
| **Data Portal** (`/datasets`) | The Atlas as a self-service data product: datasets with schema pages, an in-browser explorer, and CSV/JSON downloads. |
| **Research Portal** (`/research`) | A paper library: review, deep structured reads, living research threads, with papers feeding the Ask corpus. |

Plus **Ask** (`/ask`): a multi-turn chat workspace grounded in the database via hybrid full-text retrieval, with per-message citation maps, a citation peek panel, a retained-document viewer, an agentic deep-research mode, and a two-layer answer-faithfulness check (deterministic quote/number verification plus a model pass, with flags shown to the reader, never silently applied).

## Architecture

- **Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 (CSS-first)** · any Postgres 15+ over one `DATABASE_URL`, accessed through a raw `pg` pool, server-side only. Every page that reads cookies or the DB is `force-dynamic`; the personal layer (conviction values, rationales, source priors) is stripped server-side before anything reaches a guest.
- **Zero outbound network by default.** Fonts are vendored, there is no web search anywhere, and the only external call is the optional AI endpoint (`ANTHROPIC_API_KEY`, pointed at a gateway with `ANTHROPIC_BASE_URL`). Without a key, every AI affordance reports itself unconfigured and the rest of the tool works.
- **One AI seam.** Nearly every model call routes through `runStructured` (`lib/dossier.ts`): a single forced-tool call returning schema-validated JSON, with bounded timeouts and metered cost logging (`lib/cost.ts` → the `/costs` console). The client itself comes from one factory (`lib/ai.ts`).
- **The human gate.** `moveConviction` (`lib/mutations/core.ts`) is transactional: it requires a rationale, records it append-only, and snapshots all convictions for the `/calibration` time-slider. Intake only ever creates drafts; publishing is a human act that materializes evidence rows atomically.
- **The citation gate.** Generated report narratives pass through `lib/hypothesis/citations.ts` at generate, save, and render time; a sentence citing a record that isn't in the pack is dropped, not repaired.
- **Auth** is a signed HMAC admin cookie that fails closed (`lib/auth.ts`), with cookie-presence routing in `proxy.ts` and real authorization in each page and route.

## Docs

The transition record (decisions, object mapping, runbook) lives in [`transition/`](transition/) and is the authoritative account of the Strategy Atlas remodel. The long-form write-ups in `docs/` describe the machinery in its pre-remodel vocabulary and carry a historical note at the top.

## Running it

```bash
npm install
cp .env.example .env.local   # fill in: DATABASE_URL, ADMIN_PASSWORD, AUTH_SECRET, ANTHROPIC_API_KEY (optional)
npm run db:migrate
npm run db:seed
npm run dev                  # http://localhost:3000
node scripts/run-tests.mjs   # read-only/rollback test scripts
```

## License

**All rights reserved.** This source is published for reading and evaluation only; see [LICENSE.md](LICENSE.md). The bundled fonts are separately licensed under the SIL Open Font License ([`lib/pdf/fonts/OFL.txt`](lib/pdf/fonts/OFL.txt) and [`app/fonts`](app/fonts)).
