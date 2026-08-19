import Image from 'next/image';
import { getLobbyStats, getTextCoverage, listGeneratedReports } from '@/lib/data';
import Showcase, { type ShowSlide } from '@/components/showcase/Showcase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Showcase · The AI Atlas', robots: { index: false, follow: false } };

// The Showcase: an unlisted, in-app slide deck for demoing the Atlas live.
// Public route (proxy allow-list) but linked from nowhere; the stats are live
// database reads, so the deck is rendered by the tool it describes. v2 is
// visual: bullets only, real screen grabs (public/showcase/*.png, recaptured
// with scripts/capture-showcase.mjs), pipeline flow diagrams, and the
// search-vs-chatbots comparison. Slide content lives here, server-side; the
// client controller only paginates.

function datelineET(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/New_York',
  });
}

function Stat({ n, l }: { n: string | number; l: string }) {
  return (
    <div className="show-stat">
      <span className="show-stat-n">{n}</span>
      <span className="show-stat-l">{l}</span>
    </div>
  );
}

// A screen grab in a browser frame. Dimensions are the capture contract
// (1440x900 at 2x); the CSS caps display height on squat windows.
function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="show-shot">
      <div className="show-shot-bar" aria-hidden="true"><i /><i /><i /></div>
      {/* unoptimized: the grabs are already 2x PNGs sized for the slide;
          resampling would soften the UI text they exist to show */}
      <Image src={`/showcase/${src}`} alt={alt} width={1440} height={900} unoptimized />
    </div>
  );
}

function FlowNode({ k, t, gate }: { k: string; t: string; gate?: boolean }) {
  return (
    <div className="show-flow-node" data-gate={gate ? '' : undefined}>
      <span className="show-flow-k">{k}</span>
      <span className="show-flow-t">{t}</span>
    </div>
  );
}
const Arrow = () => <span className="show-flow-arrow" aria-hidden="true">→</span>;

function CompareCol({
  title, hero, rows,
}: { title: string; hero?: boolean; rows: [string, string][] }) {
  return (
    <div className="show-compare-col" data-hero={hero ? '' : undefined}>
      <div className="show-compare-h">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="show-compare-row">
          <span className="show-compare-k">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default async function ShowcasePage() {
  const [stats, coverage, sheets] = await Promise.all([
    getLobbyStats(),
    getTextCoverage(),
    listGeneratedReports(true),
  ]);
  const briefing = sheets.find((s) => s.kind === 'atlas') ?? sheets[0] ?? null;

  const slides: ShowSlide[] = [
    {
      id: 'cover',
      title: 'Cover',
      node: (
        <>
          <div className="show-kicker">The AI Atlas · {datelineET()}</div>
          <div className="show-rule" />
          <h2>A map of the AI-economy debate.</h2>
          <p className="show-lede">
            One analyst&rsquo;s orientation tool: the open questions, the claims they turn on, and the
            evidence as it lands. Every number in this deck is a live read from the tool itself.
          </p>
          <div className="show-stats">
            <Stat n={stats.claims} l="falsifiable claims" />
            <Stat n={stats.signalsPublished} l="published signals" />
            <Stat n={stats.theses} l="standing theses" />
            <Stat n={`${coverage.with_text}/${coverage.total}`} l="retain source text" />
          </div>
          <span className="show-hint">→ to advance · Esc for the map of slides</span>
        </>
      ),
    },
    {
      id: 'problem',
      title: 'The problem',
      node: (
        <>
          <div className="show-kicker">The problem</div>
          <h2>Everyone is drowning in AI takes.</h2>
          <ul className="show-list">
            <li>Confident, contradictory claims, daily</li>
            <li>Every source is selling something: capital, a book, a story</li>
            <li>Search retrieves documents, not positions</li>
            <li>Nobody tracks what would actually settle the argument</li>
          </ul>
        </>
      ),
    },
    {
      id: 'compare',
      title: 'Search vs. chatbots vs. this',
      node: (
        <>
          <div className="show-kicker">Why not just search? Why not just ChatGPT?</div>
          <h2 className="show-h2--sm">Three different machines.</h2>
          <div className="show-compare">
            <CompareCol
              title="Search"
              rows={[
                ['Returns', 'a list of documents'],
                ['Grounded in', 'keywords'],
                ['Remembers', 'nothing'],
                ['Disagreement', 'buried in the results'],
                ['When it is wrong', 'you never find out'],
              ]}
            />
            <CompareCol
              title="Chatbots"
              rows={[
                ['Returns', 'an answer'],
                ['Grounded in', 'training data'],
                ['Remembers', 'nothing'],
                ['Disagreement', 'averaged away'],
                ['When it is wrong', 'it apologizes'],
              ]}
            />
            <CompareCol
              title="The Atlas"
              hero
              rows={[
                ['Returns', 'a position on a map'],
                ['Grounded in', 'tracked evidence, cited'],
                ['Remembers', 'every move, with its written reason'],
                ['Disagreement', 'mapped, with tests that would settle it'],
                ['When it is wrong', 'verification flags it to the reader'],
              ]}
            />
          </div>
        </>
      ),
    },
    {
      id: 'spine',
      title: 'The spine',
      node: (
        <>
          <div className="show-kicker">The structure everything hangs on</div>
          <h2 className="show-h2--sm">Questions, stances, claims, evidence.</h2>
          <div className="show-flow">
            <FlowNode k="Open" t="Question" />
            <Arrow />
            <FlowNode k="Held by real people" t="Stances" />
            <Arrow />
            <FlowNode k="Each with a test" t="Claims" />
            <Arrow />
            <FlowNode k="With direction" t="Evidence" />
            <Arrow />
            <FlowNode k="From the news" t="Signals" />
          </div>
          <ul className="show-list">
            <li>Every claim carries a test: what would change the author&rsquo;s mind</li>
            <li>Evidence lands for or against, and both count the same</li>
            <li>News wires back to the exact claims it touches</li>
          </ul>
        </>
      ),
    },
    {
      id: 'gates',
      title: 'The three gates',
      node: (
        <>
          <div className="show-kicker">What it is not: fancy search, or a chatbot wrapper</div>
          <h2 className="show-h2--sm">Three gates, in schema and code.</h2>
          <ul className="show-list">
            <li><strong>The human gate.</strong> No confidence moves without a hand and a written rationale, saved atomically</li>
            <li><strong>The citation gate.</strong> Generated prose only links what its frozen evidence pack vouches for; strips are logged</li>
            <li><strong>Verification.</strong> Quotes and figures checked against the record; problems flagged, never silently fixed</li>
          </ul>
        </>
      ),
    },
    {
      id: 'signals',
      title: 'Signal Board',
      node: (
        <>
          <div className="show-kicker">Portal 1 of 6</div>
          <h2 className="show-h2--sm">Signal Board</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Tracked developments, six audience lenses</li>
              <li>Each signal wired to the claims it touches</li>
              <li>Publishing materializes evidence onto the map</li>
              <li>Drafts stay private until a human ships them</li>
            </ul>
            <Shot src="signals.png" alt="The Signal Board feed" />
          </div>
        </>
      ),
    },
    {
      id: 'discovery',
      title: 'The discovery pipeline',
      node: (
        <>
          <div className="show-kicker">How signals arrive · automated path</div>
          <h2 className="show-h2--sm">The discovery pipeline.</h2>
          <div className="show-flow">
            <FlowNode k="Lens queries + breaking sweep" t="Web search" />
            <Arrow />
            <FlowNode k="Dedupe + source track record" t="Triage" />
            <Arrow />
            <FlowNode k="Fetch text + propose" t="Analyze" />
            <Arrow />
            <FlowNode k="Never public" t="Draft signal" />
            <Arrow />
            <FlowNode k="Human" t="Publish" gate />
            <Arrow />
            <FlowNode k="On the map" t="Evidence" />
          </div>
          <p className="show-flow-note">
            the learning loop: zero-yield domains get blocked · fetch-hostile domains route through a reader
            · a post-run coverage check audits what was missed
          </p>
          <ul className="show-list">
            <li>Runs on demand, resumable, checkpointed in the database</li>
            <li>The model proposes; only the human publish creates evidence</li>
          </ul>
        </>
      ),
    },
    {
      id: 'ingest',
      title: 'Manual ingest',
      node: (
        <>
          <div className="show-kicker">How signals arrive · manual path</div>
          <h2 className="show-h2--sm">Drop a document in.</h2>
          <div className="show-flow">
            <FlowNode k="PDF or URL" t="Upload" />
            <Arrow />
            <FlowNode k="AI profile + metadata" t="Source + dossier" />
            <Arrow />
            <FlowNode k="Same funnel as discovery" t="Triage" />
            <Arrow />
            <FlowNode k="Never public" t="Draft signal" />
            <Arrow />
            <FlowNode k="Human" t="Publish" gate />
          </div>
          <ul className="show-list">
            <li>Same gates as discovery, zero special cases</li>
            <li>The file is read for its text, never stored</li>
            <li>Front door on the home page</li>
          </ul>
        </>
      ),
    },
    {
      id: 'blotter',
      title: 'News Blotter',
      node: (
        <>
          <div className="show-kicker">Portal 2 of 6</div>
          <h2 className="show-h2--sm">News Blotter</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>The editor&rsquo;s desk over the same feed</li>
              <li>Fortnight report, claims ledger, signal wire</li>
              <li>Pipeline analytics in the open</li>
            </ul>
            <Shot src="blotter.png" alt="The News Blotter broadsheet" />
          </div>
        </>
      ),
    },
    {
      id: 'map',
      title: 'Claims & Theses',
      node: (
        <>
          <div className="show-kicker">Portal 3 of 6</div>
          <h2 className="show-h2--sm">Claims &amp; Theses</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Six open questions, stances people actually hold</li>
              <li>Falsifiable claims with living confidence</li>
              <li>Standing theses re-tested as evidence lands</li>
            </ul>
            <Shot src="map.png" alt="The Claims and Theses hub" />
          </div>
        </>
      ),
    },
    {
      id: 'ask',
      title: 'Ask + deep research',
      node: (
        <>
          <div className="show-kicker">The working surface</div>
          <h2 className="show-h2--sm">Ask. Cited. Checkable.</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Multi-turn, every reference cited</li>
              <li>Citations open the record, then the source text itself, highlighted</li>
              <li>Deep research: an agentic loop over the corpus, about 2 cents a session</li>
              <li>Check this answer: quotes and figures verified against the record</li>
            </ul>
            <Shot src="ask.png" alt="Ask the Atlas with the document viewer open" />
          </div>
        </>
      ),
    },
    {
      id: 'reports',
      title: 'Report Portal',
      node: (
        <>
          <div className="show-kicker">Portal 4 of 6</div>
          <h2 className="show-h2--sm">Report Portal</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>A tear sheet on any claim, in two taps</li>
              <li>Narrative drafted over a frozen data pack</li>
              <li>Every link survives the citation gate, or is logged out</li>
              <li>Branded PDF: cover, stat band, evidence ledger</li>
            </ul>
            <Shot src="reports.png" alt="The Report Portal shelf" />
          </div>
          {briefing && (
            <div className="show-links">
              <a className="btn btn--ghost btn--sm" href={`/reports/sheet/${briefing.id}`} target="_blank" rel="noopener">
                Read the live briefing ↗
              </a>
            </div>
          )}
        </>
      ),
    },
    {
      id: 'datasets',
      title: 'Data Portal',
      node: (
        <>
          <div className="show-kicker">Portal 5 of 6</div>
          <h2 className="show-h2--sm">Data Portal</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>The corpus as 11 self-service datasets</li>
              <li>Schema pages, CSV and JSON, in-browser explorer</li>
              <li>Key-gated team tier with a daily budget cap</li>
            </ul>
            <Shot src="datasets.png" alt="The Data Portal catalog" />
          </div>
        </>
      ),
    },
    {
      id: 'research',
      title: 'Research Portal',
      node: (
        <>
          <div className="show-kicker">Portal 6 of 6</div>
          <h2 className="show-h2--sm">Research Portal</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>arXiv triaged against the map, not skimmed</li>
              <li>Kept papers get findings, rigor, claim touches</li>
              <li>Threads: living syntheses, every revision kept</li>
            </ul>
            <Shot src="research.png" alt="The Research Portal" />
          </div>
        </>
      ),
    },
    {
      id: 'full-text',
      title: 'The full-text position',
      node: (
        <>
          <div className="show-kicker">The corpus, honestly</div>
          <h2 className="show-h2--sm">
            {coverage.with_text} of {coverage.total} signals hold their source text.
          </h2>
          <ul className="show-list">
            <li>Every published signal retains the article behind it</li>
            <li>Internal working corpus: grounds the answers, the verification, the reports</li>
            <li>Keyed readers only · originals always linked · nothing republished</li>
            <li>Corporate build: the corpus is our own work product, and the question disappears</li>
          </ul>
          <div className="show-stats">
            <Stat n={`${Math.round((coverage.with_text / Math.max(coverage.total, 1)) * 100)}%`} l="retained-text coverage" />
            <Stat n="0" l="articles republished" />
          </div>
        </>
      ),
    },
    {
      id: 'architecture',
      title: 'Architecture',
      node: (
        <>
          <div className="show-kicker">Architecture</div>
          <h2 className="show-h2--sm">One database. One app. One AI seam.</h2>
          <ul className="show-list">
            <li>Postgres, deny-by-default; one Next.js app</li>
            <li>One AI seam: every call metered, rate-carded, model on the row</li>
            <li>Under 20 dollars a month, all-in</li>
            <li>Provider-swappable, including an internal or local model</li>
          </ul>
        </>
      ),
    },
    {
      id: 'thin',
      title: 'What is thin',
      node: (
        <>
          <div className="show-kicker">Credibility requires candor</div>
          <h2 className="show-h2--sm">What this is not yet.</h2>
          <ul className="show-list">
            <li>One author&rsquo;s map; the confidences are one person&rsquo;s judgment</li>
            <li>One deep lens so far: the market and economics of AI</li>
            <li>The corpus is the public web, walls and spin included</li>
            <li>It orients; it does not prove. Most weeks it correctly says nothing moved</li>
          </ul>
        </>
      ),
    },
    {
      id: 'seed',
      title: 'The seed',
      node: (
        <>
          <div className="show-kicker">The seed</div>
          <h2>What if our project outcomes lived on a map like this?</h2>
          <p>
            Pod consulting projects end in decks, and the claims inside them evaporate. Imagine the
            outcomes structured instead as claims and theses about where the world is going and what
            it takes to get there, with evidence accumulating across projects and a living record of
            what the group believes and why.
          </p>
          <p>
            Same architecture, internal corpus, on the internal model. Multimodal from day one,
            because the sources are our own documents, data, and decks.
          </p>
        </>
      ),
    },
    {
      id: 'close',
      title: 'Close',
      node: (
        <>
          <div className="show-kicker">The AI Atlas</div>
          <div className="show-rule" />
          <h2>Worth a conversation.</h2>
          <p className="show-lede">
            If a version of this inside Strategy sounds worth exploring, I would like to have that
            conversation.
          </p>
          <div className="show-links">
            <a className="btn btn--primary btn--sm" href="/" target="_blank" rel="noopener">Enter the Atlas ↗</a>
          </div>
        </>
      ),
    },
  ];

  return (
    <main className="show-page">
      <Showcase slides={slides} />
    </main>
  );
}
