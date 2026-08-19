# How to build a web research pipeline that actually works

### A primer for teams who need to keep something current from public web sources

**Who this is for.** You have a recurring deliverable, a deck, a briefing, a tracker, a market
scan, that has to stay current. Keeping it current means reading a lot of public web pages every
week. You have tried pointing an AI assistant at the problem and it did not work. This document
explains why, and what to build instead.

**What you do not need to know.** No specific programming language, framework, or database. The
design below has been built in TypeScript on serverless infrastructure, but the same shape works
as a Python script on a laptop, and a stripped-down version works in a spreadsheet.

**Where this comes from.** This is drawn from a production system that has been running weekly
for months: roughly 20 searches, a few hundred candidate pages, several dozen fully read and
drafted, about 15 published, per run. Every rule below exists because something broke and got
fixed. A companion document holds the full technical spec with working code for whoever ends up
building it.

---

## Contents

1. [What a run actually looks like](#1-what-a-run-actually-looks-like)
2. [Why your first attempt failed](#2-why-your-first-attempt-failed)
3. [The shape that works](#3-the-shape-that-works)
4. [The four stages, in plain terms](#4-the-four-stages-in-plain-terms)
5. [The eight things that will break](#5-the-eight-things-that-will-break)
6. [What to build, in order](#6-what-to-build-in-order)
7. [If your tools are locked down](#7-if-your-tools-are-locked-down)
8. [Prompts to paste into Claude](#8-prompts-to-paste-into-claude)
9. [Before you run this at work](#9-before-you-run-this-at-work)
10. [Glossary](#10-glossary)

---

## 1. What a run actually looks like

Monday morning. Someone opens an internal page and clicks a button labelled **Discover**. For the
next four minutes a log scrolls: twenty small searches go out, each covering one theme, and
candidate links accumulate. About 300 arrive.

They click **Filter**. Roughly a third are thrown out instantly by simple rules, no AI involved:
known junk domains, and links already in the system from previous weeks. The remainder go to a
model in batches of 40, which marks each one keep, reject, or duplicate, with a one-line reason
for every decision. About 40 survive.

They click **Read**. For each survivor the system fetches the page, pulls out the article text,
and asks a model to produce a structured entry: a factual headline, a three-sentence summary, a
significance rating with a reason, and which of the things being tracked this development bears
on. Each result is saved as a **draft**.

Then a person reads the drafts. Some are wrong. Some are duplicates the filter missed. Some are
excellent. They publish the good ones. Publishing is what makes something count.

Total: about twelve minutes of machine time, about thirty minutes of human review, once a week.

**Notice what the human is doing.** They are not hunting for links, opening tabs, or skimming
articles to decide what matters. They are reviewing finished proposals and exercising judgment.
That is the whole point. The machine does the reading; the person does the deciding.

---

## 2. Why your first attempt failed

Almost every team starts the same way: describe the goal to an AI assistant and let it work.
"Search the web for developments in our market, read what you find, and give me a summary."

It fails, and it fails for structural reasons rather than because you picked the wrong model.
Swapping Gemini for Claude, or Claude for anything else, will not fix any of the following.

**It takes too long and then it dies.** Web searching is slow. In our measurements, three
searches inside a single request took about 46 seconds. Add fetching a dozen pages and reading
them, and you are minutes into one continuous operation. Nearly every environment that runs code
has a time limit (ours is 60 seconds). You get a timeout, and everything the assistant learned in
those minutes is gone.

**Nothing is saved along the way.** When the long operation dies at minute seven, it dies whole.
Run it again and it repeats all the work, including the parts that already succeeded. There is no
notion of "we already handled these 30 links."

**It cannot filter cheaply.** A good pipeline throws away most of what it finds using rules that
cost nothing, and only spends real money on the survivors. One long AI operation cannot do that,
because every step of it is the expensive step.

**You cannot see anything.** Which search found which link? Why was that article skipped? Did
that page fail to load, or did it load and get judged irrelevant? In a single opaque operation
there is no answer to any of those, so you cannot improve it. You can only re-prompt and hope.

**And the deep one: it is not scraping.** If your mental model is "point a tool at a list of
websites and extract the contents," you will build something that breaks every time a site
redesigns, that annoys the sites you depend on, and that only ever finds what you already knew to
look for. The working design barely resembles that.

---

## 3. The shape that works

Four stages, in order, each one narrowing the funnel:

```
   RETRIEVE            FILTER               INTERPRET             COMMIT
   Search broadly.     Cheap rules first,   A model reads the     A person reviews
   Keep everything.    then one AI pass.    full text of each     the drafts and
   Judge nothing.      Cut hard.            survivor.             publishes.

   ~300 links     ->   ~40 survive     ->   ~40 drafts       ->   ~15 published
```

Five principles hold the whole thing up. If you remember nothing else, remember these.

**1. Break the work into small pieces and save after every piece.**
This is the single most important idea in this document. One piece is "run two searches for one
theme," or "decide on these 40 links," or "fetch this one page." Each finishes in well under a
minute and writes its result somewhere permanent before it ends. Something drives them in
sequence, which can be a web page, a shell script, or a person clicking a button.

The payoff is enormous. A failure anywhere loses one small piece, not the run. Retries are safe.
You can close your laptop mid-run and pick up tomorrow. You can watch it work.

**2. Search, do not crawl.**
You do not maintain a list of sites and extractors for each one. You ask a search tool questions
and it returns links. When a publisher redesigns their site, nothing on your side breaks. You
also find things you did not know existed, which is the actual reason you are building this.

**3. Spend cheap before you spend expensive.**
Rules that cost nothing (a list of junk domains, a check against links you have already seen) run
first and remove a large share. Only the survivors reach an AI. Only the ones the AI approves get
fetched and read in full. Getting this order wrong makes the system cost roughly ten times more
for the same output.

**4. Separate finding from judging.**
The search stage is explicitly told: do not evaluate, do not summarize, do not filter, when in
doubt include it. Judgment happens in the next stage. If you ask one step to both find and judge,
it will quietly drop things and you will never learn what you did not see. Separating them also
lets you tune recall and precision independently.

**5. A person commits.**
The system only ever produces drafts. Nothing enters the permanent record without someone
approving it. This is not ceremony. It is the reason the output can go in front of someone
senior. It also means an occasional bad model judgment costs you thirty seconds of review rather
than your credibility.

### A fair question: do you even need all four stages?

If your sources are genuinely twenty known sites, you may not need the discovery stage at all.
Most serious publishers still publish **RSS feeds**: free, structured, no search tool, no API
key, and far more polite to the source. A feed reader plus stages 2 through 4 is a complete and
useful system.

Add discovery when your real problem is "I do not know where the important thing will appear,"
which is usually true and is usually why the manual version is painful.

---

## 4. The four stages, in plain terms

### Stage 1 · Retrieve

**One unit of work:** one theme, two search queries, one call, about 30 seconds. A weekly run has
roughly 20 of these. A few run at the same time.

Group your subject into 5 or 6 **themes**. For each, write 5 to 9 search queries. Run them two at
a time so no single call runs long.

Two things about the queries themselves, both learned painfully:

**Date-stamp them, and phrase them like news.** A query containing only a year is *evergreen*,
and evergreen queries match evergreen content: the "Top 10 Trends of 2026" listicles that are
written to rank for exactly those words. Our system missed a major, widely-covered event for
three days because every query was phrased like an article title instead of like a news event.
Put the current month and year into the query and phrase it the way a headline would read. Fill
those in automatically, because a hardcoded year goes stale every January and nobody notices.

**Add one theme-blind sweep.** Thematic queries find what they literally name. They cannot find
the thing you did not think to name. So every run also asks, in effect, "what did the serious
press report this month," restricted to a short list of quality outlets, with no theme attached.
That sweep exists specifically because the themed queries missed something big, and it catches
the category of thing you cannot anticipate.

If you use a domain allowlist for that sweep, **test it before relying on it**. Many major
publishers block automated agents, and depending on your search tool an unreachable domain in the
list can cause the entire call to be rejected.

### Stage 2 · Filter

**One unit of work:** up to 40 links, one AI call, well under a minute. Repeat until done.

**First pass, no AI.** Reject anything from your junk-domain list (press-release wires, SEO
content farms, stock-tip aggregators). Then mark as duplicate anything whose link you already
have. This costs nothing and removes a lot.

That second check only works if you **normalize links before comparing**: strip `www.`, drop the
`https://`, remove trailing slashes, throw away tracking parameters (`utm_source` and friends),
and sort what remains. Otherwise the same article arrives four times wearing different clothes.

**Second pass, one AI call per batch of 40.** Show the model the surviving links and ask for one
decision each: keep, reject, or duplicate, plus a one-line reason. Give it context: what you
already track (so it can spot duplicate *stories*, not just duplicate links) and which outlets
you rate highly.

Two rules matter more than the rest of the prompt:

**Include a materiality override.** Source-quality heuristics will confidently reject the
low-grade aggregator that happens to be the only outlet carrying a genuinely major event. So tell
the model explicitly: if something reports a plausibly major development that nothing you track
covers, keep it even from a weak source, because a later stage reads the full text and a person
still decides. A weak source carrying a minor or already-covered story stays rejected. **Judge the
story, not only the carrier.**

**Fail closed.** If the model returns no decision for an item, that item is *rejected*, not
silently kept. And keep the batch small (40, not 200) so the model's answer cannot get cut off
mid-list. A truncated answer with a fail-open default silently loses real items and looks like
nothing happened.

### Stage 3 · Interpret

**Two units of work per item**, and splitting them is the point.

**Unit A, fetch.** Get the page, extract the readable text, save it. Nothing else. This gets a
full time budget to itself, which is what makes slow sites and large PDFs survivable. If the text
is already saved, it returns immediately.

**Unit B, read.** Take the saved text and make one AI call that returns a structured entry:
headline, summary, significance with a reason, and which tracked items it bears on.

They are split because fetching can take 20 seconds and reading can take 40, and together they do
not reliably fit inside one time budget. Separately, they always do.

Two habits worth building in from the start:

**Constrain the model's vocabulary.** If the model has to pick from a list of things you track,
put that list into the response format as a fixed set of allowed values so it cannot invent an
entry that does not exist.

**Then validate everything anyway.** Check every value against a list of allowed values, clamp
every number to its range, trim every string, drop duplicates. Assume the model will occasionally
return something structurally perfect and factually impossible, and write code that shrugs.

**One boundary to hold.** In our system the model suggests a reliability score for each source.
That suggestion is shown to the operator and is *never* written into the stored rating. The model
recommends; it does not get to change the inputs to future judgments. Pick your version of this
line early and do not let it erode.

### Stage 4 · Commit, and check yourself

Everything the model produced is a **draft**. A person reviews and publishes.

Add one more thing: an **automatic self-check** after each run. Ask, independently and with
different wording, "what were the biggest developments this period," and compare the answer
against what the run actually found. Mark each one covered or missed.

The different wording is essential. If the check reuses the same queries as the search stage, it
will mostly re-find what the run just found and give you a clean bill of health that means
nothing.

The check does not block anything and never fails a run. Its entire value is that a silent miss
becomes a visible one. Ours exists because a major event sat in three major outlets for three
days, the run surfaced none of them, and nothing anywhere indicated a problem. That is the
failure mode you should fear most: not a system that breaks, but one that quietly stops working
while still producing output.

---

## 5. The eight things that will break

Every one of these cost real time. They are ordered roughly by how much.

**1. Trying to do it in one long AI operation.**
Covered above. It times out, saves nothing, and tells you nothing. Small pieces, saved after each
one. If you take one thing from this document, take this.

**2. Retrying things that can never succeed.**
This is the highest-value small idea here. When a fetch fails, classify the failure along two
independent lines:

- **Is it permanent?** A page that returns "not found" will return "not found" forever. Retrying
  it three times with backoff, on every item, on every run, is pure waste. A timeout or a
  "too many requests" response, on the other hand, is exactly the thing retries are for.
- **Would a different method work?** A page that blocks automated requests is permanent for
  *that* method but might load fine through a different one. A dead link is hopeless either way.

Two booleans. They answer two different questions, and they save an enormous amount of wasted
time and money.

A related trap: put the retry logic in the **caller**, not the fetching function. Each retry
should be a fresh attempt with a fresh time budget. A retry inside the function eats the very
budget the retry needs.

**3. Treating "the page loaded" as "we got the article."**
A page can return a perfectly successful response containing a cookie banner, a paywall notice,
or an empty shell that would have loaded the article via JavaScript. Set a minimum: if you got
fewer than about 200 characters of text, that is a **failure**, not a success. Otherwise the
model dutifully summarizes a cookie consent dialog and you get a confident, complete, worthless
entry.

The same trap applies one level up. If you use any intermediate service to fetch pages, it may
return "success" wrapping an upstream failure. We hit exactly this: a reader service returned a
normal successful response whose contents were `Just a moment... Warning: Target URL returned
error 403`. Inspect what came back, not only whether the request succeeded.

**4. Invisible characters destroying your database write.**
Web content contains control characters, and binary content misread as text is full of them.
Most databases cannot store a null byte in a text field. The error you get points at the database
insert and looks completely unrelated to the page fetch that caused it, three stages earlier.

Strip control characters and broken character fragments from all extracted text before it goes
anywhere near storage. Roughly two lines of code. Do it at the fetch *and* at the storage
boundary so a second code path cannot reintroduce it. Every language has this problem; only the
error message differs.

**5. PDFs that do not admit to being PDFs.**
Content delivery networks routinely serve PDFs labelled as generic binary data. If you decide
based on the label, you will feed raw PDF bytes into a text parser and get garbage. Check the
first five bytes of the file instead, which for a PDF always spell `%PDF-`.

**6. Navigation and footers eating your budget.**
You can only send so much text to a model. If your text extraction is naive, a chrome-heavy site
can spend a third of that budget on menus, cookie notices, and footer links before reaching the
first sentence of the article. Use a proper article-extraction library (**trafilatura** for
Python, **@mozilla/readability** for JavaScript) rather than stripping HTML tags with a regular
expression. This is a straight improvement in both quality and cost.

**7. Automatic blocklists that quietly strangle good sources.**
Blocking domains that never produce anything useful is a genuinely good idea. Ours went wrong
twice before it went right:

- It nearly blocked a **federal regulator's own website**, because five of its six articles were
  marked "duplicate" (we already had that story from elsewhere). But a duplicate means the domain
  carried a *real* story. That is a hit, not junk. Count duplicates as success.
- It qualified a **major model-hosting platform** for blocking based on five rejected community
  blog posts, which would have hidden the single site where the most important announcements in
  our field actually appear. Behavioural metrics do not know what a source *is*. Keep a
  protected list of primary sources and major outlets that can never be auto-blocked.

And the general rule underneath both: **a blocked source never gets another chance to prove
itself, so without an expiry the block is permanent on the strength of one bad month.** Only count
the last 90 days. Check every automatic exclusion you build for this. Any filter without a path
back is a one-way ratchet.

**8. Counters that count wrong.**
If you track progress by incrementing a number ("candidates found: 47"), the first retry
double-counts and you will not notice for weeks. Derive the number by counting the actual rows
instead. It cannot be wrong.

Related: keep "did this pass the filter" and "did we manage to read it" as **two separate fields**.
Merge them and a fetch failure looks like an editorial rejection, your funnel statistics quietly
absorb your infrastructure problems, and you cannot tell whether your filter got stricter or the
web got harder to read.

---

## 6. What to build, in order

Do not build stage two of a four-stage system. Build a thin version of the whole thing and
thicken it. Each phase below produces something that works end to end, and each is roughly one
focused session.

**Phase 0 · The spine.**
A fixed list of 10 links. Fetch each, pull out the text, one AI call per page returning a fixed
set of fields, append the results to a file. No search, no filtering, no database.
*Done when:* one command gives you 10 structured records. Expect about 3 of the 10 to fail. That
is not a setback, it is the entire subject of Phase 1.

**Phase 1 · Failures and saved progress.**
Classify every failure as permanent or temporary, and as "try a different method" or not. Add the
minimum-text check. Add the control-character stripping. Write each link's status to a file so a
rerun skips what already worked and retries only what is temporarily broken.
*Done when:* you can kill it mid-run, restart, and it picks up correctly.

**Phase 2 · Finding things, and cheap filtering.**
Replace the fixed list with search, or with RSS feeds. Add the no-AI filter pass: junk domains,
link normalization, and duplicate detection against everything seen before.
*Done when:* a run finds something you did not know about, and running it twice produces zero new
work the second time.

**Phase 3 · AI filtering.**
Add the batched model filter over survivors. Add the materiality override. Add fail-closed
handling and validation of everything the model returns.
*Done when:* your keep rate lands somewhere around 10 to 30 percent, and when you spot-check the
rejection reasons you agree with most of them.

**Phase 4 · Learning and self-checking.**
Feed each domain's track record into the filter prompt. Add automatic blocking of never-useful
domains, with all three guardrails from item 7 above. Add the self-check with independent
wording.
*Done when:* the self-check catches something the run missed, and you change a query because of
it.

**Do not skip Phase 1.** Everything after it assumes failures are classified, and adding that
later is far more painful than building it in.

---

## 7. If your tools are locked down

You may not get everything. Almost every part of this degrades gracefully. **The funnel shape and
the save-after-every-piece discipline survive at every level.** Only the machinery changes.

| What you need | Ideal | Workable | Bare minimum |
|---|---|---|---|
| **Finding links** | a search tool built into the AI service | a separate search API feeding the same list of candidates | a hand-kept list of sites plus their RSS feeds |
| **Fetching pages** | your own code fetching directly, with a backup method | one approved fetching service, or a browser tool you run | a person pastes page text into a file |
| **Reading text** | article-extraction library plus PDF support | strip HTML tags with a regular expression | paste as text, no PDFs |
| **AI calls** | an API key, structured responses | chat Claude with a strict "reply with only this JSON" instruction, in batches | Claude as reviewer, you assemble the material and it judges |
| **Saving state** | a database | a spreadsheet, one row per link | one text file per run |
| **Running it** | automated, several at a time | a script you run, one at a time | run each stage by hand |

Three notes:

- **A spreadsheet is a legitimate place to keep state.** One row per link, columns for the
  statuses. You lose the ability to run several workers safely, so run one at a time. Everything
  else still applies.
- **Chat-only Claude still supports the whole design.** Paste 40 headlines, ask for a JSON list
  of decisions, paste the result back into the sheet. It is slower and it is completely real. The
  materiality override and the fail-closed rule matter *more* here, not less.
- **RSS is underrated.** No API key, no search tool, free, structured, and considerably more
  respectful of the sites you depend on.

### Asking IT for what you need

Ask specifically, with the business reason attached. Vague requests get vague refusals.

| The ask | The reason to give |
|---|---|
| Outbound web access from whatever machine runs this | "The tool reads public pages our team already reads by hand. Without access it cannot do the reading, which is the whole task." |
| An AI API key, or an approved enterprise endpoint | "Processing 300 items on a schedule needs programmatic calls. A chat window cannot, and pasting by hand reintroduces exactly the manual work we are removing." |
| Somewhere to save progress | "Without saved progress, one timeout loses the entire run and it must be redone from scratch." |
| An approved page-fetching service, or permission to run a browser tool | "Roughly a fifth of serious sources block plain automated requests. Without a second method we silently lose them." |

If the AI key is refused, build phases 0 through 2 anyway. A clean, deduplicated, filtered list of
links with the fetching already solved is useful on its own, and it makes the case for the key far
better than a proposal does.

---

## 8. Prompts to paste into Claude

These state requirements rather than assuming a stack, so they work whatever you are building in.
Fill in the bracketed parts.

**Prompt 1: the fetching layer**

```
I'm building the page-fetching layer for a web research pipeline, in <LANGUAGE>.
Write one function that takes a link and returns readable text.

Requirements:
- One entry point. Nothing else in the project fetches pages.
- Refuse anything that isn't http/https, and any address that is local, private, or
  link-local, before fetching. Tell me what this check does NOT protect against.
- An explicit timeout, default 20 seconds, always cleaned up.
- A size limit of 20MB, checked against the declared size BEFORE downloading and against
  the actual size after.
- Detect PDFs by their first bytes (%PDF-), not by the content-type header, because
  servers routinely mislabel them. Suggest a PDF text library for <LANGUAGE>.
- Decode text using the declared character set, falling back to UTF-8 when it's missing
  or invalid.
- Strip control characters and broken character fragments before the text can reach
  storage. Explain why in a comment.
- Treat a successful response with under 200 characters of text as a FAILURE. It's a
  paywall or an empty shell page.

The important part, the failure model: define an error type with two independent flags,
"permanent" (retrying this exact request fails identically) and "try-another-method"
(a different fetcher could plausibly succeed). Classify the common HTTP statuses on both
axes and explain your reasoning for each.

Do NOT put retry logic inside this function. It classifies and raises. The caller decides.
```

**Prompt 2: how to save progress**

```
Design the saved state for a pipeline with these stages: find links -> filter them ->
fetch each survivor -> AI reads each -> a person reviews.

I'm storing state in <a database | SQLite | a Google Sheet | plain files>.

It must have these properties. For each one, tell me how it's enforced in MY storage:
1. Re-running the "find links" step adds nothing new. It's safe to retry blindly.
2. "Did this pass the filter" and "did we manage to fetch and read it" are SEPARATE
   fields. Explain why merging them makes both views misleading.
3. Progress counts are derived by counting rows, never incremented.
4. "What's next to process" is expressed as "rows still marked pending", so recording a
   decision drains the queue and there's no position to track.
5. A run resumes if it's marked in-progress or failed, OR if any row still has work
   left, regardless of what the run's own status says.
6. Two workers can't both produce output for the same row.

If my storage can't enforce one of these (a spreadsheet has no row locking), say so
plainly and give me the operating rule that substitutes for it.
```

**Prompt 3: the filtering step**

```
Write the filtering stage. It takes up to 40 candidates (link, headline, site, date) and
returns one decision each: keep | reject | duplicate, with a one-clause reason.

Split the prompt in two and explain the split:
- STABLE (identical every batch, so it can be cached): the instructions, a digest of what
  we already track, and our ratings of known sources.
- PER-BATCH: this batch's numbered candidate list.

Include a materiality override: if an item reports a plausibly major development that
nothing we track covers, keep it even from a weak source, because a later stage reads the
full text and a person still decides. A weak source carrying a minor or already-covered
story stays rejected. Judge the story, not only the carrier.

Then write the response handling, and be paranoid. If the model returns no decision for an
item, that item defaults to REJECTED with the reason "no decision returned". Validate every
value against an allowed list, trim every string, and explain why the batch has to stay
small enough that the response can't be cut off mid-list.

My subject is <DESCRIBE>. A high-quality source for us means <DESCRIBE>.
```

**Prompt 4: the search queries**

```
Help me write search queries for a research pipeline covering <SUBJECT>, organised into
<N> themes of 5-9 queries each.

Two rules from experience:
1. Queries containing only a year are evergreen, and evergreen queries match "Top 10
   Trends" listicles instead of this week's news. Put the current month and year into any
   query meant to catch current events, and phrase those like a news headline rather than
   like an article title.
2. Themed queries only find what they literally name. Add one theme-blind sweep,
   "most significant developments in <SUBJECT> this month", restricted to a short list of
   quality outlets, as a backstop for events I didn't think to name.

For each query, tell me what it's designed to catch and what it will predictably miss.
```

**Prompt 5: a sanity check on scope**

```
Here's what I'm trying to keep current: <DESCRIBE THE DELIVERABLE AND HOW OFTEN IT
UPDATES>. Here's where the information comes from today: <DESCRIBE THE MANUAL PROCESS>.

Before I build anything: do I actually need web search, or would RSS feeds from a known
list of sources cover most of it? What fraction of what I need is likely to come from
sources I already know about versus sources I'd have to discover?

Be honest if the simpler version is enough. Then tell me the smallest thing I could build
this week that would be genuinely useful, even if it's much less than the full design.
```

---

## 9. Before you run this at work

The system described here was built by one person, for their own use, reading a few hundred
public news pages a week, accepting the consequences personally. Inside a company, potentially
against sources your organisation has commercial or regulatory relationships with, the risk
profile is different.

**Everything below is missing from the original system.** That is a deliberate, honest disclosure
rather than a recommendation. Do not copy the omissions.

**1. Identify yourself properly.** Every request your tool makes should say who it is, naming
your organisation and linking to a page a site operator can actually read. The original names a
placeholder that does not resolve, which is a real defect. This one line turns anonymous traffic
into an identifiable party acting in good faith, and it changes how a blocked request gets
resolved: an email rather than a silent ban.

**2. Respect `robots.txt`.** This is the file where a website states what automated access it
permits. Fetch it, remember it per site, check before every request, and honour any requested
delay. Every language has a parser for it built in or one dependency away. The original system
does not do this at all.

**3. One request at a time per site, with a pause between.** A second or two is conventional.
Your parallelism should be *across* different sites, never several at once against the same one.
The original runs four workers with nothing preventing them from hitting one site simultaneously.

**4. A global limit on outbound requests**, so a bug in a loop cannot become an incident.

**5. Do not re-download what has not changed.** Remember when you last fetched each page and ask
the server whether it has changed since. This is free, saves bandwidth on both sides, and is
straightforwardly the polite thing to do.

**6. Get the source list reviewed.** For each site: are its terms compatible with automated
access, is there an official API or a licensed feed, does your organisation already have an
agreement with them. Get this in writing from whoever owns that decision. **This document is not
that review and does not substitute for it.**

**7. Prefer official APIs and licensed feeds wherever they exist.** More stable, better
structured, cheaper to process, and unambiguous about permission. Fetching web pages should be
the fallback, not the default.

**8. Treat fetched content as untrusted input.** You are feeding text from the open web into a
model whose output informs decisions. Know where that text is stored, who can read it, how long
it is kept, and what happens if a page contains something you did not want in your systems.

Items 1 through 5 are perhaps a day of work between them. They are the difference between a tool
that reads the public web responsibly and one that gets your office IP address blocked, or starts
a conversation with legal that you would rather not have.

---

## 10. Glossary

Terms used above, in case they are unfamiliar.

| Term | What it means here |
|---|---|
| **Candidate** | A link the system found but has not yet judged or read. |
| **Draft** | A finished proposal awaiting human review. Nothing counts until published. |
| **Theme** | One subject area with its own set of search queries. Also called a lens. |
| **Unit of work** | The smallest piece the system does and saves: one search batch, one batch of decisions, one page fetch. |
| **Funnel** | The narrowing from many links to few published entries. |
| **Fail closed** | When something goes wrong, default to the safe outcome (reject) rather than the permissive one (keep). |
| **Materiality override** | The rule that a major, uncovered story is kept even from a poor source. |
| **Permanent vs temporary failure** | Whether retrying the identical request could ever succeed. Drives whether to retry. |
| **Normalize (a link)** | Reduce it to a canonical form so the same page in different clothing is recognised as the same page. |
| **RSS feed** | A structured, machine-readable list of a site's recent articles, published by the site itself. Free and permitted by definition. |
| **`robots.txt`** | A file at the root of a website stating what automated access it permits. |
| **Rate limiting** | Deliberately slowing your own requests so you do not overwhelm a site. |
| **Prompt caching** | Reusing the unchanging part of a prompt across many calls so you are not billed for it repeatedly. |
| **Structured response** | Requiring the model to answer in a fixed shape (specific fields, specific allowed values) rather than in prose. |

---

## In one paragraph

Break the work into small pieces and save after each one. Search rather than crawl. Filter with
free rules before you filter with AI, and filter with AI before you read anything in full.
Classify every failure as permanent or temporary before you retry it. Never trust that a
successful response contains what you asked for, whether it comes from a website or a model. Give
every automatic exclusion a way to expire. And keep a person between the machine's output and
anything anyone else sees. The rest is detail.
