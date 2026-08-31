// Spec 04: where MCP fits. Server component, static SVG + prose.

export default function McpSection() {
  return (
    <section id="mcp" className="edu-section">
      <div className="edu-eyebrow">Spec 04</div>
      <h2>Where MCP fits</h2>
      <p className="edu-lede">
        MCP is the protocol running inside the <a className="edu-specref" href="#loop">Tool call box from Spec 02</a>, the
        mechanism that lets a harness reach the <a className="edu-specref" href="#spectrum">Read-only and Read-write columns from Spec 01</a>, and
        it now runs across all three interface tiers from <a className="edu-specref" href="#landscape">Spec 03</a>.
      </p>

      <div className="edu-mcp">
        <div className="edu-mcp-svg">
          <svg
            width="100%"
            viewBox="0 0 560 220"
            role="img"
            aria-label="Diagram showing the Tool call box from the loop diagram connecting through an MCP client to two kinds of MCP servers, read-only and read-write, mapping directly to the two right-hand columns of the Spec 01 grid"
          >
            <defs>
              <marker id="edu-a4" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="var(--edu-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            <rect x={10} y={15} width={270} height={190} rx={4} fill="none" stroke="var(--ink-faint)" strokeWidth={1} />
            <text className="edu-th" x={26} y={37}>Harness</text>
            <text className="edu-ts" x={26} y={52}>runs the loop from Spec 02</text>

            <rect x={26} y={75} width={110} height={70} rx={2} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" strokeWidth={1} />
            <text className="edu-th" x={81} y={103} textAnchor="middle">Tool call</text>
            <text className="edu-ts" x={81} y={120} textAnchor="middle">model requests a tool</text>

            <rect x={152} y={75} width={110} height={70} rx={2} fill="var(--edu-amber-soft)" stroke="var(--edu-amber)" strokeWidth={1} />
            <text className="edu-th" x={207} y={103} textAnchor="middle">MCP client</text>
            <text className="edu-ts" x={207} y={120} textAnchor="middle">translates the request</text>

            <line x1={136} y1={110} x2={150} y2={110} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-a4)" />

            <line x1={262} y1={97} x2={336} y2={55} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-a4)" />
            <line x1={262} y1={128} x2={336} y2={163} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-a4)" />
            <text className="edu-ts" x={300} y={65} textAnchor="middle">reads</text>
            <text className="edu-ts" x={300} y={155} textAnchor="middle">writes</text>

            <rect x={338} y={20} width={200} height={65} rx={2} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" strokeWidth={1} />
            <text className="edu-th" x={438} y={42} textAnchor="middle">Read-only MCP tools</text>
            <text className="edu-ts" x={438} y={60} textAnchor="middle">search, fetch, list</text>

            <rect x={338} y={128} width={200} height={65} rx={2} fill="var(--edu-purple-soft)" stroke="var(--edu-purple)" strokeWidth={1} />
            <text className="edu-th" x={438} y={150} textAnchor="middle">Read-write MCP tools</text>
            <text className="edu-ts" x={438} y={168} textAnchor="middle">create, deploy, send</text>
          </svg>
        </div>
        <div className="edu-mcp-text">
          <p>
            Before MCP, every harness had to hand-build its own connection to every external
            service: a custom Slack integration here, a custom GitHub integration there. MCP
            standardizes that connection into one protocol, and it&apos;s the mechanism behind the <a className="edu-specref" href="#loop">tool execution and permissions bullets in Spec 02</a>:
            the harness still decides whether a call needs your sign-off, and MCP is what makes the
            call itself possible in the first place.
          </p>
          <p>
            A server exposes what it can do (a Slack workspace, a codebase, a database) in a shared
            format. Whether a given MCP tool lands in the read-only or read-write column from Spec
            01 depends entirely on the server. MCP standardizes how a tool is discovered and
            called; the server decides how risky that tool is to run.
          </p>
          <p>
            Adoption now spans all three tiers from Spec 03: Claude Code and opencode (CLI), Cline
            and Cursor (IDE), and GitHub&apos;s Copilot cloud agent and Jules (cloud) all support MCP
            servers. The tiers differ in trust model. Local harnesses accept any server you
            configure; cloud platforms curate, and Jules exposes MCP through a vetted partner
            program.
          </p>
          <p className="edu-mcp-foot">
            Two related standards sit beside MCP. ACP (Agent Client Protocol) standardizes how
            editors host coding agents: Devin Desktop, JetBrains, and VS Code implement it, so
            Claude Code, Codex, or opencode can run inside another vendor&apos;s editor. A2A lets agents
            negotiate directly with each other; CrewAI has implemented it for peer-to-peer
            coordination without a central orchestrator.
          </p>
        </div>
      </div>
    </section>
  );
}
