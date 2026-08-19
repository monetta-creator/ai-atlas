import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Architecture · The AI Atlas' };

const SECTIONS = [
  {
    id: 'stack',
    heading: 'Stack',
    body: (
      <ul>
        <li>
          <strong>Next.js 16.2.6</strong> (App Router, Turbopack). The login gate lives in{' '}
          <code>proxy.ts</code> (this version uses <code>proxy</code>, not a <code>middleware.ts</code>).
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
        <li><strong>Anthropic SDK</strong> for the AI layer.</li>
        <li>
          <strong>unpdf</strong> for PDF text extraction: in the browser on the add-source form, and
          on the server in the discovery pipeline’s fetch layer. The text is read, the file is never
          stored.
        </li>
      </ul>
    ),
  },
  {
    id: 'data-model',
    heading: 'The data model',
    body: (
      <>
        <p>Forty-eight tables, in groups:</p>
        <ul>
          <li><strong>The map</strong>: <code>questions</code>, <code>stances</code>, <code>claims</code>, <code>bridge_claims</code> as nodes; <code>edges</code> as the typed argument graph; <code>sources</code> and <code>evidence</code> for findings, each finding carrying at least one provenance (a hand-added source or a published signal).</li>
          <li><strong>The Signal Board</strong>: <code>signals</code> plus the discovery pipeline’s staging pair <code>pipeline_runs</code> / <code>signal_candidates</code> (also the run’s resumable checkpoint state) and <code>discovery_queries</code>, the learning loop’s search log.</li>
          <li><strong>Concepts</strong>: <code>concepts</code>, <code>concept_edges</code> (kept acyclic), <code>concept_claims</code>.</li>
          <li><strong>Research</strong>: a seven-table arXiv subsystem (papers, runs, threads, revisions, links) staged through pull, triage, review, and synthesis.</li>
          <li><strong>Startup Scout</strong>: <code>companies</code> (library and funnel state on one row), <code>scout_verticals</code> (the vertical registry, discovery query templates included), <code>company_events</code>, <code>scout_runs</code>, <code>scout_prefs</code> (the editable acquisition rubric and steering note).</li>
          <li><strong>Reports</strong>: <code>reports</code> (period reports), <code>generated_reports</code> (tear sheets and briefings, insert-only, human-published), <code>theses</code> and <code>thesis_reports</code>.</li>
          <li><strong>Costs</strong>: <code>ai_rate_cards</code> and <code>ai_cost_log</code> price and record every Anthropic call, rate frozen at call time.</li>
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
        <li><code>reliability_prior</code> on a source is an integer from 0 to 100, set by the author only.</li>
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
        <li><code>app/</code> holds the routes. Public: the lobby, <code>blotter</code>, <code>map</code>, <code>q/[slug]</code>, <code>claim/[code]</code>, <code>bridge/[code]</code>, <code>bridges</code>, <code>concepts</code>, <code>signals</code>, <code>ask</code>, <code>research</code>, <code>scout</code>, <code>datasets</code>, <code>traceroute</code>, <code>reports</code>, and <code>thesis-report/[id]</code>. Author-only: <code>sources</code>, <code>ingest</code>, <code>source/[id]</code>, <code>pipeline</code>, <code>theses</code>, <code>research/console</code>, <code>scout/console</code>, <code>worldview</code>, <code>data</code>, <code>calibration</code>, <code>costs</code>, <code>tickets</code>, and <code>reports/period</code>.</li>
        <li><code>lib/</code> holds <code>db.ts</code> (the pool, which throws in the browser), <code>auth.ts</code> (the admin and portal gates), <code>data.ts</code> (reads plus the personal-layer strip), <code>actions.ts</code> and <code>mutations.ts</code> (the single writer), <code>dossier.ts</code> (the shared AI call), <code>citations.ts</code> (the citation gate), <code>ask/</code>, <code>pipeline/</code>, <code>research/</code>, <code>scout/</code>, <code>tearsheet/</code> and <code>thesis/</code>, <code>pdf/</code>, and <code>cost.ts</code> (the call meter).</li>
        <li><code>components/</code> holds the React components for the map, cards, editors, and forms.</li>
        <li><code>app/styles/</code> holds the Console design system (tokens, then base, then components).</li>
      </ul>
    ),
  },
  {
    id: 'ai-layer',
    heading: 'The AI layer is recommend-only',
    body: 'Nearly every AI feature routes through one seam, runStructured in lib/dossier.ts: a single forced-tool Anthropic call returning validated JSON. It powers the dossiers, the recommendations, the gap diagnoses, the summaries, the scout’s scoring agent, and every report narrative. The model proposes and never commits: it never writes evidence, never sets a reliability prior, never moves a confidence, never changes a funnel status. Web search exists in exactly three places. The Signal Board’s discovery pipeline and the scout’s company discovery search the web only to surface drafts for review. The Ask workspace’s web toggle (author and keyed users, budget-metered per search) lets an answer fill gaps the records leave, with the records kept primary and the web sources listed under the answer. Every call is priced against a rate card and logged; the costs page is the meter.',
  },
  {
    id: 'public-private',
    heading: 'Public and private layers',
    body: 'The server decides what is public. lib/data.ts strips the personal fields (confidences, rationales, source priors, review notes, the scout’s verdicts) before anything leaves the server for a guest; guest mode IS the share view. The authorization boundary is isAdmin() in lib/auth.ts, a signed HMAC cookie; a second signed cookie, unlocked by a shared team key, grants the portal tier (the billable Ask features and the retained-text reader, nothing else). proxy.ts does cookie-presence routing only, with the whole reader surface on a public allow-list, so a sessionless visitor gets the guest view instead of a login wall. RLS is deny-by-default underneath.',
  },
  {
    id: 'human-gate',
    heading: 'The human gate',
    body: 'A confidence never moves on its own. moveConfidence runs one transaction: read the old value, write the new one, insert a required rationale, snapshot every confidence. Publishing a signal is a second gate of the same kind: the pipelines only ever create drafts, and the publish action is what materializes evidence rows (unpublishing removes them). The scout’s track and dismiss decisions, concept links, and report publishing all follow the same rule: the model recommends, the author commits, and tracking anything requires a written why.',
  },
  {
    id: 'deploy',
    heading: 'Deploy and connection',
    body: 'Vercel against Supabase Postgres, connected through the IPv4 pooler (the direct host is IPv6-only and unreachable from serverless), one connection per instance. AUTH_SECRET must be at least 32 characters or the app refuses to start. Routes hosting AI calls declare a 60 second budget and keep each unit of work short (resumable, cheaply retried); deep research uses a measured 300 second budget.',
  },
];

export default async function ArchitecturePage() {
  const { editing, txt } = await getEditContext();
  return (
    <>
      <header className="pagehead" style={{ paddingBottom: 16 }}>
        <Editable
          as="h1"
          k="about.architecture.title"
          value={txt('about.architecture.title', 'Architecture')}
          editing={editing}
        />
      </header>
      <Prose sections={SECTIONS} editing={editing} keyPrefix="about.architecture" txt={txt} />
    </>
  );
}
