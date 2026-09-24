import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'How Ask finds things · The AI Atlas' };

// The retrieval explainer: what happens between a question typed into Ask and
// the answer, in two registers. The plain version first, the technical version
// underneath. Numbers here are the ones measured on 2026-09-24 against the
// 40-question gold set (private/ask-gold); when the measurement is redone,
// update them here in the same commit (the truth-pass rule for About).

const SECTIONS = [
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
];

export default async function RetrievalPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/retrieval"
        label="How Ask finds things"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.retrieval.title"
            value={txt('about.retrieval.title', 'How Ask finds things')}
            editing={editing}
          />
        }
      />
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.retrieval" txt={txt} />
    </>
  );
}
