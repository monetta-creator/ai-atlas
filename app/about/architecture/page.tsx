import Prose from '@/components/Prose';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Architecture · The Strategy Atlas' };

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
          <strong>Postgres 15+</strong>, reached at runtime through a <code>pg</code> connection
          pool (<code>lib/db.ts</code>) over one <code>DATABASE_URL</code>. Fonts are vendored;
          the build and runtime need no outbound network beyond the optional AI endpoint.
        </li>
        <li><strong>Anthropic SDK</strong> for the AI layer, pointed at any compatible endpoint via <code>ANTHROPIC_BASE_URL</code>.</li>
        <li>
          <strong>unpdf</strong> for PDF text extraction in the browser on the add-source form.
          The text is read, the file is never stored.
        </li>
      </ul>
    ),
  },
  {
    id: 'data-model',
    heading: 'The data model',
    body: (
      <>
        <p>The tables, in groups:</p>
        <ul>
          <li><strong>The board</strong>: <code>hypotheses</code> (statement, required test, gated conviction), <code>hypothesis_links</code> (promote-and-link relations), <code>sources</code> and <code>evidence</code> for findings, each finding carrying at least one provenance (a hand-added source or a published signal) plus a per-link confidence weight.</li>
          <li><strong>The Signal Board</strong>: <code>signals</code> (context, touches, publish gate) plus the intake staging pair <code>pipeline_runs</code> / <code>signal_candidates</code> (also the run&rsquo;s resumable checkpoint state).</li>
          <li><strong>Concepts</strong>: <code>concepts</code>, <code>concept_edges</code> (kept acyclic), <code>concept_links</code>.</li>
          <li><strong>Research</strong>: the paper library (papers, threads, revisions, links) staged through review and synthesis.</li>
          <li><strong>Reports</strong>: <code>reports</code> (period reports) and <code>hypothesis_reports</code> (frozen per-hypothesis runs).</li>
          <li><strong>Costs</strong>: <code>ai_rate_cards</code> and <code>ai_cost_log</code> price and record every AI call, rate frozen at call time.</li>
          <li><strong>The personal layer</strong>: <code>rationales</code> (append-only conviction-move log) and <code>snapshots</code> (full conviction freezes).</li>
          <li><strong>Support</strong>: <code>content_blocks</code> (copy overrides), <code>tickets</code> + <code>ticket_images</code> (the feedback box), full-text search columns over the retained text, papers, and threads.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'constraints',
    heading: 'Load-bearing constraints',
    body: (
      <ul>
        <li>A hypothesis cannot exist without a <code>test</code>: the falsifiability contract is schema-enforced.</li>
        <li><code>conviction</code> is <code>numeric(3,2)</code> from 0 to 1, with a generated <code>conviction_label</code> via <code>conf_label()</code>: <code>thin</code> below 0.40, <code>contested</code> below 0.60, <code>leaning</code> below 0.80, else <code>settled</code>.</li>
        <li><code>reliability_prior</code> on a source is an integer from 0 to 100, set by the operator only.</li>
        <li><code>evidence</code> must carry at least one provenance: a <code>source_id</code>, a <code>signal_id</code>, or both. A finding that came from a signal dies with that signal.</li>
        <li><code>concept_edges</code> rejects self-loops, and the writer walks the graph inside the transaction to reject cycles, so the prerequisite graph stays a DAG.</li>
        <li>RLS is on for every table with no public policies, so it is deny-by-default. The app role bypasses it, so all access is server-mediated.</li>
      </ul>
    ),
  },
  {
    id: 'file-map',
    heading: 'File and module map',
    body: (
      <ul>
        <li><code>app/</code> holds the routes. Public: the lobby, <code>blotter</code>, <code>map</code>, <code>hypothesis/[code]</code>, <code>hypothesis-report/[id]</code>, <code>concepts</code>, <code>signals</code>, <code>ask</code>, <code>research</code>, <code>datasets</code>, and <code>reports</code>. Operator-only: <code>sources</code>, <code>ingest</code>, <code>source/[id]</code>, <code>pipeline</code>, <code>research/console</code>, <code>calibration</code>, <code>costs</code>, <code>tickets</code>, and <code>reports/period</code>.</li>
        <li><code>lib/</code> holds <code>db.ts</code> (the pool, which throws in the browser), <code>auth.ts</code> (the admin and portal gates), <code>ai.ts</code> (the one Anthropic client factory), <code>data/</code> (reads plus the personal-layer strip), <code>actions/</code> and <code>mutations/</code> (the single writer), <code>dossier.ts</code> (the shared AI call), <code>hypothesis/</code> (packs, citations, generation), <code>ask/</code>, <code>pipeline/</code>, <code>research/</code>, <code>datasets/</code>, <code>pdf/</code>, and <code>cost.ts</code> (the call meter).</li>
        <li><code>components/</code> holds the React components for the board, cards, editors, and forms.</li>
        <li><code>app/styles/</code> holds the Console design system (tokens, then base, then components).</li>
      </ul>
    ),
  },
  {
    id: 'ai-layer',
    heading: 'The AI layer is recommend-only',
    body: 'Nearly every AI feature routes through one seam, runStructured in lib/dossier.ts: a single forced-tool call returning validated JSON. It powers the dossiers, the recommendations, the gap diagnoses, and every report narrative. The model proposes and never commits: it never writes evidence, never sets a reliability prior, never moves a conviction, never changes a funnel status. There is no web search anywhere; every call reads only the text the operator put on the record. Every call is priced against a rate card and logged; the costs page is the meter.',
  },
  {
    id: 'public-private',
    heading: 'Public and private layers',
    body: 'The server decides what is public. The data layer strips the personal fields (convictions, rationales, source priors, review notes) before anything leaves the server for a guest; guest mode IS the share view. The authorization boundary is isAdmin() in lib/auth.ts, a signed HMAC cookie; a second signed cookie, unlocked by a shared team key, grants the portal tier (the billable Ask features and the retained-text reader, nothing else). proxy.ts does cookie-presence routing only, with the whole reader surface on a public allow-list, so a sessionless visitor gets the guest view instead of a login wall. RLS is deny-by-default underneath.',
  },
  {
    id: 'human-gate',
    heading: 'The human gate',
    body: 'A conviction never moves on its own. moveConviction runs one transaction: read the old value, write the new one, insert a required rationale, snapshot every conviction. Publishing a signal is a second gate of the same kind: intake only ever creates drafts, and the publish action is what materializes evidence rows (unpublishing removes them). Paper tracking, concept links, and report publishing all follow the same rule: the model recommends, the operator commits, and tracking anything requires a written why.',
  },
  {
    id: 'deploy',
    heading: 'Deploy and connection',
    body: 'A plain Node server against any Postgres 15+, connected over one DATABASE_URL (TLS only when the URL asks for it). AUTH_SECRET must be at least 32 characters or the app refuses to start. The AI endpoint is optional and configurable (ANTHROPIC_BASE_URL for a gateway); without a key, every AI affordance reports itself unconfigured and the rest of the tool works.',
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
