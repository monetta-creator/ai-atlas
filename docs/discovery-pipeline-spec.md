# Building a web intelligence pipeline

### A technical spec of the AI Atlas discovery pipeline, plus a playbook for adapting it

**Audience:** an engineering team that needs to keep a recurring deliverable current from public
web sources, and has tried to get there with an AI assistant without success.

**What this document is.** Part 1 through Part 5 describe a working system: a discovery pipeline
that finds, fetches, filters, and interprets public web content on a weekly cadence, and hands a
human a reviewed queue instead of a pile of links. The web-acquisition layer (Part 2) gets the
most space, because that is the part that breaks in ways nobody warns you about.

Part 6 is the practical half: how to port these patterns into whatever environment you actually
have, with degraded versions for each capability you turn out not to be allowed, a phased build
order, and prompts you can paste into Claude to get moving today.

Part 7 lists what this system deliberately does **not** do, and what you must add before running
anything like it inside a company.

**Provenance.** This describes a real production system (the AI Atlas, a Next.js + TypeScript +
Postgres app on Vercel). File paths and line numbers are cited so claims are checkable, but every
explanation is written to stand on its own without repo access. Nothing here is specific to
Next.js: the four stages, the failure taxonomy, and the checkpoint model port to Python, Go, a
notebook, or Apps Script.

---

## Contents

- [Part 0 · Read this first](#part-0--read-this-first)
- [Part 1 · Pipeline architecture](#part-1--pipeline-architecture)
- [Part 2 · The web-acquisition layer](#part-2--the-web-acquisition-layer)
- [Part 3 · Checkpointing and resumability](#part-3--checkpointing-and-resumability)
- [Part 4 · The learning loop](#part-4--the-learning-loop)
- [Part 5 · Cost and observability](#part-5--cost-and-observability)
- [Part 6 · Adaptation playbook](#part-6--adaptation-playbook)
- [Part 7 · What a corporate deployment must add](#part-7--what-a-corporate-deployment-must-add)

---

## Part 0 · Read this first

### What the system does

Once a week, an operator opens a console and clicks three buttons. The pipeline runs roughly 20
short web searches across six subject areas, collects a few hundred candidate URLs, filters them
down to a few dozen worth reading, fetches the full text of each one, has a model read each
article and propose a structured entry (title, summary, significance, which of the tracked claims
it bears on and in which direction), and saves every proposal as an **unpublished draft**. The
operator reviews the drafts and publishes the ones that hold up. Publishing is what makes a
finding count.

The output is not a list of links. It is a reviewed, structured, deduplicated queue with the
reading already done.

### The reframe: this is not scraping

If your mental model is "point an extractor at a list of sites and pull the DOM," you will build
something that is brittle, hostile to its targets, and perpetually behind. This pipeline is
shaped differently:

```
  RETRIEVE          FILTER              INTERPRET             COMMIT
  search the web    cheap deterministic  model reads full     human reviews
  broadly, keep     rules first, then    text, returns        drafts and
  everything        one model pass       structured JSON      publishes
       │                  │                    │                  │
   ~300 URLs          ~40 survive          ~40 drafts        ~15 published
```

Four properties matter more than any implementation detail:

1. **Discovery is search-driven, not crawl-driven.** No site maps, no link graphs, no per-site
   extractors to maintain. You ask a search tool a question and it returns URLs. When a source
   redesigns its markup, nothing breaks.
2. **Filtering happens before the expensive step.** Deterministic rules (deny-listed domains,
   already-seen URLs) cost zero tokens and remove a large fraction. Only survivors reach a model.
   Only triage survivors get fetched and read.
3. **Fetching is a single hardened function**, not scattered `requests.get` calls. All the ugly
   knowledge (PDF detection, charset handling, paywall stubs, bot walls, control characters that
   corrupt a database write) lives in one place with one failure taxonomy.
4. **A human commits.** The model proposes; nothing enters the permanent record without a person
   approving it. This is not decoration. It is what makes the output trustworthy enough to put in
   front of someone senior.

### Why a single long agentic call fails

The most common failed attempt looks like: "an agent that searches the web, reads what it finds,
and writes me a summary." It fails for structural reasons, not model-quality reasons:

- **Time.** Web search is slow. Three searches in one call measured about 46 seconds in our
  environment. Add fetching and reading and you are minutes deep in a single request. Most
  hosting environments cap function duration (ours at 60 seconds). You get an opaque timeout
  with nothing saved.
- **No checkpoint.** When the long call dies at minute seven, everything it learned dies with
  it. Run it again and it redoes all the work, including the parts that already succeeded.
- **No funnel.** A single call cannot filter cheaply before spending expensively, because it is
  all one spend.
- **No audit.** You cannot see which query surfaced which URL, why a candidate was rejected, or
  what a fetch failure actually was.

The fix is the same in every environment: **decompose into many short units, and checkpoint
after every unit.** One unit is one lens's query batch, or one chunk of 40 triage decisions, or
one candidate's fetch. Each finishes in well under a minute and writes its result to durable
storage before returning. An orchestrator (in our case a browser page, but a shell loop works
equally well) drives the units. Anything that fails is retried on a fresh unit with everything
prior still intact.

This single change is the difference between "it times out and I don't know why" and "it runs
for twelve minutes and I can watch it."

### Scope and honesty

The Atlas is a single-user tool, run manually by its author, reading a few hundred public news
URLs a week. It has no `robots.txt` handling, no per-host rate limiting, and no legal review of
its target list. Those omissions are survivable at that scale under one person's own judgment.
They are **not** survivable inside a company. Part 7 says exactly what is missing and what to add.
Read it before you copy the fetch layer.

---

## Part 1 · Pipeline architecture

Four stages. Each is a series of short, independently retryable units. All state lives in
Postgres, so the pipeline survives a closed browser tab, a timeout, or a crash.

```
  1 DISCOVERY          2 TRIAGE              3 ANALYSIS           4 COVERAGE
  ~20 search units     N/40 model chunks     2 units/candidate    1 unit, advisory
  writes candidates    writes decisions      writes draft         writes audit
```

### 1.1 Discovery: model-driven search

**Unit of work:** one subject area ("lens"), two search queries, one API call, about 30 seconds.
A weekly run has roughly 20 such units plus one sweep. Three run concurrently.

We use Anthropic's server-side web search tool on a standard `messages.create` call. The tool
runs the searches inside the request; the model then calls a client-side tool we define to hand
back structured results.

```ts
// lib/pipeline/web.ts:84
const tools = [
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: opts.maxUses ?? 3,
    ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
  },
  {
    name: 'submit_candidates',
    description: 'Return every candidate item found, with no filtering or evaluation.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              url: { type: 'string' },
              headline: { type: 'string' },
              source_domain: { type: 'string' },
              published_date: { type: 'string' },
            },
            required: ['url', 'headline', 'source_domain', 'published_date'],
          },
        },
      },
      required: ['candidates'],
    },
  },
];
```

Notes that transfer to any search-tool setup:

- **`blocked_domains` and `allowed_domains` are mutually exclusive.** You get one or the other on
  a given call. Our lens batches use a blocklist; our quality sweep uses an allowlist.
- **Filter at the search, not after.** Blocked domains never appear in results, which is cheaper
  than rejecting them later and frees result slots for real items.
- **The client tool is how you get structured output.** The search tool returns prose; the
  `submit_candidates` schema is what turns that into rows.
- **No SDK retries.** The client is constructed with `timeout: 50_000, maxRetries: 0`. A web
  search call takes 30 to 50 seconds; a single in-SDK retry would blow past the platform's 60
  second cap and surface as an opaque gateway error. With retries off, a slow call fails cleanly
  at 50 seconds and the orchestrator retries the whole unit on a fresh invocation.

**Recall-first prompting.** The discovery prompt explicitly forbids judgment:

> Do NOT evaluate significance or quality. Do NOT summarize. Do NOT filter based on your judgment
> of what matters. Your only job is to return a structured list of items that plausibly match the
> lens. Prefer primary sources and serious analysis over aggregators and listicles, but when
> unsure, INCLUDE it, the next step filters.

This matters. A model asked to both find and judge in one pass will quietly drop things, and you
will never know what you did not see. Separate recall from precision and you can tune each.

**Query templating and staleness.** Queries are templates with `{year}` and `{month}` tokens
resolved from the run's window start:

```ts
// lib/pipeline/config.ts:155
export function resolveDateTokens(queries: string[], sinceISO?: string): string[] {
  let d = sinceISO ? new Date(`${sinceISO}T00:00:00Z`) : new Date();
  if (Number.isNaN(d.getTime())) d = new Date();
  const year = String(d.getUTCFullYear());
  const month = MONTH_NAMES[d.getUTCMonth()];
  return queries.map((q) => q.replaceAll('{year}', year).replaceAll('{month}', month));
}
```

Two bugs this fixes, both learned the hard way:

1. A hardcoded year goes stale every January and nobody notices.
2. A year-only query is **evergreen**, and evergreen queries match SEO listicles titled with
   those exact phrases instead of the week's news. Our pipeline missed a major model release for
   three days because every capability query was phrased like an article title rather than like
   news. Adding `{month}` to the news-shaped queries pulled results toward current coverage.

UTC is deliberate, so a unit retried two days later produces the same query text as its siblings.

**Query lists as illustration.** Ours are curated per lens. The contents are entirely specific to
our subject matter and yours will share nothing with them, but the shape is worth copying:
5 to 9 queries per subject area, split into batches of 2 per API call.

```ts
// lib/pipeline/config.ts:49 (excerpt)
capability: [
  'new frontier AI model release announcement {month} {year}',
  'Chinese AI lab model release Kimi Moonshot Qwen GLM MiniMax {month} {year}',
  'open source open weight AI model release benchmark {month} {year}',
  'AI model benchmark evaluation contamination {year}',
  'agentic AI autonomous deployment production reliability {year}',
  // ...
],
```

**The breaking sweep: a recall backstop.** Thematic queries find what they literally name. They
cannot find the thing you did not think to name. So every run also gets one lens-agnostic,
significance-first unit over a curated allowlist of quality outlets, asking in effect "what did
the serious press report since the window opened," with the model assigning each result to a
subject area itself.

One hard constraint we discovered live: **every domain in an `allowed_domains` list must be
crawlable by the search provider's agent, or the API rejects the entire call.** Reuters, AP,
NYT, WSJ, FT, The Economist, The Verge, and Ars Technica all block it, so none of them can appear
in an allowlist even though they are excellent sources. They can still appear in ordinary
unrestricted search results. Test your allowlist before you rely on it.

**Post-processing.** Results are cleaned before insert: drop anything that is not `http(s)`, trim,
backfill the domain from the URL, and infer a publication date where the model returned none.
That last one exists because undated items escape the recency window:

```ts
// lib/pipeline/web.ts:35 — arXiv IDs encode the submission month (2505.18893 -> 2025-05)
export function inferPublishedDate(url: string, modelDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(modelDate)) return modelDate;
  const m = /arxiv\.org\/(?:abs|pdf|html)\/(\d{2})(\d{2})\./i.exec(url);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `20${m[1]}-${m[2]}-01`;
  return modelDate;
}
```

Without it, year-old papers sailed into a seven-day run.

### 1.2 Triage: two passes, cheap first

**Unit of work:** up to 40 pending candidates, one model call, well under a minute. The
orchestrator calls it in a loop until nothing is pending.

**Pass 1 is deterministic and free.** For each candidate:

- If its domain is on the curated low-quality list (PR wires, SEO farms, stock-tip aggregators),
  reject it with reason `low credibility: <domain>`.
- Otherwise, if its normalized URL is already tracked, mark it `duplicate` with reason
  `already tracked`.

URL normalization is what makes the dedup actually work:

```ts
// lib/pipeline/web.ts:46 — host without www, path without trailing slash,
// sorted query with tracking params dropped, fragment and scheme discarded
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const params = new URLSearchParams();
    [...u.searchParams.entries()]
      .filter(([k]) => !/^utm_/i.test(k) && !/^(fbclid|gclid|mc_cid|mc_eid|igshid)$/i.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([k, v]) => params.append(k, v));
    const path = u.pathname.replace(/\/+$/, '');
    const qs = params.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}
```

**Pass 2 is one model call over the survivors.** Prompt construction is deliberately split for
caching:

- The **system block** holds everything identical across chunks: the triage instructions, a
  digest of up to 200 existing entries (so the model can flag duplicates by story rather than by
  URL), and the operator's own reliability ratings for known outlets. This block is marked
  cacheable, so chunks 2 through N read it from the prompt cache instead of re-billing it.
- The **user block** holds what varies per chunk: the funnel's own track record with these
  specific domains, and the numbered candidate list.

The **materiality override** is the single most important line in the triage prompt:

> MATERIALITY OVERRIDE: if a candidate reports a plausibly major development (a frontier or
> open-weight model release, a major regulatory or export-control action, a major lab or
> government announcement) that NO existing signal covers, approve it even when the source is
> weak or an aggregator: the analysis step reads the full text and a human still gates
> publication. A weak source carrying a minor or already-covered story stays rejected. Judge the
> story, not only the carrier.

Without it, source-quality heuristics reject the aggregator that happens to be the only outlet
carrying a genuinely major event. Judge the story, not only the carrier.

**Fail closed.** If the model returns no decision for an index, that candidate is rejected with
reason `no decision returned`:

```ts
// lib/pipeline/triage.ts:142
const status: TriageStatus =
  d && allowed.includes(d.status) ? (d.status as TriageStatus) : 'rejected';
const reason = d ? String(d.reason ?? '').slice(0, 300) : 'no decision returned';
```

This is why the chunk size is 40 rather than 200. A truncated output array would silently reject
real candidates, and you would have no way to tell. The chunk size is chosen so the decisions
array cannot approach the output token budget.

### 1.3 Analysis: two invocations per candidate

**Why split.** A fetch can take 20 seconds against a slow host, and the model leg needs up to 38.
Together they do not reliably fit a 60 second budget. So each candidate gets two independent
invocations:

**Invocation A, hydrate.** Fetch the page, extract readable text, write it to the candidate row
along with which path succeeded (`direct` or via the reader). It gets the full budget to itself,
which is what makes slow hosts and large PDFs survivable. It is idempotent: if text is already
cached, it returns immediately.

**Invocation B, analyze.** Read the cached text, make one structured model call, write a draft.

The analyze schema forces the model into a closed vocabulary:

```ts
// lib/pipeline/analysis.ts:47 — the live claim codes become a schema ENUM,
// so the model cannot cite a target that does not exist
code: codes.length ? { type: 'string', enum: codes } : { type: 'string' },
```

Everything the model returns is then **coerced and allow-listed anyway**, because a schema is not
a guarantee:

```ts
// lib/pipeline/analysis.ts:147
const significance = ['high','medium','low'].includes(out.significance) ? out.significance : 'medium';
const lenses = Array.isArray(out.lenses)
  ? Array.from(new Set(out.lenses.filter((l) => validLens.has(l)))) : [];
const claim_touches = Array.isArray(out.claim_touches)
  ? out.claim_touches
      .filter((t) => t && validCode.has(t.code) && !seen.has(t.code) && seen.add(t.code))
      .map((t) => ({ code: t.code,
                     direction: validDir.has(t.direction) ? t.direction : 'neutral',
                     reason: String(t.reason ?? '').slice(0, 2000) }))
  : [];
const proposed_reliability = Math.max(0, Math.min(100, Math.round(Number(out.proposed_reliability) || 0)));
```

Enum fallbacks, set-membership filtering, dedup by key, length clipping, numeric clamping. Assume
the model returns something structurally valid and semantically wrong, and write code that
survives it.

**One guardrail worth naming.** The model returns a `proposed_reliability` score for the source.
That value is shown to the operator as a suggestion and is **never** written to the source's
stored reliability prior. The model is allowed to recommend; it is not allowed to change the
inputs to future judgments. Pick your equivalent of this line and hold it.

**The draft is always unpublished.** Publication is the human gate, and it is where a draft's
findings actually enter the permanent record.

### 1.4 Coverage check: auditing what you missed

After a run completes, one more web-enabled unit re-derives the window's biggest developments
from scratch and marks each one covered or missed against what the run actually found.

The critical design choice: **it uses deliberately different query phrasing from the discovery
sweep.** If it reused the same queries it would mostly re-find what the sweep just inserted and
rubber-stamp the run. Different phrasing makes it a real check.

It is advisory only. It writes its findings to the run record, renders as a covered / possible
miss panel in the console, and is wrapped in a try/catch so it can never fail a run. Its value is
that a silent miss becomes a visible one. This system exists because a major event sat in three
major outlets for three days and the run surfaced none of them, with no indication anything was
wrong.

---

## Part 2 · The web-acquisition layer

This is the part you asked about, and the part where most of the hard-won knowledge lives. Every
candidate is fetched through **one function**. Nothing else in the codebase issues an outbound
content fetch.

### 2.1 The entry point

```ts
// lib/pipeline/web.ts:478
export async function fetchCandidateText(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number; allowFallback?: boolean; preferJina?: boolean } = {}
): Promise<FetchedText>   // { text: string; via: 'direct' | 'jina' }
```

Decision tree:

```
  assertPublicHttpUrl(url)            ← SSRF guard, covers BOTH paths below
        │
        ├── preferJina && allowFallback?
        │      reader first  →  ok? return {via:'jina'}
        │                       fail? try direct as insurance
        │                             ok? return {via:'direct'}
        │                             fail? throw the DIRECT error (more diagnostic)
        │
        └── otherwise
               direct first  →  ok? return {via:'direct'}
                                fail?
                                  !allowFallback || !err.canFallback → throw
                                  else reader → ok? return {via:'jina'}
                                                fail? re-mix terminality, throw
```

`preferJina` reverses the order for domains whose history says a direct fetch is doomed (see
Part 4). The direct path is still attempted as insurance, because the history can be wrong.

### 2.2 SSRF guard

Any system that fetches a URL derived from model output or user input can be talked into
fetching an internal address. Guard it:

```ts
// lib/pipeline/web.ts:268
function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('invalid url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('non-http url');
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === '0.0.0.0' || host === '[::1]' ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||   // link-local incl. cloud metadata 169.254.169.254
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('blocked host');
  return u;
}
```

**Be clear about its limit.** This is hostname string matching. It does **not** resolve DNS, so a
public hostname that resolves to a private IP passes straight through. It also does not re-check
after redirects. For a corporate deployment, resolve the hostname and check the resulting IP
against private ranges, and either disable redirects or re-validate each hop. Ours is
defense-in-depth on an admin-only trigger over public news URLs; yours may not have that luxury.

Note it is applied **before** the branch, so the reader fallback is covered too. A third-party
reader service will happily fetch an internal URL on your behalf if you let it.

### 2.3 Request shape

```ts
// lib/pipeline/web.ts:334
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; AIAtlasBot/1.0; +https://ai-atlas)',
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};
```

- **Timeout** is an `AbortController` with a 20 second default, cleared in a `finally`. Every
  outbound fetch must have one; a hung socket otherwise consumes your whole invocation budget.
- **Redirects** follow with the platform default hop limit.
- **Size ceiling** is 20 MB, checked twice: against the declared `content-length` before reading
  the body, and against the actual byte length after. The first check saves you the download; the
  second catches servers that lie or omit the header.
- No cookies, no referer, no per-host header customization.

On the User-Agent: the format is right (identify yourself, provide a contact URL) but ours points
at a placeholder that does not resolve. That is a real defect, called out again in Part 7. Use a
UA that names your organization and links to a page a site operator can actually read.

### 2.4 Extraction: bytes to text

**PDF detection cannot trust the content type.** CDNs serve PDFs as `application/octet-stream`
routinely. Check the magic bytes:

```ts
// lib/pipeline/web.ts:341
function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  if (/application\/pdf/i.test(contentType)) return true;
  return bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d;   // "%PDF-"
}
```

PDFs go through `unpdf` (a serverless build of pdf.js), dynamically imported so it is not loaded
on paths that never see a PDF. A PDF extraction failure is classified **terminal**: the same bytes
will fail the same way, so retrying is pure waste.

Non-PDF content is decoded with the declared charset, falling back to UTF-8 when the label is
missing or invalid (`new TextDecoder(badLabel)` throws, so it is wrapped), then run through an
HTML-to-text pass.

**Our HTML-to-text is crude and you should do better.** It strips script, style, noscript, and
comments, drops all remaining tags, decodes six entity forms, and collapses whitespace. There is
no DOM parser and no boilerplate removal, which means navigation, footers, and cookie banners
survive into the model prompt and can consume a meaningful share of the 24,000 character budget
on chrome-heavy sites before the article body is reached.

If you have the dependency budget, use a real readability extractor: **trafilatura** (Python) or
**@mozilla/readability** with a DOM (JS). It is a straight upgrade in both extraction quality and
tokens spent. We stayed crude because our serverless bundle size mattered more; that tradeoff is
probably not yours.

### 2.5 Sanitization: the bug that will bite you

```ts
// lib/pipeline/web.ts:313
export function sanitizeText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\p{Surrogate}/gu, '');
}
```

Two lines, and they exist because of a run-killing production failure. Postgres `text` columns
cannot store a NUL byte: you get `invalid byte sequence for encoding "UTF8": 0x00` from an insert
that looks completely unrelated to the fetch that caused it. Binary content decoded as text is
full of them. Lone surrogates (from truncated multi-byte sequences, which is exactly what a
character-count `slice()` produces) break the driver in a different way.

Strip C0 control characters (keeping tab, newline, carriage return) and unpaired surrogates
**before anything touches storage**. Apply it defensively at the storage boundary too, not only at
the fetch, so a second code path cannot reintroduce the problem. Every language has this issue;
only the error message differs.

### 2.6 The failure taxonomy

This is the most portable idea in the whole layer. **Classify failures instead of counting
retries.**

```ts
// lib/pipeline/web.ts:299
export class FetchFailure extends Error {
  readonly terminal: boolean;    // retrying the same URL fails the same way
  readonly canFallback: boolean; // a different fetcher could plausibly succeed
  constructor(message: string, terminal: boolean, canFallback = true) {
    super(message);
    this.name = 'FetchFailure';
    this.terminal = terminal;
    this.canFallback = canFallback;
  }
}
```

Two independent axes, and they answer two different questions: *should I try again?* and *should I
try differently?*

```ts
// lib/pipeline/web.ts:324
const TERMINAL_HTTP  = new Set([400, 401, 402, 403, 404, 405, 406, 410, 451]);
const NO_FALLBACK_HTTP = new Set([400, 404, 405, 410]);
```

`429` and `5xx` and timeouts stay **transient**: retrying is exactly right. `401`, `403`, and `451`
are terminal for a retry but **fallback-eligible**, because they are access walls and a different
fetcher often gets through. `400`, `404`, `405`, `410` mean the URL itself is wrong or dead, so
nothing can help.

Full classification table:

| Condition | terminal | canFallback | Reasoning |
|---|---|---|---|
| invalid or blocked URL | yes | no | nothing to fetch |
| HTTP in `TERMINAL_HTTP` | yes | unless in `NO_FALLBACK_HTTP` | access wall vs dead URL |
| HTTP 429 / 5xx | no | yes | transient server state |
| timeout / network error | no | yes | transient |
| document over 20 MB | yes | yes | not an article |
| PDF extraction failed | yes | yes | same bytes, same failure |
| HTTP 200 with under 200 chars | yes | **yes** | paywall or JS stub, exactly what a reader beats |
| reader returned non-2xx | 429/5xx no, else yes | no | nothing left to try |
| reader returned a block stub | yes | no | upstream refused |

That second-to-last row in the direct section is worth dwelling on. A 200 response with almost no
text is not a success. It is a cookie wall, a paywall stub, or a JS shell. Treat it as a
classified failure with a minimum-length gate:

```ts
export const MIN_READABLE_CHARS = 200;
```

**Terminality re-mixing.** When both paths fail, the combined result is not simply the direct
error:

```ts
// lib/pipeline/web.ts:532
if (direct.terminal && !reader.terminal) {
  throw new FetchFailure(`${direct.message} (${reader.message})`, false);
}
throw direct;
```

A transient reader failure (rate limit, timeout) sitting behind a terminal direct failure must
surface as **transient**. Otherwise the orchestrator permanently flags a candidate that the next
attempt's fallback would have fetched fine. This is a two-line rule that took a bad run to find.

### 2.7 The reader fallback

For bot-walled, paywalled, or unparseable URLs, we fall back to `r.jina.ai`, a hosted service that
renders a page (PDFs included) and returns plain text. The WAF fingerprinting that 403s a direct
server fetch does not apply to it.

```ts
// lib/pipeline/web.ts:439
const headers: Record<string, string> = { Accept: 'text/plain', 'X-Return-Format': 'markdown' };
const key = process.env.JINA_API_KEY;
if (key) headers.Authorization = `Bearer ${key}`;
const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers });
```

Keyless use is rate-limited per IP; the API key is optional and lifts that. Timeout is 25 seconds.

**The stub trap.** The reader reports an upstream block as an HTTP 200 wrapping a stub page, along
the lines of `Title: Just a moment... Warning: Target URL returned error 403`. Without detection,
that stub sails past the minimum-length gate and into the model, which then confidently
summarizes a Cloudflare challenge page.

```ts
// lib/pipeline/web.ts:456
const blocked = /Warning: Target URL returned error (\d+)/.exec(text.slice(0, 600));
if (blocked) throw new FetchFailure(`reader: target returned ${blocked[1]}`, true, false);
```

Generalize the lesson: **any intermediary can return 200 for an upstream failure.** Inspect the
content, not only the status code.

If a hosted reader is not allowed on your network, the same role can be played by a headless
browser you run yourself (Playwright) or by an approved commercial fetch API. What matters is
that the architecture has *a second way to get the bytes* and knows when to use it.

### 2.8 Where retries live

**Not in the fetch layer.** The fetch layer classifies and throws. The orchestrator decides.

That separation is deliberate: each retry is a **fresh invocation with a fresh time budget**, so a
retry inside the function would eat the very budget the retry needs. Orchestrator policy:

| Stage | Attempts | Backoff | Early exit |
|---|---|---|---|
| discovery batch / sweep | 3 | `attempt × 1500 ms` | none |
| triage chunk | 3 | `attempt × 1500 ms` | rethrows, fails the run |
| hydrate (fetch) | 3 | `2000 ms × attempt` | **stops immediately if `terminal`** |
| analyze (model) | 3 | `3000 ms × attempt`, or `10000 ms × attempt` on HTTP 429 | stops if `terminal` |

The `terminal` early exit is where the taxonomy pays for itself. Before it, a doomed candidate
burned three attempts plus backoff, every run, forever.

One implementation detail specific to server-side frameworks: **thrown server-action errors are
redacted in production**, so the hydrate action returns failures as *data* (`{ok: false, error,
terminal}`) rather than throwing. Otherwise the orchestrator sees "an error occurred" and can
make no decision at all. Check whether your framework does something similar.

### 2.9 Call-site parameters

The same function, tuned per caller:

| Caller | maxChars | timeoutMs | allowFallback | preferJina |
|---|---|---|---|---|
| hydrate (the normal path) | 24000 | 20s | yes | from domain history |
| analysis backstop | 24000 | **8s** | **no** | no |
| research intake, HTML | 24000 | 20s | **no** | no |
| research intake, PDF | 24000 | 20s | yes | no |

The analysis backstop exists only for manual flows and older clients that skipped hydration. It
is kept on a tight leash precisely so fetch plus model still fit one invocation if it ever fires.

---

## Part 3 · Checkpointing and resumability

Two tables carry all pipeline state. The pattern ports to SQLite, a spreadsheet, or a directory
of JSON files; only the substrate changes.

### 3.1 The run table

One row per run. Carries `status` (running / completed / failed), `step` (discovery / triage /
analysis / complete), `cadence`, a set of running tallies, an error string, and an advisory
coverage blob.

### 3.2 The candidate table

One row per discovered URL, and this is where the real state lives:

| Column | Role |
|---|---|
| `run_id`, `url` | identity; **`unique (run_id, url)`** makes discovery idempotent |
| `headline`, `source_domain`, `published_date`, `lens` | what discovery found |
| `discovery_queries` | which query batch surfaced it |
| `triage_status` | pending / approved / rejected / duplicate |
| `triage_reason` | why, in one clause |
| `raw_content` | the fetched text, cached |
| `fetched_via` | `direct` or `jina` |
| `analysis_status` | pending / drafted / error / discarded |
| `analysis_error` | the classified failure message |
| `signal_id` | set when the candidate becomes a draft |

**Two independent status axes.** `triage_status` answers "did this pass the filter"; `analysis_status`
answers "did we manage to read and draft it." Collapsing them into one column makes both views
lie: a fetch failure would look like a triage rejection, and the funnel's conversion rate would
silently absorb your infrastructure problems. Keep them separate.

### 3.3 Idempotency mechanisms worth copying verbatim

1. **Unique constraint on `(run_id, url)` with insert-or-ignore.** Re-running a discovery unit
   inserts nothing new. This is what makes a blind retry safe.
2. **Row lock plus a null check before creating a draft.** The analysis step opens a transaction,
   selects the candidate `for update`, and proceeds only if `signal_id is null`. A concurrent or
   retried call loses the race and returns cleanly instead of creating a duplicate.
3. **Recompute tallies, never increment them.** All three run counters are derived by subquery
   from the candidate table. An incremented counter double-counts the moment anything is retried;
   a derived one cannot be wrong.
4. **Draining status as the cursor.** Triage fetches "the next 40 where status is pending." Writing
   a decision removes the row from that set. There is no offset to track, no cursor to store, and
   a partially-triaged run resumes correctly by construction.

### 3.4 The resume rule

```ts
// components/PipelineConsole.tsx:42
const resumeId =
  latestRun &&
  (latestRun.status === 'running' ||
   latestRun.status === 'failed' ||
   pendingAnalysisIds.length > 0)
    ? latestRun.id
    : null;
```

Resume if the run is running or failed, **or** if any candidate still has work left, regardless of
what the run row claims. A transient timeout must never strand candidates behind a run status that
says everything is fine.

Complementary guard: the "complete this run" action **refuses** to complete while any candidate is
pending. The orchestrator soft-checks first so the normal flow leaves the run resumable rather
than throwing, but the hard refusal is what prevents a half-processed run from being marked done.

---

## Part 4 · The learning loop

The pipeline gets better at its own job by reading its history. No separate statistics tables:
everything is derived on the fly from the candidate rows.

### 4.1 Zero-yield domain blocking

Domains that discovery keeps surfacing and triage never approves are SEO farms by observed
behavior, whatever they claim to be. They get fed into the search tool's `blocked_domains` so
they stop entering the funnel at all.

```sql
-- lib/data.ts:1700
select regexp_replace(lower(source_domain), '^www\.', '') as domain
  from signal_candidates
 where source_domain is not null and source_domain <> '' and triage_status <> 'pending'
   and created_at > now() - interval '90 days'
 group by 1
having count(*) >= $1
   and count(*) filter (where triage_status = 'approved'
                           or triage_reason like 'unanalyzable:%') = 0
   and count(*) filter (where triage_status = 'duplicate') = 0
 order by count(*) desc
 limit $2
```

Three guardrails, each added after the naive version did real damage:

**1. Duplicates count as yield.** A duplicate means the domain carried a real story that we
already track. It is a *hit*, not churn. Without this clause, a federal regulator's own site
qualified for auto-blocking because five of its six candidates were duplicates. The naive metric
would have blocked a primary source for being reliable.

**2. A never-auto-block allowlist.** Primary-source infrastructure and major wires can never be
auto-blocked no matter what their funnel record says. Ours covers arXiv, Hugging Face, GitHub,
the major wires and papers, the multilateral institutions, and the suffixes `.gov`, `.mil`,
`.edu`, `.gov.uk`, `.europa.eu`. This was added because Hugging Face qualified for blocking on
five rejected community blog posts, which would have hidden the single platform where every
open-weight model release actually lands. Behavioral metrics do not know what a source *is*.

Note the asymmetry: the allowlist filters only the **automatic** blocklist. The hand-curated
low-quality list is human judgment and is not second-guessed.

**3. A 90-day decay window.** A blocked domain never re-enters the funnel, so it can never earn
its way back, so without decay every block is permanent on the strength of one bad month. Only the
trailing 90 days count, so old rejections age out and a domain that starts publishing real work
can redeem itself.

That third point generalizes: **any automatic exclusion built from observed behavior must have a
path back, or it is a one-way ratchet.** Check every filter you build for this.

### 4.2 Fetch-hostile domain routing

```sql
-- lib/data.ts:1720 (condensed)
exists(... where fetched_via = 'jina'
             or analysis_error ~* '^HTTP 40[13]'
             or triage_reason ~* '^unanalyzable: (HTTP 40[13]|reader|page returned too little)') as hostile,
exists(... where fetched_via = 'direct') as direct_ok
-- hostile AND NOT direct_ok  ->  skip the doomed direct fetch, go straight to the reader
```

A domain that has needed the reader before, or has terminally access-walled a direct fetch, and
has **never** succeeded directly, gets `preferJina` on its next candidate. This is why the
`fetched_via` column exists: recording *how* a fetch succeeded turns into a routing decision later.

### 4.3 Track records in the triage prompt

The funnel's history with the current chunk's domains is injected into the triage user message,
with explicit guidance on how to read it:

> DOMAIN TRACK RECORD (this pipeline's own funnel history with these domains: many discovered with
> zero approved AND zero duplicates is low-value churn, lean reject unless the story itself is
> materially new; duplicates mean the domain carries real stories we already track, so do not hold
> them against it)

Two details worth copying. First, the stats are computed over **decided candidates only**, so a run
can never bias against a domain it just discovered this same run. Second, the guidance explains
how to interpret the numbers rather than trusting the model to infer it, and it repeats the
duplicates-are-yield rule, because the model would otherwise make the same mistake the naive SQL
made.

### 4.4 What we captured and never used

`discovery_queries` records which query batch surfaced each candidate. **Nothing reads it.** The
data for per-query hit-rate analysis (which of our 38 queries actually earn their API call, which
are dead weight) has been accumulating for months and has never been queried.

Mentioned because it is the cheapest available improvement and because it is a realistic picture
of how these systems get built: instrumentation is easy to add and easy to forget to use. If you
copy one thing from this section, copy the column *and* write the query that reads it.

---

## Part 5 · Cost and observability

Every model call writes one row to an append-only log: feature name, model, the four token counts
(input, output, cache write, cache read), wall-clock milliseconds, context utilization percentage,
computed cost, and a JSON metadata blob. Pipeline calls carry the run id, so a run's total cost is
one query.

Three design decisions worth copying:

**Price at write time, from a versioned rate card.** Rates live in their own table keyed by model
and effective date; the log row stores both the computed cost and the rate card id used. Cost is
never recomputed. When prices change you add a new card, and last quarter's numbers stay what they
were when you spent the money.

**Telemetry never throws.**

```ts
// lib/cost.ts:61 — the entire body is wrapped in try/catch with an empty handler
```

A missing rate card, a database hiccup, or a malformed usage object must never break the feature
being measured. Cost logging is best-effort by construction.

**Record what you cannot yet price.** Web search bills server-tool requests on top of tokens. Our
rate card is token-only, so the request count is stashed in metadata rather than dropped:

```ts
// lib/cost.ts:88
const webReq = u.server_tool_use?.web_search_requests;
if (typeof webReq === 'number' && webReq > 0) metadata.web_search_requests = webReq;
```

The cost figure is therefore an underestimate for discovery, which is a known and documented gap
rather than a surprise. Better an honest partial number than a confident wrong one.

**Per-candidate observability** comes from `analysis_status` plus `analysis_error`. Because the
analysis step never touches `triage_status` (except on the terminal give-up path, which is
explicit), the funnel view and the pipeline-health view stay independently honest. When something
degrades you can tell whether your filter got stricter or the web got harder to read.

---

## Part 6 · Adaptation playbook

### 6.1 Answer these five questions before writing code

1. **Can the machine that will run this make outbound HTTPS requests to arbitrary public hosts?**
   Try it: fetch three URLs from your intended source list, from the machine that will actually
   run the job, not from your laptop.
2. **Do you have a model API key, or only a chat interface?** These lead to genuinely different
   architectures. Find out before you design.
3. **Where can you persist state?** A Postgres instance, SQLite on disk, a Google Sheet, a folder
   of JSON files. Any of these work. "Nowhere" does not.
4. **What runs the job?** A scheduler, a person clicking a button, a script you run by hand. This
   determines how the units get driven, not whether the design works.
5. **What is the actual source list?** Not "the web." Twenty to forty specific domains, feeds, or
   query phrasings. If you cannot write this list, that is the first deliverable, and it is a
   subject-matter task rather than an engineering one.

Answer these in writing. Most of the failure modes in this document come from starting to build
before question 1 or question 3 had a real answer.

### 6.2 Degradation matrix

Every row degrades left to right. **The funnel shape and the checkpoint discipline survive every
tier.** Only the substrate changes.

| Capability | Full | Degraded | Floor |
|---|---|---|---|
| **Discovery** | model-integrated web search tool | your own search API (Brave, Serper, Bing) feeding the same candidate schema | hand-maintained URL list plus RSS/Atom feeds, which are free, structured, and still ubiquitous |
| **Fetch** | server fetch plus reader fallback | one approved fetch service, or a headless browser you run | operator pastes page text into a file; the rest of the pipeline is unchanged |
| **Extraction** | readability library plus PDF extraction | regex HTML-to-text (Part 2.4) | paste-as-text; you lose PDFs |
| **Model calls** | API key, forced-tool JSON schema | chat Claude with a strict "return only JSON matching this schema" prompt, pasted in batches | Claude as reviewer: you assemble the material, it judges and drafts |
| **Storage** | Postgres | SQLite, or a Google Sheet with one row per candidate | one JSONL file per run in a folder |
| **Orchestration** | worker pool, retries, live console | a shell or Python loop, sequential | run each stage by hand, one command at a time |

Three notes on the degraded tiers:

- **RSS is underrated.** Most serious publishers still ship feeds. A feed reader plus your triage
  and analysis stages is a complete pipeline with no search API at all, and it is dramatically
  more polite to the sources.
- **A Google Sheet is a legitimate checkpoint store.** One row per candidate, columns for the
  statuses. You lose transactions and row locks, so run one worker at a time. Everything else in
  Part 3 still applies, including drain-by-status and derive-do-not-increment.
- **Chat-only Claude still supports the funnel.** Paste 40 candidate headlines, ask for a JSON
  array of decisions, paste the JSON back into your sheet. It is slower and it is real. The
  materiality override and the fail-closed rule matter *more* here, not less.

### 6.3 Phased build order

Each phase produces something that works end to end. Do not build stage 2 of a five-stage
pipeline; build a thin complete spine and thicken it.

**P0 · The spine.** A fixed list of 10 URLs. Fetch each, extract text, one model call per page
returning a fixed JSON schema, append results to a JSONL file. No search, no triage, no database.
*Done when:* you run one command and get 10 structured records. Expect 3 of the 10 to fail; that
is the point, and it is what P1 is for.

**P1 · Failures and checkpoints.** Add the `terminal` / `canFallback` taxonomy from Part 2.6. Add
minimum-length detection. Add `sanitizeText`. Write each URL's status to a checkpoint file so a
rerun skips completed work and retries only what is transiently broken.
*Done when:* you can kill the process mid-run, restart it, and it picks up correctly.

**P2 · Discovery and cheap filtering.** Replace the fixed URL list with search (or feeds). Add the
deterministic triage pass: deny-list, URL normalization, dedup against everything already seen.
*Done when:* a run finds URLs you did not know about, and running it twice in a row produces zero
new work the second time.

**P3 · Model triage and prompt caching.** Add the model triage pass over survivors, in chunks.
Split system (stable, cached) from user (per-chunk) content. Add the materiality override. Add
fail-closed coercion.
*Done when:* your approval rate is somewhere between 10 and 30 percent and you agree with most of
the rejections when you spot-check the reasons.

**P4 · Learning and audit.** Add domain track records into the triage prompt. Add zero-yield
blocking, with all three guardrails from Part 4.1. Add a coverage check with independent query
phrasing.
*Done when:* the coverage check surfaces something the run missed, and you fix a query because of
it.

Each phase is roughly one focused sitting with Claude. Do not skip P1. Everything downstream
assumes failures are classified, and retrofitting that is much worse than building it.

### 6.4 Prompts to paste into Claude

These are written to work in a constrained environment: they state the requirement rather than
assuming a specific stack, and they ask Claude to pick the stack based on what you tell it.

**Prompt 1: the fetch layer**

```
I'm building a content-acquisition layer for a web intelligence pipeline. Write me a single
function that takes a URL and returns readable text, in <LANGUAGE>.

Requirements:
- One entry point. Nothing else in the codebase fetches content.
- Reject non-http(s) URLs and any hostname that is loopback, private (10.x, 192.168.x,
  172.16-31.x), link-local (169.254.x), or *.local before fetching. Tell me explicitly what
  this check does NOT cover.
- Explicit timeout via cancellation, default 20s, always cleared.
- Size ceiling of 20MB, checked against the declared content-length before reading the body
  AND against the actual bytes after.
- Detect PDFs by magic bytes (%PDF-), not only content-type, because CDNs serve them as
  octet-stream. Extract PDF text with <LIBRARY or "suggest one">.
- Decode HTML with the declared charset, falling back to UTF-8 when the label is missing or
  invalid (constructing a decoder with a bad label throws).
- Strip C0 control characters and unpaired surrogates from all extracted text before it can
  reach storage. Explain in a comment why (NUL bytes break database text columns).
- Treat an HTTP 200 that yields under 200 characters of text as a FAILURE, not a success. It
  is a paywall or JS stub.

Failure model, this is the important part: define an error type with two independent boolean
axes, `terminal` (retrying this exact request fails identically) and `canFallback` (a
different fetcher could plausibly succeed). Classify: 400/401/402/403/404/405/406/410/451 as
terminal; 400/404/405/410 as also no-fallback; 429/5xx/timeouts as transient; oversized and
PDF-parse-failure as terminal.

Do NOT put retry logic inside this function. It classifies and raises. The caller decides.
```

**Prompt 2: extraction quality**

```
Review this HTML-to-text function and tell me what article content it loses and what
boilerplate it keeps. Then give me a version using a real readability extractor
(<@mozilla/readability | trafilatura | your suggestion for <LANGUAGE>>) that isolates the
article body.

Constraint: <state your dependency limits, bundle size, or approved-package policy>.
If that rules out the library, tell me the highest-value 20 lines of heuristic I can add to
the regex version instead, and be specific about what I'm still losing.

[paste your current function]
```

**Prompt 3: the checkpoint schema**

```
Design the checkpoint state for a pipeline with these stages: discover URLs -> filter them ->
fetch each survivor -> model reads each -> human reviews.

My storage is <Postgres | SQLite | a Google Sheet | JSON files>.

It must satisfy these properties, and tell me how each one is enforced in MY storage:
1. Re-running a discovery unit inserts nothing new (idempotent).
2. "Did this pass the filter" and "did we manage to fetch and process it" are SEPARATE status
   fields. Explain why collapsing them makes both views lie.
3. Progress tallies are DERIVED by query, never incremented.
4. "Next batch to process" is expressed as "rows where status = pending", so writing a
   decision drains the queue and there is no cursor to store.
5. A run resumes if its status is running/failed OR any row still has work left, regardless
   of run status.
6. Two concurrent workers cannot both produce output for the same row.

If my storage cannot enforce one of these (a spreadsheet has no row locks), say so plainly
and tell me the operational rule that substitutes for it.
```

**Prompt 4: the triage pass**

```
Write the filtering stage. It takes up to 40 candidate items (url, headline, domain, date)
and returns one decision each: approved | rejected | duplicate, with a one-clause reason.

Structure the prompt in two parts and explain the split to me:
- STABLE (cacheable): the instructions, a digest of what we already track, known source
  reliability ratings. Identical for every chunk.
- PER-CHUNK: this chunk's domain track record and the numbered candidate list.

Include a materiality override: if an item reports a plausibly major development that nothing
we track covers, approve it even from a weak source, because a later stage reads the full text
and a human still gates publication. A weak source carrying a minor or already-covered story
stays rejected. Judge the story, not only the carrier.

Then write the response handling, and be paranoid: if the model returns no decision for an
index, that item defaults to REJECTED with the reason "no decision returned". Validate every
enum against an allowlist, clip every string, and explain why the chunk size must stay small
enough that the output array cannot be truncated.

My subject area is <DESCRIBE>. What counts as a high-quality source is <DESCRIBE>.
```

**Prompt 5: discovery queries**

```
Help me write search queries for a discovery pipeline covering <SUBJECT AREA>, organized into
<N> themes with 5-9 queries each.

Two rules from painful experience:
1. Queries with only a year are EVERGREEN, and evergreen queries match SEO listicles titled
   with those exact phrases instead of this week's news. Use {month} {year} tokens on any
   query meant to catch current events, and phrase those queries like news rather than like
   an article title.
2. Thematic queries only find what they literally name. Add one theme-agnostic
   "most significant developments in <SUBJECT> {month} {year}" sweep restricted to a list of
   quality outlets, as a backstop for events I did not think to name.

For each query tell me what it is meant to catch and what it will predictably miss.
```

### 6.5 What to ask IT for, and why

Ask for these specifically, with the business reason attached. Vague requests get vague refusals.

| Ask | The reason to give |
|---|---|
| Outbound HTTPS from the build/run host to public web hosts | "The tool reads public pages our analysts already read manually. Without egress it cannot do the reading, which is the entire task." |
| A model API key (or an approved enterprise endpoint) | "Batch processing needs programmatic calls. A chat window cannot process 300 items on a schedule, and pasting them by hand reintroduces the manual work we are removing." |
| A place to persist run state (a small database, or a shared drive) | "Without checkpoints, a single timeout loses the whole run and it must be redone from scratch." |
| An approved fetch/reader service, or permission to run headless Chrome | "Roughly a fifth of serious sources block plain server requests. Without a second path we silently lose them." |

If the answer to the model API key is no, build the P0 to P2 phases anyway. Structured candidate
lists with the fetching and filtering already done are useful on their own, and they make the case
for the key far better than a proposal does.

### 6.6 Failure modes we hit, so you do not have to

1. **One long agentic call.** Times out, saves nothing, tells you nothing. Decompose and
   checkpoint. This is the big one.
2. **Retrying terminal failures.** Three attempts plus backoff against a permanent 404, on every
   candidate, every run. Classify before you retry.
3. **Trusting model output.** Enums, codes, and array lengths all need validation, even behind a
   strict schema. Coerce, allowlist, clamp, clip.
4. **NUL bytes killing the database write.** The error surfaces far from the fetch that caused it
   and looks like a driver bug. Sanitize before storage.
5. **Evergreen queries.** Year-only phrasing returns SEO listicles forever. Anchor to the month
   and phrase like news.
6. **Auto-blocking a source that was working.** Duplicates are yield. Primary sources need an
   allowlist. Every automatic block needs a decay window or it is permanent.
7. **Boilerplate eating the context budget.** Regex HTML-to-text can spend a third of your
   character cap on navigation before reaching the article. Use a readability extractor.
8. **An intermediary returning 200 for an upstream failure.** Reader services wrap blocks in
   success responses. Inspect content, not only status codes.
9. **Collapsing two status axes into one column.** Fetch failures then look like filter
   rejections and both dashboards lie to you.
10. **Incremented counters.** They double-count on the first retry and you will not notice for
    weeks. Derive them.

---

## Part 7 · What a corporate deployment must add

The Atlas is a single-user tool. Its author runs it manually, reads a few hundred public news
URLs a week, and accepts the consequences personally. Inside a company, running against sources
your organization may have commercial or regulatory relationships with, the risk surface is
different and the following gaps are not acceptable.

**Verified absent from our codebase** (grep-checked across the whole repository):

- **No `robots.txt` fetching, parsing, or respect.** Zero occurrences. No `Crawl-delay` handling.
- **No per-host politeness delay and no per-host concurrency cap.** Four analysis workers run
  concurrently with nothing serializing by domain, so they can hit the same host simultaneously.
- **No global outbound rate limiter.** The only delays in the system are retry backoffs.
- **No conditional requests and no response caching.** No ETag, no `If-Modified-Since`. Every
  fetch is cold, including of pages fetched last week.
- **A User-Agent whose contact URL does not resolve.** The convention is followed; the value is a
  placeholder. A site operator who wants to reach us cannot.
- **No terms-of-service review of any target site.**
- **No DNS-level SSRF protection.** The guard is hostname string matching, and redirects are not
  re-validated per hop.

**What to add before you run this at work:**

1. **A real User-Agent.** Name the organization and link to a page that describes the crawler and
   gives a working contact address. This one line converts you from anonymous traffic into an
   identifiable party acting in good faith, which changes how a blocked request gets resolved.
2. **Honor `robots.txt`.** Fetch it, cache it per host with a TTL, check every URL before
   fetching, and honor `Crawl-delay`. Every language has a parser in its standard library or a
   one-line dependency.
3. **One request per host at a time, plus a delay.** A per-domain lock and a minimum interval
   (one to three seconds is conventional). Your worker pool then parallelizes *across* hosts
   rather than hammering one.
4. **A global outbound rate cap** so a runaway loop cannot become an incident.
5. **Conditional requests.** Store the ETag and `Last-Modified` per URL and send them. This is
   free, cuts your bandwidth and theirs, and is straightforwardly the polite thing to do.
6. **A documented review of the target list.** For each domain: are its terms compatible with
   automated retrieval, is there an official API or licensed feed, does your organization have an
   existing agreement with them. Get this in writing from whoever owns that decision at your
   company. Note that this document does not constitute that review.
7. **Prefer official APIs and licensed feeds wherever they exist.** They are more stable, more
   structured, cheaper to parse, and unambiguous about permission. Fetching HTML should be the
   fallback, not the default.
8. **Harden the SSRF guard.** Resolve the hostname and check the resulting IP against private
   ranges, and either disable redirects or re-validate every hop.
9. **Handle the content itself carefully.** Fetched text is untrusted input that you are feeding
   into a model whose output drives decisions. Know where it is stored, who can read it, how long
   it is retained, and what happens if a page contains something you did not want in your
   database.

None of this is expensive. Items 1 through 5 are perhaps a day of work, and they are the
difference between a tool that reads the public web responsibly and one that gets your egress IP
blocked, or worse, gets a conversation started that you would rather not have.

---

## Appendix · File map

For anyone with access to the reference implementation.

| Concern | File |
|---|---|
| Search calls, fetch layer, URL normalization | `lib/pipeline/web.ts` |
| Query templates, batching, domain lists, guardrails | `lib/pipeline/config.ts` |
| Discovery units | `lib/pipeline/discovery.ts` |
| Triage | `lib/pipeline/triage.ts` |
| Analysis | `lib/pipeline/analysis.ts` |
| Coverage check | `lib/pipeline/coverage.ts` |
| Shared structured-model helper | `lib/dossier.ts` (`runStructured`) |
| Cost metering | `lib/cost.ts` |
| Learning-loop queries | `lib/data.ts` (`getDomainStats`, `getZeroYieldDomains`, `isFetchHostileDomain`) |
| Server actions (the unit boundaries) | `lib/actions.ts` |
| Orchestrator UI | `components/PipelineConsole.tsx` |
| Schema | `supabase/migrations/0005`, `0007`, `0015`, `0016`, `0026` |

Key constants, gathered:

| Constant | Value | Why |
|---|---|---|
| queries per discovery call | 2 | keeps a call near 30s against a 60s cap |
| max searches per call | 2 | 3 searches measured about 46s, too close to the cap |
| triage chunk | 40 | keeps the decisions array below the output budget |
| discovery concurrency | 3 | each call holds a long request open |
| analysis concurrency | 4 | respects provider rate limits |
| model call timeout | 50s (search), 38s (analysis) | fits under the platform cap with SDK retries disabled |
| fetch timeout | 20s direct, 25s reader, 8s for the analysis-time backstop | assumes the fetch owns its own invocation |
| max download | 20 MB | larger is not an article |
| max extracted chars | 24,000 | prompt budget |
| minimum readable chars | 200 | below this it is a paywall or JS stub |
| zero-yield threshold | 4 seen, 0 approved, 0 duplicate, 90 days | with an allowlist and a decay window |
