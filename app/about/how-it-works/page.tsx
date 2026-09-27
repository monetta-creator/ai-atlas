import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'How it works · The AI Atlas',
  description: 'The rules between a model and the page, how material comes in, and how Ask finds things, in one page.',
};

// How it works (2026-09-27): the merger of the old Guardrails, Signal
// ingestion and How Ask finds things pages into one, in three groups. Each
// group carries a stable anchor id so a link into one section still works.
// Content below is lifted verbatim from those three pages except the two new
// sections named in the brand pass (about.how.sec.runs, about.how.sec.reports).

const GUARDRAILS_SECTIONS = [
  {
    id: 'test',
    heading: 'Every claim carries a test',
    body: 'A claim only counts if it says what would make it false. The schema enforces this: a claim must have a test unless it is tagged a frame. A statement with no test is not a claim. It gets stored as a frame and cannot collect supporting evidence. Without it, the Atlas would become a board where nothing can ever be wrong.',
  },
  {
    id: 'firewall',
    heading: 'The domain firewall',
    body: 'Every claim belongs to exactly one domain: capability, economics, build-out, market, or labor. A finance finding cannot quietly move a capability claim. A common move in this debate is to let a “no” in one domain imply “no” everywhere. Keeping the domains separate makes that move visible instead of silent.',
  },
  {
    id: 'bridges',
    heading: 'Bridge-claims make the leap explicit',
    body: 'Sometimes one domain really does bear on another. Those links are not banned, they are pulled out. A bridge-claim names the two domains it connects, carries its own test, and is shown on its own. So a claim like “capability gains will become enterprise revenue” has to be stated and tested in the open, instead of assumed in passing.',
  },
  {
    id: 'disconfirming',
    heading: 'Disconfirming evidence counts equally',
    body: (
      <>
        <p>
          Evidence is recorded as supporting or contradicting, and both count the same. When a claim’s
          evidence all points one way, the page flags it. The flag is a prompt to go find the other
          side, not a verdict:
        </p>
        <div
          style={{
            border: '1px solid var(--heat-4)',
            color: 'var(--heat-4)',
            borderRadius: 'var(--radius)',
            padding: '10px 14px',
            fontSize: 13,
            lineHeight: 1.5,
            marginTop: 12,
          }}
        >
          ⚠ One-sided. All evidence points the same way.
        </div>
      </>
    ),
  },
  {
    id: 'model-proposes',
    heading: 'The model proposes, the human commits',
    body: 'On the argument map the AI suggests and never commits. It never sets how far a source is trusted and never moves a confidence; the maintainer changes every number by hand with a short reason, saved together and never edited later. The model’s findings become evidence rows only when a signal is published, and unpublishing removes them; the maintainer can also attach a source to a claim by hand. The same rule runs across the desks: the discovery pipeline and the scout create drafts and queue rows, the queue agents stamp recommendations a human accepts or ignores, and the gap diagnoses argue for missing nodes without creating them. Two scheduled steps sit outside the hand gate and are stated here so they are not mistaken for it: the promotion policy publishes a high-significance pipeline draft that touches a claim after a 48-hour window in which a human can archive it (that publish writes evidence like any other), and the Tooling Monitor catalogs a product when its score clears a threshold. Where the system touches the live web (the collection engines’ feeds and search legs, Scout discovery, intel sweeps, and competitor scans, the tooling deep dives and pull enumeration, the Ask web toggle), the output is a collected item, a draft, a queue entry, or an answer with its sources shown, never a change to a confidence.',
  },
  {
    id: 'learning-loop',
    heading: 'The pipeline learns where to look, not what to believe',
    body: 'The discovery pipeline keeps a track record of its own searches. Domains that never yield a draft get blocked from future discovery, domains that block fetching get routed straight through a reader service (Jina Reader, which renders the page as text), and triage sees each domain’s history. That feedback changes where the model looks next, and nothing else. It never touches a claim, a confidence, or a piece of evidence.',
  },
  {
    id: 'citation-gate',
    heading: 'The citation gate',
    body: 'Every generated narrative is drafted over a frozen data pack computed from the database first. Before the prose ships, every link in it is checked against that pack: a citation the pack cannot vouch for is stripped and the drop recorded, never silently kept. The check runs at generation, at save, and again at render, so an edited or stale report cannot smuggle a link back in.',
  },
  {
    id: 'verification',
    heading: 'Answers are checked against the record',
    body: 'Deep-research answers get a two-layer faithfulness check before they finish: a deterministic pass (quoted spans and figures must literally appear in the gathered material) and a model pass judging each statement against the same material. Quick answers get the same check on demand. Problems are flagged to the reader, never silently corrected. Web-informed answers are the exception: their web facts sit outside the corpus, so they carry their sources instead of the Atlas check.',
  },
  {
    id: 'defaults',
    heading: 'Defaults to react against',
    body: 'When the map is seeded, every confidence starts at the midpoint, which the maintainer then has to move. The structure of the map came from an outside reviewer, but their confidence levels were thrown out on purpose. The rule is to take the structure and form independent conclusions.',
  },
  {
    id: 'blocks',
    heading: 'What this blocks',
    body: (
      <ul>
        <li><strong>The conspiracy board</strong>, where nothing can be disconfirmed. (Test required, frames kept out of evidence.)</li>
        <li><strong>Cross-domain contamination</strong>, where a finding in one domain quietly moves another. (The firewall, plus explicit bridge-claims.)</li>
        <li><strong>The auto-updating belief tracker</strong>, where numbers drift without a person and a reason. (The human gate.)</li>
        <li><strong>The confident summarizer</strong>, where generated prose drifts away from the record it claims to describe. (The citation gate, plus answer verification.)</li>
        <li><strong>The proof engine</strong>, with a score to maximize and a thesis to defend. (The map orients rather than proves, and defaults must be moved by hand.)</li>
      </ul>
    ),
  },
  {
    id: 'runs',
    heading: 'Every model run is visible',
    body: 'A button that starts a model call shows what it is doing step by step, how long that kind of run usually takes and what it usually costs (medians of past runs), any retry as it happens, and a link to the result when it finishes. The run is recorded, so it keeps going if you leave the page, the navigation shows it while it runs, and a note says when it is done. An access-key holder sees only their own runs.',
  },
];

const INGESTION_SECTIONS = [
  {
    id: 'standing-intake',
    heading: 'A standing intake of outside signal',
    body: 'Every weekday morning, before anyone opens the site, scheduled jobs sweep the outside world. Press feeds and news wires across a configurable set of topics. Targeted news search, through a model-free search API, for every tracked company and theme. Primary regulatory sources, including securities filings within a day of posting. Each item found is fetched in full text (a reader service stands in for hosts that block a direct fetch), deduplicated against everything already seen, and stored with its provenance: the source, the URL, the date, and how it was discovered. Where the fetch succeeds, the article, the filing, or the release itself is retained, not a paraphrase, with no retention limit today; an item whose host blocks fetching keeps its search summary and link.',
  },
  {
    id: 'structure',
    heading: 'Raw text becomes structured records',
    body: 'Each retained item is then read by a language model working under strict rules: write a short factual summary, tag the item against a fixed taxonomy, name the entities involved, link it to the tracked companies it concerns, score its significance, and extract the discrete facts it supports as one-sentence, dated, attributed statements. The model may only choose from controlled vocabularies. A tag, a company link, or a fact that falls outside the allow-list is dropped, not stored. What accumulates is not a pile of articles but three growing libraries: items with their full text, facts with their provenance, and the tags that make both searchable.',
  },
  {
    id: 'metrics',
    heading: 'The numbers layer',
    body: 'Alongside the text flows a metrics warehouse: roughly two million structured data points of quarterly history pulled straight from public regulatory and filing sources. The complete bank call-report field set for every tracked charter. Consolidated holding-company reports. Securities-filing financials. Consumer-complaint statistics. The history runs about a decade deep, every value keyed by company, metric, period, and source, and the recent periods refresh automatically as new data posts. No model touches this layer: the numbers are carried exactly as reported.',
  },
  {
    id: 'exports',
    heading: 'Built to travel',
    body: 'The point of collecting all of this is to move it somewhere it can be used. Everything publishes as versioned datasets with formal schemas: a column-by-column contract in JSON Schema, generated documentation that an intake system on the receiving side can read as its orientation, and stable identifiers (tickers, regulatory IDs, internal slugs) so records line up cleanly with internal and licensed datasets after import. The exports share a common row shape by design, so one importer, written once, ingests all of them.',
  },
  {
    id: 'discipline',
    heading: 'Metered, gated, auditable',
    body: 'Every model call and every search call is logged with its cost at the moment it happens, and daily budget caps sit in front of every billable step. The grunt work (summarizing, tagging, extraction, relevance scoring) runs on inexpensive open-weight models hosted on OpenRouter (Qwen, GLM, and DeepSeek flash-class models today), benchmarked against each other in live A/B splits; Claude models are reserved for the reasoning legs: dossiers, report narratives, deep dives, and the Ask answers. Nothing the models produce moves a confidence on the argument map; a confidence changes only when a human writes a reason. A signal reaches the board when a human publishes its draft, or when the promotion policy publishes a high-significance draft that touches a claim after a 48-hour window in which a human can archive it. The Daily Edition and the scheduled reports publish without a review step. And every run leaves a trail: day grids, health panels, per-run notes, so a quiet failure is a visible flag rather than a silent gap.',
  },
];

const RETRIEVAL_SECTIONS = [
  {
    id: 'plain',
    heading: 'The plain version',
    body: (
      <>
        <p>
          Ask does not answer from memory. Every question first goes looking for records the Atlas already
          holds: claims and the stances they bear on, concepts, research threads, published signals, the
          articles behind them, papers, and, for access-key holders, the company intelligence items and
          extracted facts. The model is then handed those records and told to answer only from them, citing
          each one. If the records do not cover the question, Ask says so and marks anything it adds from
          outside the records.
        </p>
        <p>
          The search happens two ways at once. The first is a word search: it looks for the words in your
          question inside the records, the way a library catalog does. It is exact and fast, and it is the
          only way to find a code like 7.2 or a company ticker. The second is a meaning search: your question
          is turned into a list of numbers that captures what it is about, every record was turned into the
          same kind of numbers ahead of time, and the records whose numbers sit closest to your question come
          back. This is what lets a question about job cuts blamed on automation find a claim written as
          headcount reductions attributed to AI, even though the two share almost no words.
        </p>
        <p>
          The two result lists are merged so that a record found by both, or found high by either, comes
          first. A budget of about eleven thousand characters decides how much record text the model actually
          sees. A separate small model reads the question and decides whether it is on the Atlas beat at all;
          combined with how strong the best matches were, that sets the lane: covered (answer from the
          records), thin or adjacent (orient from the records, then say plainly where they stop), or unrelated
          (a polite decline with no model call). After the answer is written, every citation is checked against
          the records that were actually retrieved, and a link the records cannot vouch for is removed.
        </p>
      </>
    ),
  },
  {
    id: 'what-changed',
    heading: 'What the meaning search changed',
    body: (
      <>
        <p>
          Until September 2026 Ask used the word search alone. On a set of forty test questions with known
          correct records, the word search found the right record in its first ten results 54% of the time; the
          combined search found it 86% of the time. Direct questions that reuse a record&apos;s own wording went
          from 75% to 92%. Paraphrased questions went from 67% to 83%. Questions about tracked companies, which
          the word search could not answer at all because the company items were not in its index, went from 0%
          to 67%. One kind of regression was caught in that test and fixed: a strong exact word match must never
          be pushed out of the top results by a broad question&apos;s loosely related meaning matches, so the top
          three word-search hits are always kept in the first ten.
        </p>
      </>
    ),
  },
  {
    id: 'technical',
    heading: 'The technical version',
    body: (
      <>
        <p>
          <strong>Lexical leg.</strong> Postgres full-text search. Each retrievable table carries a generated
          <code>search_tsv</code> column (a <code>tsvector</code> over its text fields, GIN indexed). The question
          becomes a <code>tsquery</code> of OR-joined terms after a vocabulary expansion step that maps street
          terms to Atlas terms (open source to open-weight, beating to parity). Ranking uses <code>ts_rank</code>,
          length-normalized on the long-document legs (signals with retained article text, papers, evidence) so
          a long article does not outrank a short claim on word count alone. Codes, slugs and tickers named in
          the question resolve to exact records before any search runs; those questions stay lexically ordered.
        </p>
        <p>
          <strong>Semantic leg.</strong> Every retrievable record is embedded with <code>text-embedding-3-small</code>
          (1,536 dimensions) through OpenRouter and stored in a pgvector table with an HNSW index (cosine
          distance). Short records embed whole, title first. Long text is split into windows of about 800 tokens
          with a 100-token overlap, at most twelve windows per record, each window prefixed with the record&apos;s
          title so a mid-article chunk still knows what it belongs to. A hash of the embedded text means
          unchanged records are never re-embedded. As of the first build: 10,922 records in 33,815 chunks, for
          about forty cents. New records are embedded as the engines write them, under a daily budget, and an
          operator check counts anything left unembedded.
        </p>
        <p>
          <strong>Fusion.</strong> The question is embedded once (one call, a fraction of a cent). The top forty
          cosine neighbours, filtered by the caller&apos;s tier (guests never see drafts or company items), are
          merged with the lexical order by reciprocal rank fusion with k = 60: each record scores the sum over
          both lists of 1 / (60 + rank). Records found by both lists rise; the top three lexical hits are
          guaranteed a place in the first ten. Anything only the semantic leg found is fetched and added after
          the lexical blocks if the character budget allows.
        </p>
        <p>
          <strong>Lanes.</strong> Two measurements come out of retrieval: the best <code>ts_rank</code> and the best
          cosine similarity. On the gold set, covered questions averaged a similarity of 0.67 with a floor of
          0.47; questions the Atlas only brushes against averaged 0.54; unrelated questions topped out at 0.37.
          The bars are therefore 0.55 (covered on similarity alone), 0.45 (covered when the classifier also puts
          the question on the Atlas beat), and 0.42 (below it, with a weak lexical rank and an off-beat
          classification, the question is declined). The lexical bars measured the same way in the previous
          week are 0.06, 0.03 and 0.02. These are provisional: forty questions, re-measured whenever the gold set
          grows.
        </p>
        <p>
          <strong>Access.</strong> The retriever runs in two modes. Portal mode, used for access-key holders, never
          selects personal-layer columns and restricts signals to published ones; it may return company
          intelligence items and facts because those ship in key-gated datasets. Guest questions never reach the
          company kinds. The admin mode adds drafts and the personal layer. Question text is sent to the embedding
          provider through OpenRouter and to the answering model; the question itself is not stored, only its
          length and the records it retrieved.
        </p>
      </>
    ),
  },
  {
    id: 'reports',
    heading: "Ask reads the Atlas's own reports",
    body: 'Ask also reads what the Atlas writes: the Daily Edition from the last ninety days, every research roundup, and every Savant issue, each cut into sections and indexed the same two ways as the records. When a report passage covers the question, Ask leans on it, since it is already argued and checked, and then cites the records the passage rests on as the receipts. Savant’s peer and market watch is read only for access-key holders. A passage shown to someone without a key has every sentence naming a tracked company removed first.',
  },
];

export default async function HowItWorksPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/how-it-works"
        label="How it works"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.how.title"
            value={txt('about.how.title', 'How it works')}
            editing={editing}
          />
        }
      />

      {/* Group headings carry a stable anchor id (the info dialog and old
          bookmarks link into these); Editable has no `id` prop, so the text
          is override-able via txt() but not click-to-edit inline. */}
      <h2 id="guardrails" className="section-label">
        {txt('about.how.group.guardrails.heading', 'The rules between a model and the page')}
      </h2>
      <Prose sections={GUARDRAILS_SECTIONS} editing={editing} keyPrefix="about.how" txt={txt} />

      <h2 id="ingestion" className="section-label">
        {txt('about.how.group.ingestion.heading', 'How material comes in')}
      </h2>
      <Prose sections={INGESTION_SECTIONS} editing={editing} keyPrefix="about.how" txt={txt} />

      <h2 id="retrieval" className="section-label">
        {txt('about.how.group.retrieval.heading', 'How Ask finds things')}
      </h2>
      <Prose sections={RETRIEVAL_SECTIONS} editing={editing} keyPrefix="about.how" txt={txt} />
    </>
  );
}
