import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';
import { NAV_TREE } from '@/lib/nav';
import { DATASETS } from '@/lib/datasets/registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Data handling · The AI Atlas' };

// The surfaces and dataset counts are derived from their registries so this page
// cannot drift from the nav or the Data Portal. Both modules are pure (no DB).
const PORTAL_LABELS = NAV_TREE.filter((g) => g.key !== 'home').map((g) => g.label);
const PORTAL_LIST = `${PORTAL_LABELS.slice(0, -1).join(', ')}, and ${PORTAL_LABELS[PORTAL_LABELS.length - 1]}`;
const DATASET_COUNT = DATASETS.length;
const KEY_GATED_COUNT = DATASETS.filter((d) => d.keyGated).length;

const SECTIONS = [
  {
    id: 'what-and-who',
    heading: 'What this is and who runs it',
    body: `The AI Atlas is a personal project. It runs on the maintainer’s own hosting accounts (Vercel for the application, Supabase for the Postgres database) and is not an employer system, an official product, or the view of any organization the maintainer works for or with. The site is public by URL: anything not behind the access key or the admin password can be read by anyone who has the address. The public surfaces are ${PORTAL_LIST}. The confidence levels on the argument map are the maintainer’s own judgments and nothing else.`,
  },
  {
    id: 'sources',
    heading: 'Where the data comes from',
    body: (
      <>
        <p>
          Every collection engine reads public sources only: the engines hold no subscriptions and never log in, so
          what is stored is what a page serves to an anonymous reader, whether fetched directly or through the Jina
          reader. A page that refuses to be fetched is kept as a title and a link (plus the search result’s snippet,
          where there is one) rather than as text.
        </p>
        <ul>
          <li>External Scan and the discovery pipeline: public RSS and Atom press feeds, Tavily news search, CourtListener for court dockets, and Anthropic’s web search tool as the fallback when Tavily is unavailable and for the pipeline’s post-run coverage check.</li>
          <li>Research Portal: the arXiv API for papers, Semantic Scholar for citation counts.</li>
          <li>Intel Desk: company press feeds, Bing News RSS as the default news feed, Tavily search, SEC EDGAR filings and XBRL financials, FDIC call-report data, CFPB complaint statistics, Federal Reserve Y-9C holding-company reports (loaded quarterly from a downloaded public file), and the public Greenhouse and Lever job boards of tracked companies.</li>
          <li>Tooling Monitor: Tavily search, the Hacker News front page via Algolia, GitHub repository search, Product Hunt when an API token is configured, and Anthropic’s web search tool for category enumeration pulls and product deep dives.</li>
          <li>Startup Scout: Anthropic’s web search tool for company discovery and research sweeps.</li>
          <li>The Daily Edition: the Hacker News front page and a market strip from Yahoo Finance’s chart endpoint, an unofficial feed that can stop working without notice.</li>
          <li>Fetching: article pages are fetched directly; when a host blocks the fetch, Jina Reader (r.jina.ai) is tried as a fallback.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'processors',
    heading: 'Third-party processors',
    body: 'Text collected here is sent to outside services to be processed. Anthropic runs the Claude Sonnet and Claude Haiku models. OpenRouter routes calls to open-weight models (Zhipu’s GLM, Alibaba’s Qwen, and DeepSeek’s models) run by whichever inference provider OpenRouter selects for the call. Tavily performs news search. Jina fetches pages the site cannot fetch itself. Resend sends the agent’s daily brief by email to the maintainer. Vercel hosts the application and, through Vercel Web Analytics, counts page views: each view sends the page path, referrer, and coarse device and country data to Vercel, without cookies and without a per-visitor identifier that persists across days. Supabase hosts the database. On the Tooling Monitor your browser loads vendor logos directly from Google’s favicon service and from GitHub, so those two services see your request; nothing from that is stored here. Each of these providers applies its own retention and training terms to what is sent to it, and this site does not control those terms.',
  },
  {
    id: 'sent-to-models',
    heading: 'What is sent to model providers',
    body: 'Article text and filings, for summaries, tags, and fact extraction. Extracted facts, when a dossier or a report is composed from them. An Ask question, the record excerpts retrieved for it, and the recent conversation: the question and the previous user turn go to the classifier (a Qwen model via OpenRouter); the question, the excerpts, and up to the last twelve turns of the conversation (about 8,000 characters, your questions and the earlier answers) go to the answering model (Claude Haiku via Anthropic). The text of a document uploaded on a Scout profile or the add-source form. The free-text context field on the tooling report console, which is written into the report pack. When web search is switched on in Ask, or when a fresh question the records do not cover switches it on automatically for that turn, the question also goes to Anthropic’s search tool.',
  },
  {
    id: 'stored',
    heading: 'What is stored and for how long',
    body: 'The database keeps the full text of every collected article, filing, and paper; the text extracted in the browser from uploaded documents; the facts, tags, scores, and summaries the models produce; and the data packs behind every generated report, including the tooling report’s context field. Everything is kept indefinitely. There is no retention limit and no deletion job today. Archiving a signal or a draft hides it from the public surfaces; it does not delete the row. Uploaded documents are never stored as files: the browser extracts the text, sends the text, and discards the file. The one exception is the feedback box, whose screenshots are stored in the database and are visible only to the maintainer. The Data Portal’s schema map (/datasets/schema) shows the shape of every table this stores, grouped by subsystem, with no row of data ever shown.',
  },
  {
    id: 'personal-data',
    heading: 'Personal data',
    body: (
      <>
        <p>
          The feedback box stores the email address you enter (it is required), the page you were on, your browser’s
          user-agent string, and any screenshots you attach. Only the maintainer can read a ticket. Source dossiers and
          Scout company profiles carry facts about named authors, founders, and team members drawn from public sources;
          a dossier notes the basis of each claim, and a Scout profile lists the pages it consulted. Once the
          access-request form ships, a request will store a name and a
          work email address.
        </p>
        <p>
          Do not enter confidential information into Ask, a document upload, or any form on this site. Everything you
          type may be stored here and sent to the processors above.
        </p>
      </>
    ),
  },
  {
    id: 'access-tiers',
    heading: 'Access tiers',
    body: `Three tiers. A guest, with no session at all, sees the public layer: the surfaces above with confidences stripped, published signals only, and the ${DATASET_COUNT - KEY_GATED_COUNT} public datasets. An access key (per-person, issued by the maintainer on request through the request form, expiring after 90 days unless renewed; a legacy shared key remains during the migration) unlocks Ask, the ${KEY_GATED_COUNT} key-gated datasets (retained article text, machine-extracted records including items no human has reviewed, agent scores, rigor priors, and dossier fields), tooling reports and drafts, and the Scout research tools and document upload. The admin, one password, sees the personal layer (confidences, rationales, reliability priors), every draft, and the operating consoles.`,
  },
  {
    id: 'model-written',
    heading: 'Model-written and auto-published outputs',
    body: (
      <>
        <p>
          Most of what the models produce is a proposal a human then commits or discards. Seven things publish without
          a human step:
        </p>
        <ul>
          <li>The Daily Edition, written each weekday from what the engines already stored, by default by a GLM model via OpenRouter (the model is a setting).</li>
          <li>The Friday research roundup and the Monday tooling entrants report, both written by Claude Sonnet.</li>
          <li>The weekday company intel deck, written from the Intel Desk’s collected items, extracted facts, filings, and metric moves; it goes out to access-key holders and the admin only, never guests, since it names the companies the desk tracks.</li>
          <li>High-significance pipeline signal drafts that touch at least one claim, published after a veto window (48 hours by default) unless a human archives them first.</li>
          <li>Tooling products scored at or above the catalog threshold, which enter the public catalog automatically.</li>
          <li>Period reports, which are public as soon as the admin saves one.</li>
        </ul>
        <p>
          The Daily Edition, the research roundup, the tooling reports, the generated sheets, the thesis reports, and
          the company intel deck pass a citation gate, so a link the records cannot vouch for is stripped. Period
          reports are edited by the admin before saving; a signal draft’s claim touches are checked against live claim
          codes but its text is not link-gated. A confidence on the argument map never moves without a human-written
          rationale.
        </p>
      </>
    ),
  },
];

export default async function DataHandlingPage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/data-handling"
        label="Data handling"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.data-handling.title"
            value={txt('about.data-handling.title', 'Data handling')}
            editing={editing}
          />
        }
      />
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.data-handling" txt={txt} />
    </>
  );
}
