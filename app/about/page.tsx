import Link from 'next/link';
import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';
import { portalGroups } from '@/lib/nav';
import { DATASETS } from '@/lib/datasets/registry';
import { ATLAS_ONE_LINER } from '@/lib/brand';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'About · The AI Atlas',
  description: 'An intelligence system for the AI economy, built on a map of the argument: what it is, how a week moves through it, and where it fails.',
};

// The one-liner now lives in lib/brand.ts, imported above, so other pages
// (layout metadata, the login card, the showcase deck) can use it without
// pulling in this whole page. Every count and portal name below still
// derives from the nav tree (portalGroups) and the dataset registry, never a
// hard-coded number (the truth-pass rule).

// One sentence per portal, keyed by its nav group. A portal with no sentence
// yet is still counted and named.
const PORTAL_SENTENCES: Record<string, string> = {
  signals: 'the Signal Board files each tracked development under the audiences it matters to and the claims it bears on;',
  blotter: 'the News Blotter is the Daily Edition, a newspaper written each weekday from what the engines collected;',
  savant: 'Savant is the Atlas’s own weekly research report, with a point of view and a ledger of open hypotheses;',
  map: 'Claims & Theses is the argument map itself;',
  reports: 'the Report Portal holds every report the Atlas writes, each a cited PDF;',
  datasets: 'the Data Portal offers the corpus as datasets',
  research: 'the Research Portal reads new AI research against the map;',
  scout: 'Startup Scout follows young AI companies;',
  tooling: 'and the Tooling Monitor scans the market for AI tools each week.',
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function surfacesDefault(): string {
  const portals = portalGroups();
  const gated = DATASETS.filter((d) => d.keyGated).length;
  const parts = portals.map((g) => {
    const s = PORTAL_SENTENCES[g.key] ?? `${g.label} is one of them;`;
    if (g.key === 'datasets') return `${s} (${DATASETS.length} today, ${gated} of them behind an access key);`;
    return s;
  });
  const body = parts.join(' ').replace(/;\s*$/, '.');
  return `The Atlas is ${numberWord(portals.length)} portals over one body of material: ${body.charAt(0).toLowerCase()}${body.slice(1)} Beside them, Ask answers questions over all of it with citations you can open, and Education keeps a shelf of guides.`;
}

const OVERVIEW = [
  {
    id: 'what-it-is',
    heading: 'What it is',
    body: 'The AI Atlas collects what happens in AI every weekday, from news wires, regulatory filings, research papers and the tool market, and places each development on a map of the open questions: what is being claimed, what would settle it, and which evidence moves it. Engines gather and structure the record; a daily edition and a weekly research report read it; Ask answers over the whole corpus with citations you can open. It is written for people carrying AI transformation inside regulated financial institutions, where a claim has to be checkable before anyone acts on it, and where the honest answer most weeks is that nothing settled.',
  },
  {
    id: 'the-map',
    heading: 'The map at the core',
    body: 'Everything else hangs on one structure. An open question about AI and the economy holds two to four stances, each labeled with who holds it. Each stance rests on claims, and every claim carries a test: what would have to be true to stop believing it. Evidence attaches to a claim as supporting or contradicting it. A claim that links two domains, say compute costs to labor markets, is pulled out as a bridge-claim and tested on its own. The maintainer’s confidence in each claim, and the written reason for every change, sits in a private layer; the public view is the same map with that layer removed. The map is how a new development gets placed: not "is this big news" but "which argument does this move, and which way".',
  },
  {
    id: 'the-loop',
    heading: 'How a week moves through it',
    body: 'Collect: collection engines run on weekday schedules (a news scan, the Signal Board’s discovery pipeline, company intelligence, new research, and a weekly tooling scan), and every item is kept with its source. Structure: models turn raw text into records under written rules (a summary, tags, extracted facts, a relevance score, a source-reliability tier), and every record is indexed for search by words and by meaning. Place: a development becomes a signal that touches named claims; publishing it, by a person or by a 48-hour policy for high-significance drafts that nobody archived, is what writes its evidence onto the map. Read: the Daily Edition writes the day up each weekday afternoon; on Fridays the research roundup and Savant write the week, and Savant poses a new hypothesis and revisits the open ones. Ask: questions get answers drawn from the records and the Atlas’s own reports, each cited, with a line marking where an answer goes beyond what the Atlas holds. Decide: nothing the machines produce moves a confidence. A person moves it, and has to write down why.',
  },
  {
    id: 'why-it-matters',
    heading: 'What success looks like',
    body: 'Most weeks nothing happens that should move the map, and the Atlas says so. Success is being able to place a new development in a minute and know what it touches, and to hand a colleague a report where every sentence opens onto its record.',
  },
];

// The six sub-pages. Architecture stays unlisted.
const HUB = [
  { id: 'inside', href: '/about/inside', index: '01', kind: 'the tour', title: 'Inside the Atlas', blurb: 'Every portal: what it does, what it looks like, and the pages inside it.' },
  { id: 'how-it-works', href: '/about/how-it-works', index: '02', kind: 'the rules', title: 'How it works', blurb: 'The engines, the gates between a model and the public page, and how Ask finds things.' },
  { id: 'where-it-fails', href: '/about/where-it-fails', index: '03', kind: 'honest', title: 'Where it fails', blurb: 'What it does not do, what is not built, and the ways it can be wrong.' },
  { id: 'data-handling', href: '/about/data-handling', index: '04', kind: 'your data', title: 'Data handling', blurb: 'Where the data comes from, which services see it, what is stored, and who can read what.' },
  { id: 'glossary', href: '/about/glossary', index: '05', kind: 'terms', title: 'Glossary', blurb: 'Every term defined: question, stance, claim, test, bridge-claim, signal, Savant, and the rest.' },
  { id: 'why-bespoke', href: '/about/why-bespoke', index: '06', kind: 'positioning', title: 'Why bespoke', blurb: 'What this does that a general chatbot or a research platform cannot.' },
];

const SCOPE_DEFAULT =
  'The deep argument map covers the market and economics of AI. The collection engines range wider, from bank regulation to the tool market, and the Signal Board files what they find under six audience lenses. The whole thing is a personal project and a running record of how the maintainer reads the field, not a consensus and not advice.';

export default async function AboutPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);

  return (
    <>
      <PageTop
        pathname="/about"
        label="About"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.overview.title"
            value={txt('about.overview.title', 'About the AI Atlas')}
            editing={editing}
          />
        }
      />

      <p className="about-oneliner">{ATLAS_ONE_LINER}</p>

      <Editable
        as="p"
        multiline
        k="about.overview.surfaces"
        value={txt('about.overview.surfaces', surfacesDefault())}
        editing={editing}
        style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--dim)', margin: '0 0 36px', maxWidth: '68ch' }}
      />

      <Prose sections={OVERVIEW} editing={editing} keyPrefix="about.overview" txt={txt} />

      <div className="test-panel" style={{ marginTop: 44 }}>
        <span className="tlabel">Scope</span>
        <Editable
          as="p"
          multiline
          k="about.overview.scope"
          value={txt('about.overview.scope', SCOPE_DEFAULT)}
          editing={editing}
        />
      </div>

      <div className="section-label">The rest of the section</div>
      <div className="qgrid" style={{ paddingBottom: 8 }}>
        {HUB.map((c) => (
          <Link key={c.href} href={c.href} className="qcard">
            <div className="qcode">
              {c.index}
              <span className="lens">· {c.kind}</span>
            </div>
            <Editable
              as="h3"
              k={`about.overview.hub.${c.id}.title`}
              value={txt(`about.overview.hub.${c.id}.title`, c.title)}
              editing={editing}
            />
            <Editable
              as="p"
              className="blurb"
              multiline
              k={`about.overview.hub.${c.id}.blurb`}
              value={txt(`about.overview.hub.${c.id}.blurb`, c.blurb)}
              editing={editing}
            />
            <div className="qstats">Read →</div>
          </Link>
        ))}
      </div>

      <div style={{ marginTop: 40, paddingTop: 26, borderTop: '1px solid var(--line)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link href="/portals" className="btn btn--primary">Explore the portals →</Link>
        <Link href="/map" className="btn">Open the argument map</Link>
      </div>
    </>
  );
}
