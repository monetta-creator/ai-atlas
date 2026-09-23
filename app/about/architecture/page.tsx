import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import PageTop from '@/components/PageTop';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';
import vercelConfig from '@/vercel.json';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Architecture · The AI Atlas' };

// The cron count is read from the deploy config (as /scan does) so this page cannot drift from it.
const CRON_COUNT = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons.length;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Capitalized English word for 0-99 (sentence-initial use); digits beyond that. */
function numberWord(n: number): string {
  let w: string;
  if (n < 20) w = ONES[n];
  else if (n < 100) w = TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  else w = String(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const SECTIONS = [
  {
    id: 'stack',
    heading: 'Stack',
    body: (
      <ul>
        <li>
          <strong>Next.js 16.2.6</strong> (App Router, Turbopack). Request routing lives in{' '}
          <code>proxy.ts</code> (this version uses <code>proxy</code>, not a <code>middleware.ts</code>).
          It is open by default: every page renders sessionless and gates itself, and the proxy fences
          only API routes outside a short allow-list.
        </li>
        <li><strong>React 19</strong>, <strong>TypeScript</strong> (strict).</li>
        <li>
          <strong>Tailwind v4</strong>, CSS-first (<code>@theme</code> in <code>globals.css</code>, no{' '}
          <code>tailwind.config</code>). The Console design system lives in{' '}
          <code>app/styles/&#123;tokens,base,components&#125;.css</code>.
        </li>
        <li>
          <strong>Supabase Postgres</strong>, reached at runtime through a <code>pg</code> connection
          pool (<code>lib/db.ts</code>) as a role that bypasses row-level security. It does not use the
          Supabase JS client.
        </li>
        <li>
          <strong>Anthropic SDK</strong> for the Claude calls, plus open-weight models hosted on
          OpenRouter (Qwen, GLM, and DeepSeek flash-class models today), reached through one
          OpenAI-compatible client (<code>lib/scan/llm.ts</code>), directly or via the{' '}
          <code>lib/model-route.ts</code> dispatcher. Every model call and every Tavily search call is metered in{' '}
          <code>ai_cost_log</code>.
        </li>
        <li>
          <strong>Tavily</strong> for the collection engines’ model-free news search, beside RSS feeds
          and primary sources (SEC EDGAR, FDIC, CFPB, arXiv, Semantic Scholar, GitHub, Hacker News).
          Jina Reader is the fetch fallback for hosts that block a direct fetch.
        </li>
        <li>
          <strong>unpdf</strong> for PDF text extraction: in the browser on the add-source form, and
          on the server in the discovery pipeline’s fetch layer. The extracted text is stored; the
          file itself is never stored.
        </li>
      </ul>
    ),
  },
  {
    id: 'data-model',
    heading: 'The data model',
    body: (
      <>
        <p>Seventy-three tables as of migration 0059, in groups:</p>
        <ul>
          <li><strong>The map</strong>: <code>questions</code>, <code>stances</code>, <code>claims</code>, <code>bridge_claims</code> as nodes; <code>edges</code> as the typed argument graph; <code>sources</code> and <code>evidence</code> for findings, each finding carrying at least one provenance (a hand-added source or a published signal).</li>
          <li><strong>The Signal Board</strong>: <code>signals</code> plus the discovery pipeline’s staging pair <code>pipeline_runs</code> / <code>signal_candidates</code> (also the run’s resumable checkpoint state) and <code>discovery_queries</code>, the learning loop’s search log.</li>
          <li><strong>Concepts</strong>: <code>concepts</code>, <code>concept_edges</code> (kept acyclic), <code>concept_claims</code>.</li>
          <li><strong>Research</strong>: a nine-table arXiv subsystem (papers, runs, threads, revisions, links, and two prefs singletons for the engine and its queue agent) staged through pull, triage, agent, analyze, and synthesis.</li>
          <li><strong>Startup Scout</strong>: <code>companies</code> (library and funnel state on one row), <code>scout_verticals</code> (the vertical registry, discovery query templates included), <code>company_events</code>, <code>company_documents</code> (retained text of uploaded documents; the file is never stored), <code>scout_runs</code>, <code>scout_prefs</code> (the editable acquisition rubric and steering note).</li>
          <li><strong>Collection engines</strong>: <code>scan_topics</code>, <code>scan_runs</code>, <code>scan_items</code> (the news scan); <code>intel_companies</code>, <code>intel_runs</code>, <code>intel_items</code>, <code>intel_facts</code>, <code>intel_metrics</code> (company intel and its metrics warehouse); <code>tooling_categories</code>, <code>tooling_runs</code>, <code>tooling_products</code>, <code>tooling_events</code> (the Tooling Monitor); <code>source_tiers</code> (the model-rated long tail of the source-reliability map). Each engine’s day-keyed run row is its resumable checkpoint.</li>
          <li><strong>Reports</strong>: <code>reports</code> (period reports, public on save), <code>generated_reports</code> (tear sheets, briefings, the daily edition, research roundups, and tooling reports; content is never edited after generation, visibility rides an <code>is_published</code> gate the admin can flip or the row can be deleted: the edition, the Friday roundup, and the Monday tooling entrants report publish on schedule, the rest by hand), <code>theses</code> and <code>thesis_reports</code>.</li>
          <li><strong>The Atlas Agent</strong>: <code>agent_findings</code>, <code>agent_actions</code>, <code>agent_briefs</code>, <code>agent_prefs</code>: the resident operator’s sensors, its logged remedies, and its daily brief.</li>
          <li><strong>Costs</strong>: <code>ai_rate_cards</code> and <code>ai_cost_log</code> price and record every model call (Anthropic and OpenRouter) and every Tavily search, rate frozen at call time.</li>
          <li><strong>The personal layer</strong>: <code>rationales</code> (append-only confidence-move log), <code>snapshots</code> (full confidence freezes), <code>positions_crosscutting</code> + <code>position_components</code>, <code>question_summaries</code>.</li>
          <li><strong>Support</strong>: <code>content_blocks</code> (copy overrides), <code>tickets</code> + <code>ticket_images</code> (the feedback box), full-text search columns over the retained article text, papers, and threads.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'constraints',
    heading: 'Load-bearing constraints',
    body: (
      <ul>
        <li><code>claims_test_required</code> and <code>claims_domain_required</code>: a claim must carry a test and a domain unless it is a frame (<code>is_frame = true</code>). Frames organize other claims but cannot accrue evidence.</li>
        <li><code>bridge_claims</code> is its own table (<code>domain_from</code>, <code>domain_to</code>, own test and confidence), not an edge. Cross-domain links are first-class.</li>
        <li><code>confidence</code> is <code>numeric(3,2)</code> from 0 to 1, with a generated <code>confidence_label</code> via <code>conf_label()</code>: <code>thin</code> below 0.40, <code>contested</code> below 0.60, <code>leaning</code> below 0.80, else <code>settled</code>.</li>
        <li><code>reliability_prior</code> on a source is an integer from 0 to 100, set by the maintainer only.</li>
        <li><code>evidence</code> must carry at least one provenance: a <code>source_id</code>, a <code>signal_id</code>, or both. A finding that came from a signal dies with that signal.</li>
        <li><code>concept_edges</code> rejects self-loops, and the writer walks the graph inside the transaction to reject cycles, so the prerequisite graph stays a DAG.</li>
        <li>RLS is on for every table with no public policies, so it is deny-by-default. The service role bypasses it, so all access is server-mediated.</li>
      </ul>
    ),
  },
  {
    id: 'file-map',
    heading: 'File and module map',
    body: (
      <ul>
        <li><code>app/</code> holds the routes. Public: the lobby, <code>blotter</code>, <code>map</code>, <code>q/[slug]</code>, <code>claim/[code]</code>, <code>bridge/[code]</code>, <code>bridges</code>, <code>concepts</code>, <code>signals</code>, <code>ask</code>, <code>research</code>, <code>scout</code>, <code>tooling</code>, <code>education</code>, <code>datasets</code>, <code>traceroute</code>, <code>reports</code>, <code>thesis-report/[id]</code>, and <code>about</code>. Admin-only: <code>sources</code>, <code>ingest</code>, <code>source/[id]</code>, <code>pipeline</code>, <code>scan</code>, <code>intel</code>, <code>theses</code>, <code>research/console</code>, <code>scout/console</code>, <code>tooling/console</code>, <code>agent</code>, <code>worldview</code>, <code>data</code>, <code>calibration</code>, <code>costs</code>, <code>tickets</code>, and <code>reports/period</code>. The cron entry points live under <code>app/api/cron/</code> and accept only a bearer secret.</li>
        <li><code>lib/</code> holds <code>db.ts</code> (the pool, which throws in the browser), <code>auth.ts</code> (the admin and portal gates), <code>data/</code> (reads plus the personal-layer strip), <code>actions/</code> and <code>mutations/</code> (the single writer), <code>dossier.ts</code> (the shared AI call) and <code>model-route.ts</code> (the Anthropic-or-OpenRouter dispatcher), <code>citations.ts</code> (the citation gate), <code>ask/</code>, <code>pipeline/</code>, <code>scan/</code>, <code>intel/</code>, <code>research/</code>, <code>scout/</code>, <code>tooling/</code>, <code>edition/</code>, <code>agent/</code>, <code>tearsheet/</code> and <code>thesis/</code>, <code>pdf/</code>, <code>datasets/</code> (the export registry), and <code>cost.ts</code> (the call meter).</li>
        <li><code>components/</code> holds the React components for the map, cards, editors, and forms.</li>
        <li><code>app/styles/</code> holds the Console design system (tokens, then base, then components).</li>
      </ul>
    ),
  },
  {
    id: 'ai-layer',
    heading: 'The AI layer is recommend-only on the map',
    body: 'Most AI features route through one seam, runStructured in lib/dossier.ts: a single forced-tool call returning validated JSON, sent to Claude directly or, through lib/model-route.ts, to an open-weight model on OpenRouter. It powers the dossiers, the recommendations, the gap diagnoses, the summaries, the scoring agents, the engines’ enrichment, and every report narrative. On the argument map the model proposes and never commits: it never sets a reliability prior, never moves a confidence, and writes evidence only through a publish. Two scheduled steps sit outside that hand gate. The promotion policy publishes a high-significance pipeline draft that touches a claim after a 48-hour window in which a human can archive it, and that publish writes evidence rows like any other. The Tooling Monitor moves a product from candidate to cataloged when its score clears a threshold; it never demotes. The live web reaches the system in two ways: the collection engines’ search legs (mostly Tavily, beside RSS feeds and primary sources), and Anthropic’s web_search in Scout’s discovery, competitor scan, and intel sweeps, the tooling deep dives and big-pull category enumeration, and the Ask workspace’s web toggle (admin and keyed users, budget-metered per search), which lets an answer fill gaps the records leave, with the records kept primary and the web sources listed under the answer; the collection engines fall back to web_search only when their model-free providers are not configured. Every call is priced against a rate card and logged; the costs page is the meter.',
  },
  {
    id: 'public-private',
    heading: 'Public and private layers',
    body: 'The server decides what is public. The readers in lib/data/ strip the personal fields (confidences, rationales, source priors, review notes, the scout’s verdicts) before anything leaves the server for a guest; guest mode IS the share view. The authorization boundary is isAdmin() in lib/auth.ts, a signed HMAC cookie; a second signed cookie, unlocked by an access key (per-person keys issued by the maintainer on request, with a legacy shared key kept during the migration), grants the portal tier: Ask, the key-gated datasets (retained article text, machine-extracted records including unreviewed items, agent scores, dossier fields), the retained-text reader beside an answer, the tooling reports and their drafts, and Scout’s research tools and document upload. proxy.ts is open by default: every page renders sessionless and gates itself, so a visitor gets the guest view instead of a login wall, and the proxy fences only API routes outside a short allow-list. RLS is deny-by-default underneath.',
  },
  {
    id: 'human-gate',
    heading: 'The human gate',
    body: 'A confidence never moves on its own. moveConfidence runs one transaction: read the old value, write the new one, insert a required rationale, snapshot every confidence. Publishing a signal is a second gate of the same kind: the pipeline creates drafts, and the publish action, whether a human’s or the promotion policy’s after its 48-hour veto window, is what materializes evidence rows (unpublishing removes them). The scout’s track and dismiss decisions and concept links follow the hand rule: the model recommends, the maintainer commits, and tracking anything requires a written why. Reports split: period reports are public on save, tear sheets and briefings publish by hand, and the daily edition, the Friday research roundup, and the Monday tooling entrants report publish on schedule.',
  },
  {
    id: 'deploy',
    heading: 'Deploy and connection',
    body: `Vercel against Supabase Postgres, connected through the IPv4 pooler (the direct host is IPv6-only and unreachable from serverless), with the pool held to one connection per instance in production (DB_POOL_MAX=1; the code default is three). AUTH_SECRET must be at least 32 characters or every session check throws (the gate fails closed rather than falling back to a public secret). Routes hosting AI calls declare a 60 second budget (120 on the two tooling pages that run a 90 second Sonnet leg) and keep each unit of work short (resumable, cheaply retried); deep research uses a measured 300 second budget; the engine cron routes declare 800 seconds and stop new work at 700. ${numberWord(CRON_COUNT)} cron entries in vercel.json drive the engines on weekdays, the tooling scan on Mondays, and the Atlas Agent hourly.`,
  },
];

export default async function ArchitecturePage() {
  const [admin, { editing, txt }] = await Promise.all([isAdmin(), getEditContext()]);
  return (
    <>
      <PageTop
        pathname="/about/architecture"
        label="Architecture"
        viewer={{ admin, portal: admin }}
        title={
          <Editable
            as="h1"
            k="about.architecture.title"
            value={txt('about.architecture.title', 'Architecture')}
            editing={editing}
          />
        }
      />
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.architecture" txt={txt} />
    </>
  );
}
