import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Limitations · The Strategy Atlas' };

const SECTIONS = [
  {
    id: 'one-team',
    heading: 'One team’s judgment',
    body: 'This is a running record of how one team is thinking. The conviction levels are judgment, not a consensus or a measurement, and the board only covers the questions the team has chosen to work.',
  },
  {
    id: 'no-ingest',
    heading: 'It does not ingest the news',
    body: 'Nothing polls or auto-updates. Sources, signals, and papers enter when someone adds them by hand. The board only reflects what the team has looked at, and it can lag events between updates.',
  },
  {
    id: 'no-browse',
    heading: 'The AI works only from given text',
    body: 'The recommend-only AI works from the text it is handed: a grounded call is auditable and its inputs are on the record. There is no web search anywhere; deep research searches the Atlas corpus, not the live web. A dossier or a draft is only as good as the text behind it and can be wrong or out of date.',
  },
  {
    id: 'retained-text',
    heading: 'The article text is a working corpus, not a publication',
    body: 'Every published signal keeps the text of the document behind it, retained at intake. That text grounds the AI’s answers and reports, and keyed readers can open it beside an answer to check a quote. It is never republished: public visitors get the summary, the finding, and a link to the original where one exists.',
  },
  {
    id: 'not-built',
    heading: 'Not everything is built',
    body: (
      <ul>
        <li>The propose-queue-accept ingest flow. The tool only recommends for now.</li>
        <li>In-platform artifact deconstruction (structured document and CSV encoding). Intake is manual text for now.</li>
        <li>The digest sender. The digest view renders and its audit table exists, but nothing emails it yet.</li>
        <li>Uploaded PDFs are read for their text and never stored.</li>
        <li>Generated PDFs carry no page numbers; a rendering-stack limitation, worked around with static footers.</li>
      </ul>
    ),
  },
  {
    id: 'can-be-wrong',
    heading: 'Ways it can still be wrong',
    body: 'The guardrails reduce the obvious problems, they do not remove them. Conviction levels can carry the team’s bias. Evidence can stay one-sided if the looking stops. Hypotheses can go stale between updates. The structure pushes against all of this; it guarantees none of it.',
  },
];

export default async function LimitationsPage() {
  const { editing, txt } = await getEditContext();
  return (
    <>
      <header className="pagehead" style={{ paddingBottom: 16 }}>
        <Editable
          as="h1"
          k="about.limitations.title"
          value={txt('about.limitations.title', 'Limitations')}
          editing={editing}
        />
      </header>
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.limitations" txt={txt} />
    </>
  );
}
