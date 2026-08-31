// Spec 03: the three interface tiers and the product table. Server component;
// the expandable tier cards are native <details>, no JS.

const PRODUCT_ROWS: { name: string; company: string; surface: string; license: string; note: string; highlight?: boolean; offaxis?: boolean }[] = [
  { name: 'Claude Code', company: 'Anthropic', surface: 'CLI', license: 'Proprietary', note: 'Also ships as IDE extensions and a desktop app' },
  { name: 'Codex CLI', company: 'OpenAI', surface: 'CLI', license: 'Open source', note: 'Sandbox ships with network access off by default' },
  { name: 'Aider', company: 'Independent', surface: 'CLI', license: 'Open source', note: 'Git-native, auto-commits' },
  { name: 'opencode', company: 'anomalyco', surface: 'CLI', license: 'Open source', note: 'Roughly 200k GitHub stars; also ships a desktop app and IDE extension' },
  { name: 'Antigravity CLI', company: 'Google', surface: 'CLI', license: 'Closed source', note: 'Replaced Gemini CLI for consumer tiers, June 2026' },
  { name: 'GitHub Copilot CLI', company: 'Microsoft (GitHub)', surface: 'CLI', license: 'Proprietary', note: 'Autopilot mode runs a task to completion without per-step approval' },
  { name: 'Cursor', company: 'SpaceX (SpaceXAI)', surface: 'IDE', license: 'Proprietary', note: 'Acquired from Anysphere for $60B; closed Aug 14, 2026' },
  { name: 'GitHub Copilot', company: 'Microsoft (GitHub)', surface: 'IDE', license: 'Proprietary', note: 'Agent mode in VS Code, JetBrains' },
  { name: 'Cline', company: 'Independent', surface: 'IDE', license: 'Open source', note: '' },
  { name: 'Devin Desktop', company: 'Cognition', surface: 'IDE', license: 'Proprietary', note: 'Formerly Windsurf; rebranded June 2, 2026. Hosts third-party agents via ACP' },
  { name: 'Devin', company: 'Cognition', surface: 'Cloud / async', license: 'Proprietary', note: 'Billed in Agent Compute Units', highlight: true },
  { name: 'Jules', company: 'Google', surface: 'Cloud / async', license: 'Proprietary', note: 'Scheduled, self-triggered runs since Dec 2025; GA May 2026', highlight: true },
  { name: 'GitHub Copilot cloud agent', company: 'Microsoft (GitHub)', surface: 'Cloud / async', license: 'Proprietary', note: 'Automations run on a schedule or repository event (June 2026)', highlight: true },
  { name: 'OpenHands', company: 'All Hands AI', surface: 'Cloud / async', license: 'Open-core', note: 'Also fully self-hostable', highlight: true },
  { name: 'Manus', company: 'Butterfly Effect', surface: 'Cloud / async', license: 'Proprietary', note: "Meta's Dec 2025 acquisition was ordered unwound by China's NDRC in Apr 2026; independent again as of Aug 2026. General-purpose agent", highlight: true },
  { name: 'LangGraph', company: 'LangChain', surface: '–', license: 'Open source', note: 'A library with no default interface', offaxis: true },
  { name: 'OpenHands SDK', company: 'All Hands AI', surface: '–', license: 'Open source', note: 'A library with no default interface', offaxis: true },
  { name: 'CrewAI', company: 'CrewAI Inc.', surface: '–', license: 'Open source', note: 'A library with no default interface', offaxis: true },
];

export default function LandscapeSection() {
  return (
    <section id="landscape" className="edu-section">
      <div className="edu-eyebrow">Spec 03</div>
      <h2>Three ways the market has built it</h2>
      <p className="edu-lede">
        The three cards below are MECE on interface surface: every surface a harness ships sits in
        exactly one. Products often ship several surfaces (Claude Code runs as a CLI, an IDE
        extension, and a desktop app), so the table further down lists each product&apos;s primary
        surface and puts the others in the note column. License and company are separate columns,
        because &ldquo;who made it&rdquo; and &ldquo;where it runs&rdquo; are independent questions.
      </p>

      <div className="edu-catgrid">
        <details className="edu-cat" open>
          <summary>
            <div>
              <span className="edu-cat-tag">01 · LOCAL, IN YOUR SHELL</span>
              <h3>CLI / terminal harnesses</h3>
            </div>
            <span className="edu-cat-chev">+</span>
          </summary>
          <div className="edu-cat-body">
            <p>
              Runs as a process in your terminal with direct read/write access to your actual files
              and shell. The model gets tool definitions for file editing and command execution; the
              harness code parses each request and runs it against your real working directory.
            </p>
            <div className="edu-chips">
              <span className="edu-chip">Claude Code</span>
              <span className="edu-chip">Codex CLI</span>
              <span className="edu-chip">Aider</span>
              <span className="edu-chip">opencode</span>
              <span className="edu-chip">GitHub Copilot CLI</span>
            </div>
            <div className="edu-stat">
              This tier turns over fast. Google cut off Gemini CLI for free, Pro, and Ultra users on
              June 18, 2026 and steered them to a closed-source Go successor, Antigravity CLI;
              enterprise Code Assist licenses and paid API keys keep the open-source CLI running.
              opencode, meanwhile, has crossed roughly 200,000 GitHub stars.
            </div>
          </div>
        </details>

        <details className="edu-cat">
          <summary>
            <div>
              <span className="edu-cat-tag">02 · LOCAL, INSIDE AN EDITOR</span>
              <h3>IDE-integrated agents</h3>
            </div>
            <span className="edu-cat-chev">+</span>
          </summary>
          <div className="edu-cat-body">
            <p>
              Lives inside the editor and leans on deep codebase indexing; it needs to know your
              whole project, beyond the file you have open, to suggest well.
            </p>
            <div className="edu-chips">
              <span className="edu-chip">Cursor</span>
              <span className="edu-chip">GitHub Copilot</span>
              <span className="edu-chip">Cline</span>
              <span className="edu-chip">Devin Desktop</span>
            </div>
            <div className="edu-stat">
              Ownership shifted hard in 2026. SpaceX completed a $60 billion all-stock acquisition
              of Cursor&apos;s maker, Anysphere, on August 14, folding it into its SpaceXAI unit.
              Cognition rebranded its Windsurf editor as &ldquo;Devin Desktop&rdquo; on June 2.
            </div>
          </div>
        </details>

        <details className="edu-cat">
          <summary>
            <div>
              <span className="edu-cat-tag">03 · REMOTE, HANDS-OFF</span>
              <h3>Cloud / async platforms</h3>
            </div>
            <span className="edu-cat-chev">+</span>
          </summary>
          <div className="edu-cat-body">
            <p>
              Runs the whole loop on a remote sandboxed machine, decoupled from your laptop. You
              hand off a task and it plans, executes, tests, and opens a pull request for review;
              or, for some products, starts on its own from a schedule or an event.
            </p>
            <div className="edu-chips">
              <span className="edu-chip">Devin</span>
              <span className="edu-chip">Jules</span>
              <span className="edu-chip">GitHub Copilot cloud agent</span>
              <span className="edu-chip">OpenHands</span>
              <span className="edu-chip">Manus</span>
            </div>
            <div className="edu-stat">
              Devin is dispatched: you message it via Slack, Jira, or Linear. Jules (scheduled
              tasks, since December 2025) and GitHub&apos;s Copilot cloud agent (Automations, since June
              2026) go a step further, running on a schedule or a repository event with no human
              kicking off that run: the <a className="edu-specref" href="#spectrum">triggered row from Spec 01</a>, in production.
            </div>
            <div className="edu-stat edu-stat--neutral">
              Outside this table: Claude Cowork runs on the same remote-sandbox model, in an
              isolated environment on Anthropic&apos;s servers, and supports the same scheduled,
              no-human-kickoff mode as Jules. It is excluded because its scope is general knowledge
              work; the same boundary keeps &ldquo;chatbot&rdquo; out of this landscape in Spec 01.
            </div>
          </div>
        </details>
      </div>

      <div className="edu-tablewrap" style={{ marginTop: 24 }}>
        <table className="edu-table edu-table--auto">
          <tbody>
            <tr className="edu-tier-offaxis">
              <td className="edu-tier-name">
                <span className="edu-dot edu-dot--hollow" />
                Frameworks &amp; SDKs
              </td>
              <td colSpan={4}>
                A layer underneath all three tiers. LangGraph, the OpenHands SDK, and CrewAI ship no
                default interface at all; you use one to build a CLI tool, an IDE plugin, or a cloud
                service yourself. Same relationship to this chart that <a className="edu-specref" href="#spectrum">Workflows have to the Spec 01 grid</a>: a
                different kind of thing from the tiers.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="edu-note">
        Four companies now sell into more than one row of the table below, which is why
        &ldquo;company&rdquo; and &ldquo;interface tier&rdquo; stay separate columns. Microsoft/GitHub is the clearest
        case: Copilot CLI, Copilot&apos;s IDE agent mode, and the Copilot cloud agent are three distinct
        products under one brand. Cognition sells Devin across four surfaces since June 2026: Devin
        Desktop (IDE), Devin Cloud, Devin CLI, and Devin Review. Google sells Antigravity CLI
        (terminal) and Jules (cloud) side by side. Anthropic ships Claude Code as a CLI, IDE
        extensions, and a desktop app. Each product row lists its primary surface.
      </p>

      <div className="edu-tablewrap">
        <table className="edu-table edu-table--products">
          <thead>
            <tr>
              <th>Product</th>
              <th>Company</th>
              <th>Primary surface</th>
              <th>License</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCT_ROWS.map((r) => (
              <tr
                key={r.name}
                className={r.highlight ? 'edu-tier-highlight' : r.offaxis ? 'edu-tier-offaxis' : undefined}
              >
                <td className="edu-tier-name">
                  {r.offaxis && <span className="edu-dot edu-dot--hollow" />}
                  {r.name}
                </td>
                <td>{r.company}</td>
                <td>{r.surface}</td>
                <td>{r.license}</td>
                <td>{r.note || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
