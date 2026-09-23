import Image from 'next/image';
import { getLobbyStats, getPipelinePrefs, getTextCoverage, listGeneratedReports } from '@/lib/data';
import { isAdmin } from '@/lib/auth';
import { NAV_TREE } from '@/lib/nav';
import { DATASETS } from '@/lib/datasets/registry';
import Showcase, { type ShowSlide } from '@/components/showcase/Showcase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Showcase · The AI Atlas', robots: { index: false, follow: false } };

// The Showcase: an unlisted, in-app slide deck for demoing the Atlas live.
// Public route (open by default, robots noindex) but linked from nowhere; the
// stats are live database reads, so the deck is rendered by the tool it
// describes. v2 is visual: bullets only, real screen grabs
// (public/showcase/*.png, recaptured with scripts/capture-showcase.mjs),
// pipeline flow diagrams, and the search-vs-chatbots comparison. Slide content
// lives here, server-side; the client controller only paginates.
//
// Two decks share one slide list: the sessionless deck is a neutral product
// demo, and the slides flagged `admin` (the maintainer's pitch material) are
// appended only when the viewer holds the admin cookie. Counts (portals,
// datasets) derive from the registries rather than being typed in.

type DeckSlide = ShowSlide & { admin?: boolean };

// The portals are the NAV_TREE groups minus the home hub.
const PORTALS = NAV_TREE.filter((g) => g.key !== 'home');
function portalKicker(key: string): string {
  const i = PORTALS.findIndex((g) => g.key === key);
  return `Portal ${i + 1} of ${PORTALS.length}`;
}
const DATASET_COUNT = DATASETS.length;
const KEY_GATED_COUNT = DATASETS.filter((d) => d.keyGated).length;

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
  const [admin, stats, coverage, sheets, prefs] = await Promise.all([
    isAdmin(),
    getLobbyStats(),
    getTextCoverage(),
    listGeneratedReports(true),
    getPipelinePrefs(),
  ]);
  const briefing = sheets.find((s) => s.kind === 'atlas') ?? sheets[0] ?? null;
  // The promotion policy's veto window is an admin-editable pref (mig 0055),
  // so the deck reads it rather than typing a number in.
  const vetoHours = prefs.auto_publish_after_hours;

  const deck: DeckSlide[] = [
    {
      id: 'cover',
      title: 'Cover',
      node: (
        <>
          <div className="show-kicker">The AI Atlas · {datelineET()}</div>
          <div className="show-rule" />
          <h2>A map of the AI-economy debate.</h2>
          <p className="show-lede">
            An orientation tool for the AI-economy debate: the open questions, the claims they turn
            on, and the evidence as it lands. Every statistic in this deck is a live read from the
            tool itself.
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
      id: 'portals',
      title: 'The portals',
      node: (
        <>
          <div className="show-kicker">Two public surfaces became {PORTALS.length}</div>
          <h2 className="show-h2--sm">{PORTALS.length} portals over one body of material.</h2>
          <ul className="show-list">
            {PORTALS.map((g) => (
              <li key={g.key}>{g.label}</li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: 'signals',
      title: 'Signal Board',
      node: (
        <>
          <div className="show-kicker">{portalKicker('signals')}</div>
          <h2 className="show-h2--sm">Signal Board</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Tracked developments, six audience lenses</li>
              <li>Each signal wired to the claims it touches</li>
              <li>Publishing materializes evidence onto the map</li>
              <li>Drafts stay private until published: by hand, or a high-significance pipeline draft after a {vetoHours}-hour veto window</li>
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
            <FlowNode k="Lens queries + breaking sweep + court dockets" t="Discovery" />
            <Arrow />
            <FlowNode k="Dedupe + source track record" t="Triage" />
            <Arrow />
            <FlowNode k="Fetch text + propose" t="Analyze" />
            <Arrow />
            <FlowNode k="Private" t="Draft signal" />
            <Arrow />
            <FlowNode k={`Human, or ${vetoHours}h veto`} t="Publish" gate />
            <Arrow />
            <FlowNode k="On the map" t="Evidence" />
          </div>
          <p className="show-flow-note">
            the learning loop: zero-yield domains get blocked · fetch-hostile domains route through a reader
            · a post-run coverage check audits what was missed
          </p>
          <ul className="show-list">
            <li>Runs on weekday crons, resumable, checkpointed in the database</li>
            <li>The model proposes; a draft is only evidence once it is published</li>
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
            <li>The file is read for its text in the browser and never stored; the extracted text is retained</li>
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
          <div className="show-kicker">{portalKicker('blotter')}</div>
          <h2 className="show-h2--sm">News Blotter</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>A daily edition, written every weekday from what the engines already stored</li>
              <li>Front page, a column tying the day to claims, research, tools, blind spots</li>
              <li>Every link cited from the day&rsquo;s record; quiet days skip</li>
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
          <div className="show-kicker">{portalKicker('map')}</div>
          <h2 className="show-h2--sm">Claims &amp; Theses</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Open questions, stances people actually hold</li>
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
      title: 'Ask the Atlas',
      node: (
        <>
          <div className="show-kicker">The working surface</div>
          <h2 className="show-h2--sm">Ask. Cited. Checkable.</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>Multi-turn, every reference cited; an access key unlocks it, under a daily budget cap</li>
              <li>Citations open the record, then the source text itself, highlighted</li>
              <li>Every answer ends with its cost: tokens, searches, model calls</li>
              <li>Verification on the maintainer&rsquo;s answers: quotes and figures checked against the record</li>
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
          <div className="show-kicker">{portalKicker('reports')}</div>
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
          <div className="show-kicker">{portalKicker('datasets')}</div>
          <h2 className="show-h2--sm">Data Portal</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>The corpus as {DATASET_COUNT} self-service datasets, {KEY_GATED_COUNT} of them behind an access key</li>
              <li>Schema pages, CSV and JSON, in-browser explorer</li>
              <li>The keyed tier also unlocks Ask, under a daily budget cap</li>
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
          <div className="show-kicker">{portalKicker('research')}</div>
          <h2 className="show-h2--sm">Research Portal</h2>
          <div className="show-cols">
            <ul className="show-list">
              <li>arXiv triaged every weekday against the map, not skimmed</li>
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
            <li>Published signals retain the article behind them where the fetch succeeded; the gap is refetched</li>
            <li>A working corpus: it grounds the answers, the verification, the reports</li>
            <li>Keyed readers only · originals always linked · nothing republished</li>
            {admin && (
              <li>Corporate build: the corpus is our own work product, and the question disappears</li>
            )}
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
            <li>Postgres, deny-by-default; one Next.js app; weekday crons run the engines</li>
            <li>One AI seam: every model call and every paid search call metered, rate-carded, model on the row</li>
            <li>Fixed hosting plus metered model spend, capped per engine (daily; weekly for the tooling scanner)</li>
            <li>Provider-swappable: Anthropic models and OpenRouter-hosted open-weight models today</li>
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
            <li>One maintainer&rsquo;s map; the confidences are one person&rsquo;s judgment</li>
            <li>Deepest on the market and economics of AI; other lenses are thinner</li>
            <li>The corpus is the public web, walls and spin included</li>
            <li>It orients; it does not prove. Most weeks it correctly says nothing moved</li>
          </ul>
        </>
      ),
    },
    {
      id: 'seed',
      title: 'The seed',
      admin: true,
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
      id: 'close-internal',
      title: 'Close',
      admin: true,
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
    {
      id: 'close',
      title: 'Close',
      admin: false,
      node: (
        <>
          <div className="show-kicker">The AI Atlas</div>
          <div className="show-rule" />
          <h2>Orientation, not proof.</h2>
          <p className="show-lede">
            The model proposes, a human commits, and every move keeps its written reason. The About
            pages describe how it works, where the data comes from, and what is stored.
          </p>
          <div className="show-links">
            <a className="btn btn--primary btn--sm" href="/" target="_blank" rel="noopener">Enter the Atlas ↗</a>
            <a className="btn btn--ghost btn--sm" href="/about" target="_blank" rel="noopener">How it works ↗</a>
          </div>
        </>
      ),
    },
  ];

  // The sessionless deck drops the pitch slides; the admin deck drops the
  // public close in favour of the internal one.
  const slides: ShowSlide[] = deck
    .filter((s) => s.admin === undefined || s.admin === admin)
    .map((s) => ({ id: s.id, title: s.title, node: s.node }));

  return (
    <main className="show-page">
      <Showcase slides={slides} />
    </main>
  );
}
