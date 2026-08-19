import Link from 'next/link';
import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'About · The AI Atlas' };

const OVERVIEW = [
  {
    id: 'what-it-is',
    heading: 'What it is',
    body: 'The AI Atlas maps the debate about the AI economy: the open questions, the positions people take on them, what each position depends on, and what is still unsettled. Its job is to place a new development on the map and show what it affects.',
  },
  {
    id: 'the-problem',
    heading: 'The problem',
    body: 'Claims about AI arrive fast, confident, contradictory, and usually from someone with a position to protect. The Atlas is one fixed place to put each piece and see what it actually touches.',
  },
  {
    id: 'how-it-works',
    heading: 'How it works',
    body: 'A question holds two to four stances, each labeled with who holds it. Each stance rests on claims, and every claim carries a test: what would have to be true to stop believing it. Evidence attaches to claims as supporting or contradicting. Claims linking two domains are pulled out as bridge-claims and tested on their own. A private layer holds the author’s confidence and reasons; the public view is the same map with that layer stripped. New material enters through pipelines (web discovery for the Signal Board, arXiv triage for research, company discovery for the scout) that only ever produce drafts. A human reviews everything before it reaches the map, and publishing a signal is what writes its evidence rows. The working surfaces (Ask, the reports, the datasets) sit on top of the same corpus, with every generated citation checked against the records before it ships.',
  },
  {
    id: 'why-it-matters',
    heading: 'What success looks like',
    body: 'Most weeks nothing happens that should move the map, and the tool says so. Success is being able to place a new development and know what it touches.',
  },
];

// Architecture is unlisted by choice; the reading guide is gone (2026-08-15).
const HUB = [
  {
    id: 'guardrails',
    href: '/about/guardrails',
    index: '01',
    kind: 'anti-bias',
    title: 'Guardrails',
    blurb: 'The schema rules that enforce falsifiability, and the anti-patterns they block.',
  },
  {
    id: 'glossary',
    href: '/about/glossary',
    index: '02',
    kind: 'terms',
    title: 'Glossary',
    blurb: 'Every term defined: question, stance, claim, test, frame, bridge-claim, and the rest.',
  },
  {
    id: 'limitations',
    href: '/about/limitations',
    index: '03',
    kind: 'honest',
    title: 'Limitations',
    blurb: 'What the tool does not do, what is not built yet, and the ways it can be wrong.',
  },
];

const SCOPE_DEFAULT =
  'The deep argument map covers one lens: the market and economics of AI. The Signal Board ranges wider, filing developments under six audience lenses. The whole thing is a running record of how one person is thinking, not a consensus.';

export default async function AboutPage() {
  const { editing, txt } = await getEditContext();

  return (
    <>
      <header className="pagehead">
        <Editable
          as="h1"
          k="about.overview.title"
          value={txt('about.overview.title', 'About the AI Atlas')}
          editing={editing}
        />
        <Editable
          as="p"
          className="lede"
          multiline
          k="about.overview.lede"
          value={txt('about.overview.lede', 'A structured map for staying oriented in the AI economy debate.')}
          editing={editing}
        />
      </header>

      <Editable
        as="p"
        multiline
        k="about.overview.surfaces"
        value={txt(
          'about.overview.surfaces',
          'The front door is the lobby: a question box and seven portals. The Signal Board tracks developments by audience lens. The News Blotter is the editor’s desk over the same feed. Claims & Theses is the argument map. The Report Portal serves generated, citation-gated reports as PDFs. The Data Portal offers the corpus as downloadable datasets. The Research Portal triages arXiv papers against the map. Startup Scout tracks young AI companies as acquisition candidates by vertical. Ask, the chat workspace, answers over the whole corpus with citations that open the underlying record.'
        )}
        editing={editing}
        style={{ fontSize: 15, lineHeight: 1.6, color: 'var(--dim)', margin: '0 0 8px' }}
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

      <div style={{ marginTop: 40, paddingTop: 26, borderTop: '1px solid var(--line)' }}>
        <Link href="/map" className="btn btn--primary">Enter the Atlas →</Link>
      </div>
    </>
  );
}
