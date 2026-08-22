import Link from 'next/link';
import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'About · The Strategy Atlas' };

const OVERVIEW = [
  {
    id: 'what-it-is',
    heading: 'What it is',
    body: 'The Strategy Atlas tracks an operating team\u2019s strategic hypotheses: the falsifiable statements the strategy leans on, the evidence for and against each, and the conviction the team has committed to them. Its job is to place a new development on the board and show which hypotheses it touches.',
  },
  {
    id: 'the-problem',
    heading: 'The problem',
    body: 'Signals arrive fast, confident, contradictory, and usually from someone with a position to protect. The Atlas is one fixed place to put each piece and see what it actually touches.',
  },
  {
    id: 'how-it-works',
    heading: 'How it works',
    body: 'Every hypothesis carries a test: what would have to be true to stop believing it. Evidence attaches to hypotheses as supporting or contradicting, each link weighted by a confidence the operator sets. A private layer holds the operator\u2019s conviction and reasons; the public view is the same board with that layer stripped. New material enters through manual intake (documents the team and its librarian bring in) that only ever produces drafts. A human reviews everything before it reaches the board, and publishing a signal is what writes its evidence rows. The working surfaces (Ask, the reports, the datasets) sit on top of the same corpus, with every generated citation checked against the records before it ships.',
  },
  {
    id: 'why-it-matters',
    heading: 'What success looks like',
    body: 'Most weeks nothing happens that should move the board, and the tool says so. Success is being able to place a new development and know what it touches.',
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
    blurb: 'Every term defined: hypothesis, test, conviction, confidence, signal, and the rest.',
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
  'The board covers the strategic questions the team is actually working. Signals are filed by context: internal developments from inside the organization, external developments from the world. The whole thing is a running record of how the team is thinking, not a consensus.';

export default async function AboutPage() {
  const { editing, txt } = await getEditContext();

  return (
    <>
      <header className="pagehead">
        <Editable
          as="h1"
          k="about.overview.title"
          value={txt('about.overview.title', 'About the Strategy Atlas')}
          editing={editing}
        />
        <Editable
          as="p"
          className="lede"
          multiline
          k="about.overview.lede"
          value={txt('about.overview.lede', 'A structured board for tracking strategic hypotheses, evidence, and conviction.')}
          editing={editing}
        />
      </header>

      <Editable
        as="p"
        multiline
        k="about.overview.surfaces"
        value={txt(
          'about.overview.surfaces',
          'The front door is the lobby: a question box and six portals. The Signal Board tracks developments by internal and external context. The News Blotter is the editor’s desk over the same feed. Hypotheses is the board itself. The Report Portal serves generated, citation-gated reports as PDFs. The Data Portal offers the corpus as downloadable datasets. The Research Portal reads papers and long documents deeply against the board. Ask, the chat workspace, answers over the whole corpus with citations that open the underlying record.'
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
