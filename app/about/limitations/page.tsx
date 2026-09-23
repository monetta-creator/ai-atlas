import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Limitations · The AI Atlas' };

const SECTIONS = [
  {
    id: 'one-lens',
    heading: 'One person, one lens',
    body: 'This is the maintainer’s map, a personal project. The deep argument map covers one lens, the market and economics of AI; the Signal Board files developments under six audience lenses. The confidence levels are one person’s judgment, not a consensus or a measurement.',
  },
  {
    id: 'no-ingest',
    heading: 'The map does not update itself',
    body: 'Collection is automatic; judgment is not. Weekday crons run the collection engines (the news scan, the Signal Board’s discovery pipeline, company intel, arXiv research, and a weekly tooling scan), and the Daily Edition is written from what they stored, on schedule, with no one present. The argument map is different: no confidence moves without the maintainer writing a reason, so the map reflects what the maintainer has judged and can lag the feed by days or weeks.',
  },
  {
    id: 'no-browse',
    heading: 'The AI mostly works from given text',
    body: 'The recommend-only AI works from the text it is handed: a grounded call is auditable and its inputs are on the record. The live web reaches the system in two ways. The collection engines’ search legs run mostly on Tavily, a model-free search API, beside RSS feeds and primary sources (SEC EDGAR, FDIC, CFPB, arXiv, GitHub, Hacker News). Anthropic’s web_search, which lets the model search for itself, runs in a few bounded features: Scout’s company discovery, competitor scan, and intel sweeps, the Tooling Monitor’s deep dives and its big-pull category enumeration, and the Ask workspace’s web toggle, which lets an answer fill gaps the records leave, with the sources listed and no faithfulness guarantee on the web half; the collection engines fall back to it only when their model-free providers are not configured. With that toggle off, deep research searches the Atlas corpus, with one exception: a fresh question the records do not cover turns web search on for that turn, and the answer says so. A dossier or a draft is only as good as the text behind it and can be wrong or out of date.',
  },
  {
    id: 'retained-text',
    heading: 'The retained text is a working corpus, not a publication',
    body: 'Every item the engines collect keeps the text behind it: articles, filings, papers, and the text extracted from uploaded documents, retained with no retention limit today. That text grounds the AI’s answers and reports. Public visitors get the summary, the finding, and a link to the original. Readers with an access key can open the retained text beside an answer to check a quote and download it in the key-gated datasets; it is not republished on the public pages. Some outlets block fetching entirely, so their items carry summaries and links rather than text.',
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
        <li>A propose-queue-accept flow for the argument map itself (the extraction_queue table is scaffolded, not wired). On the map the tool only recommends; the desks (signals, research, scout, tooling) already queue and accept.</li>
        <li>A retention policy. Collected text is kept indefinitely; there is no deletion job, and archiving a row never deletes it.</li>
        <li>The signal digest sender. The Signal Board’s digest view renders and its audit table exists, but nothing emails it. (The Atlas Agent’s daily brief is the one thing that emails, through Resend, when the maintainer configures it.)</li>
        <li>File storage for uploads. An uploaded PDF is read for its text in the browser and the file is discarded; the extracted text is what gets stored and sent to the model.</li>
        <li>Generated PDFs carry no page numbers; a rendering-stack limitation, worked around with static footers.</li>
      </ul>
    ),
  },
  {
    id: 'can-be-wrong',
    heading: 'Ways it can still be wrong',
    body: 'The guardrails reduce the obvious problems, they do not remove them. Confidence levels can carry the maintainer’s bias. Stances may be argued unevenly. Evidence can stay one-sided if the looking stops. Claims can go stale between updates. The scout’s company facts come from the web and can be thin or wrong until enriched and reviewed. The Daily Edition, the scheduled reports, and the engines’ summaries and tags are model-written with no human review step, so they can misread a source. The structure pushes against all of this; it guarantees none of it.',
  },
];

export default async function LimitationsPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/limitations"
        label="Limitations"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.limitations.title"
            value={txt('about.limitations.title', 'Limitations')}
            editing={editing}
          />
        }
      />
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.limitations" txt={txt} />
    </>
  );
}
