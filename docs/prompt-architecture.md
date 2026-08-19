# Prompt architecture: what actually goes to the API

An answer to "what do the prompts look like?", from the 30-second version to the
byte layout of a request.

The short version: **there is one call shape, and prose is never parsed.** Every
model call in the Atlas is a forced tool call against a strict JSON schema, with
the payload ordered by how often each block changes so the stable prefix caches.
The model's output is treated as a proposal and passes a post-filter before it can
reach the database.

---

## 1. The 30-second answer

> Every call is a forced tool call. I define a JSON schema, set `tool_choice` to
> that specific tool, and the model has to return an object matching it, so there
> is no output parsing and no prose to regex. The payload is ordered by volatility:
> the static instructions first, then the record namespace, then the volatile query
> last, with cache breakpoints on the stable prefix, so a conversation re-reads its
> own history from cache. For anything that names a record, the complete ID
> namespace ships inside the cached block, so the model can only cite a string it
> has literally been shown, and a post-filter drops anything that is not in the
> namespace anyway. Then every call is metered: feature slug, model, token counts,
> wall time, priced against a rate card frozen at call time.

The rest of this document is the evidence for each clause.

---

## 2. One seam

Most calls route through a single function, `runStructured` in `lib/dossier.ts`.
The source dossier, PDF metadata extraction, claim recommendations, lens
recommendations, concept wiring, gap diagnosis, thesis mapping, question
summaries, signal drafting, tear sheet narratives, and the Scout scoring agent all
enter the API through it. Swapping providers is a change to one function.

```ts
export async function runStructured<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: object;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  feature: string;                 // cost-log slug
  pipelineRunId?: string | null;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<T>
```

The request it builds:

```ts
const params = {
  model: MODEL,                                  // claude-sonnet-4-6
  max_tokens: opts.maxTokens ?? 4000,
  thinking: { type: 'disabled' },
  output_config: { effort: opts.effort ?? 'low' },
  system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
  tools: [{
    name: opts.toolName,
    description: opts.toolDescription,
    strict: true,
    input_schema: opts.schema,
  }],
  tool_choice: { type: 'tool', name: opts.toolName },
  messages: [{ role: 'user', content: opts.user }],
};
```

Five decisions are visible in that object.

**`tool_choice: {type: 'tool', name}`** makes the tool call mandatory. The model
cannot answer in prose, cannot preamble, and cannot decline the shape. The return
path is `msg.content.find(b => b.type === 'tool_use' && b.name === opts.toolName)`
and a missing block throws rather than falling back to text parsing.

**`strict: true`** puts schema enforcement on the API side rather than in a
validator after the fact.

**`thinking: {type: 'disabled'}` with `output_config: {effort}`** because these are
extraction and classification calls, not reasoning calls. Effort is set per caller:
`low` for mapping and classification, `medium` for narrative generation.

**The cache breakpoint on the system block**, which is where the schema-shaped
prompt and any namespace live. See section 4.

**`feature`** is required, not optional, so no call can reach the API without being
attributable in the cost log.

---

## 3. The output contract is a schema

A representative example, thesis to claim mapping (`lib/thesis/map.ts`):

```ts
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    proposals: {
      // No maxItems: strict tool mode supports only a schema subset, so the
      // 5-cap is enforced in the post-filter below (and asked for in the prompt).
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { code: { type: 'string' }, why: { type: 'string' } },
        required: ['code', 'why'],
      },
    },
    note: { type: 'string' },
  },
  required: ['proposals', 'note'],
};
```

`additionalProperties: false` at every level, `required` on every field, and no
optional keys. A field the code reads is a field the schema demands.

**Two schema constraints worth knowing**, both discovered by the API rejecting a
call:

1. Strict tool mode supports a subset of JSON Schema. `maxItems` is not in it, so
   caps are stated in the prompt and enforced in code.
2. The tool validator rejects `minimum` and `maximum` on integer properties. Ranges
   go in the field description and the writer clamps. This one bit during the
   research queue agent, where a 1 to 5 rubric score wanted bounds.

---

## 4. Cache architecture: order blocks by volatility

This is the decision that matters most for cost and latency, and it is a layout
decision, not a prompting one.

Every payload is built in three tiers:

| Tier | Changes | Placement |
|---|---|---|
| Instructions | Per deploy | System block, cached |
| Namespace / record skeleton | When content is edited | First user block, cached |
| Query and matched detail | Every request | Last, uncached |

From `lib/ask/prompt.ts`:

```ts
// The system prompt is static (so it caches across requests); the skeleton is
// nearly static (caches within the window, auto-busts when content is edited);
// the query + matched detail is volatile and goes last.
```

The web-search variant is deliberately a separate static string rather than a
conditional insert, so it forms its own cache entry beside the plain one instead of
busting the shared prefix:

```ts
system: [{
  type: 'text',
  text: webOn ? ASK_SYSTEM + WEB_ADDENDUM : ASK_SYSTEM,
  cache_control: { type: 'ephemeral' },
}]
```

The API allows four cache breakpoints per request, which is a budget to allocate.
The quick-ask path spends them on: system, skeleton, and the last prior assistant
turn. The deep path spends them on: system, skeleton, and a rolling anchor that
moves with each round of tool results (section 6).

---

## 5. The namespace technique: make an invalid ID unrepresentable

Any call that returns a record identifier receives the **complete namespace of
valid identifiers inside the cached block**. The model does not recall an ID, it
copies one it was shown.

The Ask skeleton is built once per request and is one line per citable record,
prefixed with the exact citation token the answer must use:

```ts
const skeleton = [
  'QUESTIONS',
  ...questions.map(x => `[Q ${x.slug}] Q${x.sort_order}: ${x.title}`),
  '',
  'STANCES (candidate answers, each under a question)',
  ...stances.map(x => `[stance ${x.code}] ${x.title} (under Q ${x.q_slug})`),
  '',
  'CLAIMS',
  ...claims.map(x => `[claim ${x.code}]${x.is_frame ? ' (frame)' : ''} ${x.statement}`),
  '',
  'BRIDGE CLAIMS (links between domains)',
  ...bridges.map(x => `[bridge ${x.code}] ${x.statement}`),
  '',
  'CONCEPTS',
  ...concepts.map(x => `[concept ${x.slug}] ${x.name}: ${x.short_definition}`),
  '',
  'RESEARCH THREADS (living syntheses over the recent AI literature)',
  ...threads.map(x => `[thread ${x.slug}] ${x.title}: ${x.question}`),
].join('\n');
```

Rendered, that is:

```
QUESTIONS
[Q unit-economics] Q3: Do the unit economics of frontier AI work?

STANCES (candidate answers, each under a question)
[stance Q3-S1A] Inference costs fall faster than capability demand (under Q unit-economics)

CLAIMS
[claim 3.3] Enterprises achieve measurable ROI and renew / expand, not just pilot.
[claim 3.1] Inference cost per unit of capability is falling rapidly.

BRIDGE CLAIMS (links between domains)
[bridge B1] Agentic reliability gains will translate into enterprise ROI.

CONCEPTS
[concept token] Token: the unit a model reads and writes...
```

The prompt then constrains the grammar precisely, including the failure modes worth
naming:

```
- Cite every record you rely on, inline, using its ID in square brackets exactly
  as the records are labeled: [claim 2.3], [bridge B1], [stance Q1-S1A],
  [Q unit-economics], [concept token], [signal S1], [paper P2],
  [thread agent-reliability]. Put exactly one ID in each bracket and keep its kind
  word, like [claim 1.3] [bridge B1] [signal S2]. Do not combine several IDs in one
  bracket (never write [claim 1.3, B1]), and do not drop the kind word (never write
  [3.3]).
- Never cite an ID that does not appear in the provided records, and never invent an ID.
```

**Why this instead of embeddings.** It was a considered rejection, recorded in the
migration that added the search indexes:

```sql
-- Embeddings were considered and rejected: the citable corpus is ~74 records
-- (6 questions, 18 stances, 25 claims, 4 bridges, 21 concepts), small enough that
-- the full ID namespace ships in the prompt as a skeleton, so lexical + structural
-- retrieval needs no vector infra and adds no per-query embedding round-trip on the
-- latency-sensitive, 60s-capped path.
```

Beyond the infrastructure saving, shipping the namespace buys a guarantee that
similarity search does not: an ID that was never in the payload has nowhere to come
from. Retrieval decides what gets *detail*; the namespace decides what is
*citable*.

---

## 6. Multi-turn assembly

A conversation is not a running string. It is rebuilt per request from a wire
contract, clamped, and laid out for cache hits.

**The wire contract** (`lib/ask/history.ts`) is `{ messages, signalOffset }` with
these clamps:

| Constant | Value | Purpose |
|---|---|---|
| `USER_TURN_CAP` | 2,000 chars | Per user turn |
| `ASSISTANT_TURN_CAP` | 2,500 chars | Per assistant turn |
| `MAX_MESSAGES` | 12 | Turn count ceiling |
| `CHAR_BUDGET` | 8,000 chars | Total history budget |
| `RETRIEVAL_QUERY_CAP` | 1,200 chars | Latest + previous turn, for the FTS query |

Two details in the clamping are deliberate. Oldest turns drop first. And an
over-long assistant turn is truncated from the **front**, keeping its tail:

```ts
return { ...m, content: `[...] ${m.content.slice(-ASSISTANT_TURN_CAP)}` };
```

A follow-up question almost always refers to how an answer ended, so the tail is
the part worth keeping.

**The retrieval query** is the latest turn plus the previous one, not the latest
alone, so "what about the second one" still retrieves.

**The layout** (`conversationMessages`):

```
[ user:      skeleton (cache breakpoint) + first turn text ]
[ ...prior turns as PLAIN text, never their old detail blocks ]
[ assistant: last prior turn (cache breakpoint) ]
[ user:      queryBlock(latest turn, fresh retrieval detail) ]
```

Prior turns are re-sent as plain text and their old retrieval blocks are discarded,
because stale detail competes with fresh detail for attention and pays tokens
twice. A single-turn conversation degenerates to exactly the single-shot shape,
so there is one code path rather than two.

**Citation tag stability across turns** is the subtle part. Signals and papers mint
numbered tags (`S1`, `P2`) on a shared counter. The client sends its accumulated
`signalOffset` and merged `signalMap`, and the route seeds a tagger with them, so
tags issued in turn one still resolve in turn four and a rediscovered record keeps
the tag it already had. Without this, `[signal S2]` in an early answer would
silently point at a different record later in the conversation.

---

## 7. The agentic loop: how the payload evolves

Deep research (`app/api/ask/deep/route.ts`) is the same corpus reached through a
bounded tool-use loop. The payload grows across rounds, and three things are
managed as it does: the cache anchor, the context size, and the exit.

**The rolling cache anchor.** Only the newest tool-result block carries a
breakpoint, so the growing conversation stays within the four-breakpoint budget:

```ts
// Rolling cache anchor: only the LATEST tool-result block carries a
// breakpoint (plus system + skeleton), staying under the 4-block limit.
if (lastAnchor) delete lastAnchor.cache_control;
lastAnchor = results[results.length - 1];
lastAnchor.cache_control = { type: 'ephemeral' };
convo.push({ role: 'user', content: results });
```

Everything before the anchor is a cache read on the next round. A full deep session
costs roughly two cents.

**Context accounting from usage**, which measures the real window rather than
estimating it:

```ts
const contextTokens =
  (u.input_tokens ?? 0) +
  (u.cache_read_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);
if (contextTokens > INPUT_TOKEN_CAP) {        // 40,000
  emit(ndStatus('Context budget reached, writing with what is gathered'));
  break;
}
```

Cached tokens still occupy the window even though they cost less, so all three
counters are summed.

**Tool results are clipped** to `RESULT_CAP = 1500` characters each, and a
per-round call budget is enforced by feeding the model an error result rather than
by dropping the call, so the loop stays a well-formed conversation:

```ts
if (i >= MAX_CALLS_PER_ROUND) {
  r = { text: 'Call budget for this round exceeded. Use what you have or continue next round.', isError: true };
}
```

**The forced exit** contains the detail I would use to show someone has actually
built one of these:

```ts
// Forced final: the finish instruction rides in the same user turn as
// the last tool results (a trailing sibling user message would break
// role alternation), and tool_choice none blocks further calls.
const last = convo[convo.length - 1];
if (last?.role === 'user' && Array.isArray(last.content)) {
  last.content.push({
    type: 'text',
    text: 'Research is over. Write the final answer now from the records gathered above, following the citation rules. Do not request more tools.',
  });
}
```

Then the answer call sets `tool_choice: { type: 'none' }` while still passing
`tools`, so the tool definitions stay in the cached prefix and the model simply
cannot call them.

Guards, all of them: 4 rounds, 6 calls per round, 1,500 characters per result,
40,000 tokens of context, a 280-second wall deadline with a 60-second reserve held
back for writing the answer. Every one degrades to "answer with what you have"
rather than failing.

---

## 8. Reusing a cached conversation for a second role

The verification pass is the payload trick worth showing. Rather than building a
fresh request with the records re-attached, it appends two turns to the conversation
that already contains them and re-enters with a different tool and a role
instruction:

```ts
convo.push({ role: 'assistant', content: answerText });
convo.push({ role: 'user', content: VERIFY_INSTRUCTION });

const vres = await client.messages.create({
  model: MODEL,
  max_tokens: 700,
  system,
  tools: [...DEEP_TOOLS, VERIFY_TOOL],
  tool_choice: { type: 'tool', name: VERIFY_TOOL.name },
  messages: convo,
}, { timeout: 25_000, maxRetries: 0 });
```

The rolling anchor is still on the last tool results, so the entire research
transcript is a cache read. The cross-check costs a fraction of a cent. The
verifier's own system framing is prepended by instruction rather than by a new
system block, which is what keeps the prefix identical and therefore cached.

The verify tool's schema is the contract for what a flag is:

```ts
{
  name: 'submit_verification',
  input_schema: {
    type: 'object',
    properties: {
      checked: { type: 'integer', minimum: 0,
                 description: 'How many citation-bearing statements in the answer were examined.' },
      flags: {
        type: 'array',
        description: 'One entry per unsupported or misattributed statement. Empty if everything is supported.',
        items: { type: 'object',
                 properties: {
                   excerpt: { type: 'string', description: 'The first words of the unsupported statement, at most 120 characters.' },
                   issue:   { type: 'string', description: 'One sentence: what the cited record actually says, or why the statement is unsupported.' },
                 },
                 required: ['excerpt', 'issue'] },
      },
    },
  },
}
```

And it runs **behind** a deterministic layer that involves no model at all: quoted
spans and numeric cores extracted from the answer and matched against the literal
text of everything gathered. That layer cannot be argued with, and its results ship
even when the model leg is skipped near the deadline.

---

## 9. Server tools and client tools in one call

Discovery passes both a server-side tool and a client tool in the same `tools`
array, so the model searches and returns structured output in one turn
(`lib/pipeline/web.ts`):

```ts
const tools = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: opts.maxUses ?? 3,
    // Server-side filtering: known PR-wire/SEO-farm domains (plus domains the
    // funnel has learned never yield) never even appear in results.
    ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
  },
  {
    name: 'submit_candidates',
    description: 'Return every candidate item found, with no filtering or evaluation.',
    input_schema: { /* url, headline, source_domain, published_date */ },
  },
];
```

`blocked_domains` filters at the search rather than after it, which is cheaper than
rejecting the same junk at triage and returns useful results in its place. The
deny-list is partly curated and partly learned from the funnel's own outcomes.

The user turn separates the job from the judgment, which matters because the next
stage is the one that judges:

```
CRITICAL: Do NOT evaluate significance or quality. Do NOT summarize. Do NOT filter
based on your judgment of what matters. Your only job is to return a structured list
of items that plausibly match the lens. Prefer primary sources and serious analysis
over aggregators and listicles, but when unsure, INCLUDE it, the next step filters.
```

**One SDK caveat encoded in the code**: the pinned SDK's stream accumulator predates
server-tool blocks, so on a streamed `web_search` call `finalMessage().content`
collapses to bare text with no `server_tool_use` or `web_search_tool_result` blocks.
Web sources are captured from the raw stream events instead. This is re-checked on
every SDK upgrade.

---

## 10. Budgets are per call, not global

Three budgets are set per caller rather than by a global default.

**Output tokens** bound the shape of the answer: 900 for a mapping call, 1,200 per
deep round, 1,500 for a quick answer, 2,000 for the final deep answer, 700 for a
verification report, 4,000 for discovery.

**Wall clock and retries** are set against the platform budget:

```ts
const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 0 });
```

with the reasoning recorded at the call site:

```
// Bound the call under the Hobby 60s cap: abort at 50s and DISABLE SDK retries
// (maxRetries:0). A web-search call is long (~30-50s), so even one in-call SDK
// retry would run past 60s and die as a platform 504 (the opaque "unexpected
// response"). With retries off, a slow call throws cleanly at 50s, under the cap,
// and the orchestrator retries the whole batch on a fresh invocation.
```

The general rule: **retry at the orchestration layer, not inside the call.** A
retry inside a near-cap call converts a recoverable timeout into an opaque platform
error and loses the checkpoint.

**Batch size** bounds the output array. Triage processes 40 candidates per call:

```ts
// Max candidates per triage chunk. Two ceilings at once: keeps each decisions
// array within the output budget (no truncation -> no silent fail-close), and
// keeps each call's wall-clock well under the 60s cap.
const TRIAGE_CHUNK = 40;
```

The failure mode being designed against is specific: an output array truncated
mid-generation would silently drop decisions, and the caller could not distinguish
that from a genuine result.

---

## 11. Post-validation: output is a proposal

Schema conformance is not correctness. Every call that names a record passes a
filter before anything is written. The mapping post-filter is the pattern:

```ts
const byCode = new Map([...claims, ...bridges].map(x => [x.code, x.statement]));
const seen = new Set<string>();
const proposals = [];
for (const p of Array.isArray(out.proposals) ? out.proposals : []) {
  if (proposals.length >= 5) break;                 // cap, since schema can't express it
  const code = String(p?.code ?? '').trim();
  const resolved = byCode.get(code);
  if (!resolved || seen.has(code)) continue;        // invented or duplicate code: dropped
  seen.add(code);
  proposals.push({ code, statement: resolved, why: String(p?.why ?? '').trim() });
}
```

Note that `statement` comes from the database, not from the model. The model
supplies a code and a justification; the human-readable text is resolved locally,
so a model that paraphrases a claim while citing it cannot alter what the reader
sees.

The same discipline elsewhere:

- **Gap recommendations** pass `validateGapRecommendations` in a pure, Node-tested
  module. Every recommendation must cite its grounding or is dropped, novelty is
  checked against live nodes, and returning nothing is a normal outcome.
- **Report narratives** pass the citation gate, which downgrades any anchor outside
  the allowlist to a plain `span` and records it as dropped, at generate, at save,
  and again at render.
- **Signal claim touches** are resolved to live claim ids at publish time, and a
  code that no longer names a real node is skipped rather than failing the write.

**Belt and braces on house style.** Every user-facing prompt carries a "never use
an em dash" instruction, and the deep route also runs a deterministic backstop:

```ts
const scrub = (s: string): string => s.replace(/\s*—\s*/g, ', ');
```

The prompt asks and the code enforces. That pairing is the pattern throughout.

---

## 12. Every call is metered

`recordApiCall` is a required argument on the seam, not an optional wrapper:

```ts
await recordApiCall({
  feature: opts.feature,        // 'thesis_map', 'ask_deep', 'tearsheet_sections', ...
  model: MODEL,
  usage: msg.usage,             // input, output, cache_creation, cache_read
  wallMs: Date.now() - t0,
  pipelineRunId: opts.pipelineRunId,
  metadata: opts.metadata,      // e.g. { round: 3 } or { round: 'verify' }
});
```

Rows are priced against a rate card frozen at call time, so historical costs stay
correct when prices change. Server-tool web searches bill per request on top of
tokens, which a token rate card cannot express, so a flat surcharge folds in:

```ts
// Server-tool web searches bill ~$10 per 1,000 requests ON TOP of tokens;
// the token rate card can't price them, so a flat per-search surcharge
// folds into the frozen cost (and thereby into the portal's daily budget).
const WEB_SEARCH_USD = 0.01;
```

That surcharge is what lets the key-gated portal tier enforce a real daily spend
cap rather than an approximate one.

---

## 13. A worked example, end to end

**Question:** "Is enterprise AI ROI real?" typed into the workspace.

**1. Retrieval.** `retrievalQuery` takes the latest turn plus the previous one,
capped at 1,200 characters. Postgres full-text search runs over the generated
tsvector columns with the lexemes OR-combined, because `websearch_to_tsquery` ANDs
every term and a natural-language question then matches nothing:

```sql
replace(websearch_to_tsquery('english', $1)::text, '&', '|')::tsquery
```

`ts_rank` still orders records matching more terms first. Codes and slugs literally
present in the question get exact lookups, and matched records expand one hop into
their evidence and touching signals. The detail blob is capped at 6,500 characters
with 600 characters per field so no single record crowds out the rest.

**2. Assembly.**

```
system:  [ASK_SYSTEM]                                    <- cached, ~1,900 tokens
message: user
           [FULL MAP + DATASETS skeleton]                <- cached, ~2,400 tokens
           [RELEVANT RECORDS: ...detail...
            ----
            QUESTION: Is enterprise AI ROI real?
            Answer using only the records above...]      <- uncached, volatile
```

**3. The call.** `claude-haiku-4-5`, `max_tokens: 1500`, streamed.

**4. The answer** cites `[claim 3.3]`, `[bridge B1]`, `[signal S2]`, `[paper P13]`.
Signal and paper tags come from the tagger, so the client can resolve each chip to a
UUID and open the record panel.

**5. Verification** on request: every cited record is refetched by
`fetchRecord`, the deterministic layer extracts quoted spans and figures and matches
them against the literal record text, then the model layer returns per-statement
verdicts. On a live run this morning:

```
verification: 10 of 11 cited statements supported · 4/4 figures found in records
! "evidence on [bridge B1] notes that workforce wariness, with 48% of Gen Z saying
   risks outweigh benefits": The cited records do not contain a claim that 48% of
   Gen Z say risks outweigh benefits; this figure appears nowhere in the provided
   records.
```

The flag is shown to the reader and nothing is silently rewritten.

---

## 14. The five points to land

If the question comes up in a room, these are the claims worth making, in order of
how much they distinguish the build:

1. **Forced tool calls with strict schemas.** No prose parsing anywhere. The output
   contract is a JSON schema and the API enforces it.
2. **Payloads ordered by volatility with explicit cache breakpoints**, including a
   rolling anchor in the agentic loop that keeps a growing conversation inside the
   four-breakpoint budget.
3. **The full ID namespace ships in the cached block**, so a citable identifier can
   only be one the model was shown, and a post-filter drops anything else. Belt and
   braces on the same failure.
4. **Budgets are per call and degrade gracefully**: rounds, calls per round, result
   size, context tokens from real usage counters, and a wall deadline that reserves
   time to finish the answer.
5. **Every call is metered by feature slug** against a rate card frozen at call
   time, which is what makes a spend cap enforceable rather than aspirational.

The plain framing for the last one: this architecture is what falls out of taking
two constraints seriously, that the model must never invent an
identifier and that every call must be attributable, and then refusing to special
case anything.
