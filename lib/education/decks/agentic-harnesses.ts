import type { CostDeck, DeckSlide } from '@/lib/costs-deck';

// The Education hub's first guide deck: "Field guide to agentic harnesses",
// on the same slide model and both renderers as the cost deck (screen +
// PDF). Content is fixed editorial copy, not derived from live data, so this
// builder is synchronous and needs no DB read.

export function buildAgenticHarnessesDeck(): CostDeck {
  const generatedOn = 'August 30, 2026';

  const slides: DeckSlide[] = [
    {
      kind: 'title',
      kicker: 'EDUCATION · FIELD GUIDE',
      title: 'The model is the engine. The harness is the car.',
      subtitle:
        'Every AI coding agent on the market is the same handful of frontier models wrapped in different scaffolding. This deck covers what that scaffolding does, the three interfaces the market has built it into, and why the wrapper now matters more than the engine inside it.',
      bigStat: { n: '3', l: 'interface tiers on the market: CLI, IDE, and cloud. One loop underneath all of them.' },
      date: 'Current as of August 30, 2026',
    },
    {
      kind: 'table',
      kicker: 'SPEC 01 · WHERE HARNESS SITS',
      title: 'Six terms, two scales',
      heads: ['Term', 'What it is', 'Loops on its own?', 'Stops when'],
      rows: [
        ['Direct API call', 'One request, one response', 'No', 'The response is generated'],
        ['Chatbot', 'A back-and-forth conversation you drive turn by turn', 'No, you send each turn yourself', 'You stop sending messages'],
        ['Deep research', 'The model runs its own search-and-read loop for one request', 'Yes, but only within that one task', 'The report is compiled'],
        ['Agentic harness', 'The model runs an open-ended loop against a real environment', 'Yes, until the task is done or stopped', 'The task passes its checks, or a limit is hit'],
        ['Autonomous agent', 'A harness whose trigger, a schedule or an event, was authored once and then fires without a human', 'Yes, each run starts without you', 'The task passes its checks, or a limit is hit'],
        ['Workflow', 'Fixed code calls the model at specific steps; a human chose the path in advance', 'No, a human wrote the path', 'The predefined path finishes'],
      ],
      takeaway:
        'Plot the mode, never the product: the same chat interface moves cells the moment a connector is attached, and the same harness drops a row in plan mode.',
    },
    {
      kind: 'matrix',
      kicker: 'SPEC 01 · THE TWO SCALES',
      title: 'Who loops, who touches',
      cols: ['Runs its own loop', 'Touches real systems', 'Starts without a human'],
      rows: [
        { label: 'Direct API call', cells: ['no', 'no', 'no'] },
        { label: 'Chatbot', cells: ['no', 'partial', 'no'] },
        { label: 'Deep research', cells: ['yes', 'partial', 'no'] },
        { label: 'Agentic harness', cells: ['yes', 'yes', 'no'] },
        { label: 'Autonomous agent', cells: ['yes', 'yes', 'yes'] },
        { label: 'Workflow', cells: ['no', 'yes', 'partial'] },
      ],
      note:
        'Partial cells are the interesting ones: a chatbot writes only once a connector is attached, deep research reads the world but writes nowhere, and a workflow can run on a schedule but a human authored its every step.',
      takeaway:
        'The two scales move independently. Autonomy without tool access is a long essay; tool access without autonomy is a form.',
    },
    {
      kind: 'bullets',
      kicker: 'SPEC 02 · INSIDE THE LOOP',
      title: 'What a harness actually does',
      bullets: [
        { lead: 'Tool execution', text: 'Registers the actions the model can request (read a file, run a command, search), parses each request against a schema, runs it for real, and captures the output to feed back.' },
        { lead: 'Permissions', text: 'Decides what runs automatically and what needs sign-off first: which commands are safe to fire, which directories are writable, which calls need a human in the loop.' },
        { lead: 'Context management', text: 'Long tasks generate more transcript than fits in one context window, so the harness trims, summarizes, or drops old tool output to keep the task moving.' },
        { lead: 'State and environment', text: 'Owns the container, working directory, and installed packages. The model only knows what the harness reports back; it never touches the environment directly.' },
      ],
      takeaway:
        'Call the model, execute what it asks for, feed the result back, repeat. Everything else a harness ships is control over that loop.',
    },
    {
      kind: 'bullets',
      kicker: 'SPEC 02 · THE HUMAN SEATS',
      title: 'You are in the loop three times',
      bullets: [
        { lead: '1 · Kick off', text: 'You write the task in plain language. Everything downstream traces back to how much you specified up front; a vague prompt gets more decisions made for you.' },
        { lead: '2 · Approve or deny', text: 'Before anything risky (a command, an edit outside the project, an external call) most harnesses pause and ask: allow once, allow for the session, or deny.' },
        { lead: '3 · Review at exit', text: 'Once the loop stops you read the diff, the test output, or the opened pull request. The harness surfaces the result; you decide whether it ships.' },
      ],
      takeaway:
        'The permission system is seat 2 in practice, and the autonomous row of Spec 01 is what happens when seat 1 is a schedule instead of a person.',
    },
    {
      kind: 'divider',
      kicker: 'SPEC 03',
      title: 'Three ways the market has built it',
      subtitle:
        'CLI in your shell, agent inside the editor, cloud platform on a remote sandbox. Same loop, three surfaces, and four companies now sell into more than one row.',
    },
    {
      kind: 'table',
      kicker: 'SPEC 03 · THE LANDSCAPE',
      title: 'The product table',
      heads: ['Product', 'Company', 'Surface', 'License', 'Note'],
      rows: [
        ['Claude Code', 'Anthropic', 'CLI', 'Proprietary', 'Also ships as IDE extensions and a desktop app'],
        ['Codex CLI', 'OpenAI', 'CLI', 'Open source', 'Sandbox network access off by default'],
        ['opencode', 'anomalyco', 'CLI', 'Open source', 'Roughly 200k GitHub stars'],
        ['Antigravity CLI', 'Google', 'CLI', 'Closed source', 'Replaced Gemini CLI for consumer tiers, June 2026'],
        ['Cursor', 'SpaceX (SpaceXAI)', 'IDE', 'Proprietary', 'Acquired from Anysphere for $60B, closed Aug 14, 2026'],
        ['GitHub Copilot', 'Microsoft (GitHub)', 'IDE', 'Proprietary', 'Agent mode in VS Code and JetBrains'],
        ['Devin', 'Cognition', 'Cloud', 'Proprietary', 'Sold across four surfaces since June 2026'],
        ['Jules', 'Google', 'Cloud', 'Proprietary', 'Scheduled, self-triggered runs since Dec 2025'],
        ['OpenHands', 'All Hands AI', 'Cloud', 'Open-core', 'Fully self-hostable'],
      ],
      note:
        'LangGraph, the OpenHands SDK, and CrewAI sit underneath all three tiers: libraries with no default interface, used to build one of the above.',
      takeaway:
        'License and surface are independent questions, and the tier turnover is fast: two of these rows changed hands or names in 2026 alone.',
    },
    {
      kind: 'bullets',
      kicker: 'SPEC 04 · THE CONNECTOR',
      title: 'Where MCP fits',
      bullets: [
        { lead: 'One protocol, not N integrations', text: 'Before MCP every harness hand-built its own Slack, GitHub, and database connections. MCP standardizes discovery and calling into one protocol inside the tool-call box.' },
        { lead: 'The server sets the risk', text: 'Whether an MCP tool is read-only or read-write depends entirely on the server. MCP standardizes how a tool is called; the harness still decides what needs your sign-off.' },
        { lead: 'Adopted across all three tiers', text: 'Claude Code and opencode (CLI), Cline and Cursor (IDE), Copilot cloud agent and Jules (cloud). The tiers differ in trust: local harnesses accept any server, clouds curate.' },
        { lead: 'Two siblings', text: 'ACP standardizes how editors host coding agents (Devin Desktop, JetBrains, VS Code). A2A lets agents negotiate with each other directly.' },
      ],
      takeaway:
        'MCP is the mechanism behind the read-only and read-write columns of Spec 01: it makes the call possible, and the harness makes it permitted.',
    },
    {
      kind: 'stat-grid',
      kicker: 'SPEC 05 · JUDGING ONE',
      title: 'The scoreboard depends on the scaffold',
      stats: [
        { n: '~94%', l: 'SWE-bench Verified', sub: 'Frontier models cluster in the low-to-mid 90s; the set is flagged for contamination and kept mainly for history.' },
        { n: '59.1%', l: 'SWE-bench Pro, standardized', sub: "Scale AI's contamination-resistant successor: GPT-5.4 leads the public split under one shared scaffold, August 2026." },
        { n: '~20 pts', l: 'The harness effect', sub: 'Vendor-chosen scaffolds reach 80% on the same benchmark. The spread is produced by harness and data split alone.' },
      ],
      note:
        'One default worth checking: Codex CLI ships with sandbox network access disabled; Claude Code, Devin, and Manus reach the live web out of the box.',
      takeaway:
        'Any quoted score needs its split and scaffold named. Terminal-Bench 2.0, scoring autonomous end-to-end execution, is emerging as the more relevant test.',
    },
    {
      kind: 'divider',
      kicker: 'CLOSE',
      title: 'The wrapper is the product now',
      subtitle:
        'Same engines, different cars. Judge the permission system, the context management, and the scaffold behind the score, not the model badge on the hood.',
    },
  ];

  return { generatedOn, slides };
}
