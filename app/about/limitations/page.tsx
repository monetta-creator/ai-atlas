import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Limitations · The AI Atlas' };

const SECTIONS = [
  {
    id: 'one-lens',
    heading: 'One person, one lens',
    body: 'This is one author’s map. The deep argument map covers one lens, the market and economics of AI; the Signal Board files developments under six audience lenses. The confidence levels are one person’s judgment, not a consensus or a measurement.',
  },
  {
    id: 'no-ingest',
    heading: 'It does not ingest the news',
    body: 'Nothing polls or auto-updates. Sources, signals, papers, and companies enter when the author runs a pipeline or adds them by hand. The map only reflects what the author has looked at, and it can lag events between updates.',
  },
  {
    id: 'no-browse',
    heading: 'The AI mostly works from given text',
    body: 'The recommend-only AI works from the text it is handed: a grounded call is auditable and its inputs are on the record. Web search exists in three bounded places: the discovery pipeline and the scout’s company discovery (both draft-only), and the Ask workspace’s web toggle, which lets an answer fill gaps the records leave, with the sources listed and no faithfulness guarantee on the web half. Deep research still searches the Atlas corpus, not the live web. A dossier or a draft is only as good as the text behind it and can be wrong or out of date.',
  },
  {
    id: 'retained-text',
    heading: 'The article text is a working corpus, not a publication',
    body: 'Every published signal keeps the text of the article behind it. That text grounds the AI’s answers and reports, and keyed readers can open it beside an answer to check a quote. It is never republished: public visitors get the summary, the finding, and a link to the original. Some outlets block fetching entirely, so their signals carry summaries and links rather than text.',
  },
  {
    id: 'reflexivity',
    heading: 'Reflexivity is flagged, not solved',
    body: 'Some dynamics here feed on themselves, like money flowing into something because people expect it to pay off. Those claims get flagged, but a static map cannot fully capture a feedback loop.',
  },
  {
    id: 'not-built',
    heading: 'Not everything is built',
    body: (
      <ul>
        <li>The propose-queue-accept ingest flow. The tool only recommends for now.</li>
        <li>Scheduled discovery. The Signal Board’s pipeline, including its breaking-events sweep, runs only when the author triggers it by hand. The cron schedule is deferred.</li>
        <li>The digest sender. The digest view renders and its audit table exists, but nothing emails it yet.</li>
        <li>Uploaded PDFs are read for their text and never stored.</li>
        <li>Generated PDFs carry no page numbers; a rendering-stack limitation, worked around with static footers.</li>
      </ul>
    ),
  },
  {
    id: 'can-be-wrong',
    heading: 'Ways it can still be wrong',
    body: 'The guardrails reduce the obvious problems, they do not remove them. Confidence levels can carry the author’s bias. Stances may be argued unevenly. Evidence can stay one-sided if the looking stops. Claims can go stale between updates. The scout’s company facts come from the web and can be thin or wrong until enriched and reviewed. The structure pushes against all of this; it guarantees none of it.',
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
