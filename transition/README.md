# Transition: AI Atlas → Strategy Atlas

**If you are a Claude Code session inside the company walls, start here.** This folder is
the complete record of the transformation designed and (partly) executed outside the
firewall. Read it in order before touching code.

## What happened before you

The AI Atlas (a single-user tool for tracking the AI-economy debate) is being converted
into the **Strategy Atlas**: an internal, air-gapped strategy tool for the same operator.
The conversion was designed in a Claude Code session with full repo context, and as much
of it as possible was **executed there and verified** (build green, lint clean) so that
this repo arrives at work as a finished v0, not a construction site.

Your job is NOT to redo the transformation. Your job is:

1. Read this folder (order below).
2. Wire the app to the corporate environment (database, LLM endpoint, run mode) using
   `RUNBOOK.md`.
3. Resolve the items in `OPEN-QUESTIONS.md` **with the operator**, not unilaterally.
4. Continue feature work from `ARCHITECTURE.md`'s roadmap.

## Reading order

| File | What it is |
|---|---|
| `README.md` | This file. Orientation. |
| `DECISIONS.md` | The running decision log. Every choice, its date, and its why. Binding unless the operator overrides. |
| `ARCHITECTURE.md` | The target data model and system design of the Strategy Atlas. |
| `GLOSSARY.md` | Old term → new term. Needed to read old commits, old docs, and any code not yet renamed. |
| `INVENTORY.md` | The kill / keep / mutate audit of the original codebase that the strip was executed from. |
| `OPEN-QUESTIONS.md` | Deliberately unresolved items, each with a recommendation. Do not resolve silently. |
| `RUNBOOK.md` | Day-one setup inside the corporate environment: DB options ladder, env vars, LLM endpoint config, how to verify the install. |

## Ground rules carried over from the AI Atlas

These survived the transition and still bind:

- **The human gate.** The model proposes; the human commits. No conviction moves
  without a rationale. No signal enters the record without a human publishing it. Keep
  this property through every refactor.
- **All DB access is server-side** through `lib/db.ts`. Never import it into a client
  component.
- **Guest/share stripping is done server-side** in `lib/data/*`. The server decides what
  is personal.
- **No outbound network calls except the LLM endpoint.** The corporate build must make
  zero web requests: no CDNs, no external fonts, no iframes to the public internet, no
  fetch of external URLs. The LLM endpoint itself is configurable (see `RUNBOOK.md`).
- **Migrations are append-only** via `scripts/migrate.mjs`. The Strategy Atlas starts
  from a squashed baseline; new schema changes get new numbered files.
- No em dashes in user-facing strings (repo style rule; see root `CLAUDE.md`).

## State of the code at handoff

See `DECISIONS.md` for the precise cut line: which strips/renames were completed and
verified outside the firewall, and what remains. The root `CLAUDE.md` is rewritten to
describe the Strategy Atlas as it now is; this folder describes how it got that way and
what is still open.
