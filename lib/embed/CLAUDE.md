# Embeddings and hybrid retrieval

Ask's retriever blends a lexical leg and a semantic leg. Mig `0066`. Public explainer: `/about/how-it-works#retrieval`. The Ask surface itself is covered in `lib/ask/CLAUDE.md`.

## Retrieval
- `lib/ask/retrieve.ts buildAskContext` runs a LEXICAL leg (the FTS `search_tsv` legs, `ts_rank`) and a SEMANTIC leg.
- The question is embedded once per turn (`embed_query`).
- `ask_prefs.retrieval` (`fts` | `hybrid`, default hybrid) decides whether the vector order is fused with the FTS order by reciprocal rank fusion.
- Fusion: `lib/ask/fusion.ts`, k = 60, the FTS top 3 always kept inside the first 10.
- `maxSim` is ALWAYS computed. `decideLane` (`lib/ask/lanes.ts`) uses sim bars `STRONG_SIM 0.55` / `MID_SIM 0.45` / `WEAK_SIM 0.42` beside the rank bars.
- Regression: 40-question gold set in `private/ask-gold/`, replayed by `npx -y tsx scripts/ab-retrieval-run.mts` with `ASK_RETRIEVAL_OVERRIDE=fts|hybrid`. Hybrid gets recall@10 86% (FTS 54%). One known miss, p05: a weak lexical hit on B4 buried by a broad question.

## Embedding store
- Model `openai/text-embedding-3-small` through OpenRouter. Files: `lib/embed/{chunk,client,sources,index}.ts`.
- ~800-token title-prefixed chunks, at most 12 per record. `text_hash` skips unchanged text.
- Table `embeddings`: HNSW cosine, RLS.
- 11 kinds, including `scan_item`/`intel_item`/`intel_fact` (keyholders + admin only) and `history_item`.
- New records embed as they are written (`embedLater` in every writer). `EMBED_DAILY_BUDGET_USD` 0.25.
- Agent check `embeddings.missing` + auto remedy `embeddings.backfill` catch gaps.
- `EMBED_SOURCES` (`lib/embed/sources.ts`) holds the per-kind FROM/WHERE, shared with `countMissingEmbeddings`.

## Citation tags
- `I<n>` items, `X<n>` facts, `R<n>` report passages. `F<n>` is a frame-claim code, not a tag.

## The Atlas's own reports in the corpus (mig `0074`)
- Embedded per SECTION via `lib/embed/report-sections.ts reportSections`: edition front items + column, roundup sections, Savant summary/lead/hypotheses/departments. The editor's note is excluded.
- Editorial set: Daily Editions for a rolling 90 days, research roundups and Savant issues forever.
- Record id is `<uuid>:<section>`. The Savant `peers` section is keyholder/admin only.
- Lexically findable through `generated_reports.search_tsv`.
- `pruneStaleReportEmbeddings` runs after each edition. Publish/patch re-embed, unpublish/delete drop.
- Retrieval prefers them: `fuseOrder(lists, k, { boost })` weights `report:` keys 1.5. On an explicit question the top two report passages are lifted into the first five. The prompt says lean on a passage that covers the question and cite the records it rests on.
- Guests: any sentence naming an intel-registry company is scrubbed (`buildNameMatcher` + `scrubSentences`) in peeks and the hypotheses widget.
- Peek ids are `<uuid>:<section>`. `toPeekId` in `lib/ask/verify.ts` resolves item/fact/report tags through the tag map (a raw `[item I3]` chip would 404).
- Anchors: `EditionView` `front-<i>`/`column`, `SheetReadView` section ids.

## Landmines
- `lib/*` extensionless imports do not load under plain Node: run measurement scripts through `npx -y tsx`.
- Block push order is NOT rank order: sort by `rank` before taking an FTS top-N.
- Truncation lesson: a structured batch call over about 25 signals truncates. Chunk it.
