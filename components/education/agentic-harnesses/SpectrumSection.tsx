'use client';

import { useState } from 'react';
import type { KeyboardEvent } from 'react';

// Spec 01: the loop-autonomy x tool-access grid. The source page swapped the
// info panel via innerHTML; here the panel is plain state over a typed map,
// and every SVG node doubles as a keyboard-reachable button.

type NodeKey = 'api' | 'chat' | 'workflow' | 'research' | 'bounded' | 'harness' | 'autonomous';

const PANEL: Record<NodeKey, { h: string; rows: [string, string][] }> = {
  api: {
    h: 'Direct API call',
    rows: [
      ['What it is', 'One request, one response'],
      ['Loops on its own?', 'No'],
      ['Touches real systems?', 'No'],
      ['Stops when', 'The response is generated'],
    ],
  },
  chat: {
    h: 'Chatbot',
    rows: [
      ['What it is', 'A back-and-forth conversation you drive turn by turn'],
      ['Loops on its own?', 'No, you send each turn yourself'],
      ['Touches real systems?', 'Sometimes: a web search by default; read-write once connectors are attached'],
      ['Stops when', 'You stop sending messages'],
    ],
  },
  workflow: {
    h: 'Workflow (a third property)',
    rows: [
      ['What it is', 'Fixed code calls the model at specific steps; a human chose the path in advance'],
      ['Loops on its own?', 'No: a human wrote the path; the model fills in steps'],
      ['Touches real systems?', 'Can, wherever the human wired it to'],
      ['Stops when', 'The predefined path finishes'],
    ],
  },
  research: {
    h: 'Deep research',
    rows: [
      ['What it is', 'The model runs its own search-and-read loop for one request'],
      ['Loops on its own?', 'Yes, but only within that one task'],
      ['Touches real systems?', "Reads external sources, doesn't write anywhere"],
      ['Stops when', 'The report is compiled'],
    ],
  },
  bounded: {
    h: 'Bounded run',
    rows: [
      ['What it is', 'A harness given a hard stop: plan mode, one pull request, a fixed step budget'],
      ['Loops on its own?', 'Yes, up to the limit you set'],
      ['Touches real systems?', 'Yes: files, commands, a single PR'],
      ['Stops when', 'The limit is reached, then you decide whether to continue'],
    ],
  },
  harness: {
    h: 'Agentic harness',
    rows: [
      ['What it is', 'The model runs an open-ended loop against a real environment'],
      ['Loops on its own?', "Yes, until the task is done or it's stopped"],
      ['Touches real systems?', 'Yes: files, commands, deployments'],
      ['Stops when', 'The task passes its checks, or a limit is hit'],
    ],
  },
  autonomous: {
    h: 'Autonomous agent',
    rows: [
      ['What it is', 'A harness whose trigger, a schedule or an event, was authored once and then fires without a human'],
      ['Loops on its own?', 'Yes: the trigger was set once, then each run starts without you'],
      ['Touches real systems?', 'Yes: files, commands, deployments'],
      ['Stops when', 'The task passes its checks, or a limit is hit'],
    ],
  },
};

// One clickable node on the grid: a keyboard-reachable group wrapping the
// rect + labels, styled by .edu-node.
function Node({
  k, x, y, w, h, fill, stroke, dashed, label, sub, onPick,
}: {
  k: NodeKey; x: number; y: number; w: number; h: number;
  fill: string; stroke: string; dashed?: boolean;
  label: string; sub?: string;
  onPick: (k: NodeKey) => void;
}) {
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(k);
    }
  };
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g
      className="edu-node"
      role="button"
      tabIndex={0}
      aria-label={`Show details for ${label}`}
      onClick={() => onPick(k)}
      onKeyDown={onKey}
    >
      <rect x={x} y={y} width={w} height={h} rx={2} fill={fill} stroke={stroke} strokeWidth={1} strokeDasharray={dashed ? '3 3' : undefined} />
      {sub ? (
        <>
          <text className="edu-th" x={cx} y={cy - 6} textAnchor="middle" dominantBaseline="central">{label}</text>
          <text className="edu-ts" x={cx} y={cy + 12} textAnchor="middle" dominantBaseline="central">{sub}</text>
        </>
      ) : (
        <text className="edu-th" x={cx} y={cy} textAnchor="middle" dominantBaseline="central">{label}</text>
      )}
    </g>
  );
}

const TIER_ROWS: { dot: string; hollow?: boolean; offaxis?: boolean; highlight?: boolean; cells: string[] }[] = [
  { dot: 'var(--edu-neutral)', cells: ['Direct API call', 'One request, one response', 'No', 'No', 'The response is generated'] },
  { dot: 'var(--edu-blue)', cells: ['Chatbot', 'A back-and-forth conversation you drive turn by turn', 'No, you send each turn yourself', 'Sometimes: a web search by default; read-write once connectors are attached', 'You stop sending messages'] },
  { dot: 'var(--edu-amber)', cells: ['Deep research', 'The model runs its own search-and-read loop for one request', 'Yes, but only within that one task', "Reads external sources, doesn't write anywhere", 'The report is compiled'] },
  { dot: 'var(--edu-purple)', highlight: true, cells: ['Agentic harness', 'The model runs an open-ended loop against a real environment', "Yes, until the task is done or it's stopped", 'Yes: files, commands, deployments', 'The task passes its checks, or a limit is hit'] },
  { dot: 'var(--edu-red)', cells: ['Autonomous agent', 'A harness whose trigger, a schedule or an event, was authored once and then fires without a human', 'Yes: the trigger was set once, then each run starts without you', 'Yes: files, commands, deployments', 'The task passes its checks, or a limit is hit'] },
  { dot: 'var(--edu-neutral)', hollow: true, offaxis: true, cells: ['Workflow', 'Fixed code calls the model at specific steps; a human chose the path in advance', 'No: a human wrote the path; the model fills in steps', 'Can, wherever the human wired it to', 'The predefined path finishes'] },
];

export default function SpectrumSection() {
  const [picked, setPicked] = useState<NodeKey | null>(null);
  const d = picked ? PANEL[picked] : null;

  return (
    <section id="spectrum" className="edu-section">
      <div className="edu-eyebrow">Spec 01</div>
      <h2>Where &ldquo;harness&rdquo; sits among the other terms</h2>
      <p className="edu-lede">
        Direct API call, chatbot, deep research, agentic harness: these are points on the same two
        scales. Each axis is a discrete ladder: rows measure how far the loop runs before a human is
        needed again, columns measure what the loop&apos;s tool schema permits. Where two tiers share a
        row or column, they share that trait exactly. Click a point.
      </p>

      <div className="edu-quad">
        <div className="edu-quad-svg">
          <svg
            width="100%"
            viewBox="0 0 640 470"
            role="img"
            aria-label="Grid plotting direct API calls, chatbots, workflows, deep research, bounded runs, agentic harnesses, and triggered agents against two discrete scales: how far the loop runs on its own, and what kind of tool calls it can make once running, from none to read-only to read-write."
          >
            <defs>
              <marker id="edu-sa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="var(--ink-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>

            <text className="edu-axis-label" x={20} y={24}>LOOP AUTONOMY</text>

            {/* gridlines */}
            <line x1={250} y1={40} x2={250} y2={400} stroke="var(--line)" strokeWidth={1} />
            <line x1={390} y1={40} x2={390} y2={400} stroke="var(--line)" strokeWidth={1} />
            <line x1={530} y1={40} x2={530} y2={400} stroke="var(--line)" strokeWidth={1} />
            <line x1={150} y1={380} x2={620} y2={380} stroke="var(--line)" strokeWidth={1} />
            <line x1={150} y1={290} x2={620} y2={290} stroke="var(--line)" strokeWidth={1} />
            <line x1={150} y1={200} x2={620} y2={200} stroke="var(--line)" strokeWidth={1} />
            <line x1={150} y1={110} x2={620} y2={110} stroke="var(--line)" strokeWidth={1} />

            {/* axes */}
            <line x1={150} y1={400} x2={150} y2={40} stroke="var(--ink-faint)" strokeWidth={1} markerEnd="url(#edu-sa)" />
            <line x1={150} y1={400} x2={620} y2={400} stroke="var(--ink-faint)" strokeWidth={1} markerEnd="url(#edu-sa)" />

            {/* row labels */}
            <text className="edu-ts" x={15} y={380} dominantBaseline="central">No loop</text>
            <text className="edu-ts" x={15} y={290} dominantBaseline="central">Bounded loop</text>
            <text className="edu-ts" x={15} y={193} dominantBaseline="central">Open-ended,</text>
            <text className="edu-ts" x={15} y={207} dominantBaseline="central">you start it</text>
            <text className="edu-ts" x={15} y={103} dominantBaseline="central">Triggered,</text>
            <text className="edu-ts" x={15} y={117} dominantBaseline="central">no per-run human</text>

            {/* column labels */}
            <text className="edu-th" x={250} y={416} textAnchor="middle">No tool calls</text>
            <text className="edu-ts" x={250} y={430} textAnchor="middle" style={{ fontSize: 10 }}>replies with text only</text>
            <text className="edu-th" x={390} y={416} textAnchor="middle">Read-only tools</text>
            <text className="edu-ts" x={390} y={430} textAnchor="middle" style={{ fontSize: 10 }}>fetches data, no side effects</text>
            <text className="edu-th" x={530} y={416} textAnchor="middle">Read-write tools</text>
            <text className="edu-ts" x={530} y={430} textAnchor="middle" style={{ fontSize: 10 }}>can change what it touches</text>
            <text className="edu-axis-label" x={385} y={455} textAnchor="middle">TOOL CALLS THE LOOP CAN MAKE ONCE IT&apos;S RUNNING</text>

            {/* Row: no loop */}
            <Node k="api" x={190} y={355} w={120} h={50} fill="var(--edu-neutral-soft)" stroke="var(--edu-neutral)" label="API call" onPick={setPicked} />
            <Node k="chat" x={330} y={355} w={120} h={50} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" label="Chatbot" sub="read-write once connected" onPick={setPicked} />
            <Node k="workflow" x={470} y={355} w={120} h={50} fill="var(--bg)" stroke="var(--ink)" dashed label="Workflow" sub="human-authored path" onPick={setPicked} />

            {/* Row: bounded loop */}
            <Node k="research" x={330} y={265} w={120} h={50} fill="var(--edu-amber-soft)" stroke="var(--edu-amber)" label="Deep research" onPick={setPicked} />
            <Node k="bounded" x={470} y={265} w={120} h={50} fill="var(--bg)" stroke="var(--edu-purple)" dashed label="Bounded run" sub="plan mode, one PR, stop" onPick={setPicked} />

            {/* Row: open-ended */}
            <Node k="harness" x={470} y={175} w={120} h={50} fill="var(--edu-purple-soft)" stroke="var(--edu-purple)" label="Agentic harness" onPick={setPicked} />

            {/* Row: triggered */}
            <Node k="autonomous" x={470} y={85} w={120} h={50} fill="var(--edu-red-soft)" stroke="var(--edu-red)" label="Autonomous agent" onPick={setPicked} />
          </svg>
        </div>
        <div className="edu-quad-info">
          <div className="edu-infobox" aria-live="polite">
            {d ? (
              <>
                <h4>{d.h}</h4>
                {d.rows.map(([k, v]) => (
                  <div className="edu-sbrow" key={k}>
                    <span className="edu-sbk">{k}</span>
                    <span className="edu-sbv">{v}</span>
                  </div>
                ))}
              </>
            ) : (
              <>
                <h4>Click a point on the grid</h4>
                <p>
                  Rows measure how far the loop runs before a human is needed again. Columns measure
                  what it&apos;s allowed to touch. The two axes move independently: chatbot and deep
                  research share a column because both read and neither writes, and the dashed nodes
                  mark cells that products already occupy: a chat session with a send-email connector,
                  a harness told to stop after one pull request.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="edu-rule">
        <strong>Plotting rule</strong>
        Plot the mode, never the product. A product with several modes occupies one cell per mode:
        the same chat interface sits in the no-loop/read-only cell by default and moves to
        read-write the moment a connector is attached; the same harness sits in the bounded row in
        plan mode and the open-ended row when left to run.
      </div>

      <p className="edu-note">
        A harness is what turns the &ldquo;agentic harness&rdquo; cell into a product. It&apos;s the same
        underlying loop as deep research, aimed at a real environment instead of a stack of search
        results, and left running longer. An autonomous agent shares that same column and takes the
        row one step further: its trigger, a schedule or an event, was authored once by a human and
        then fires without one.
      </p>
      <p className="edu-note">
        Workflows sit in the no-loop, read-write cell, and a third property separates them from
        everything else on the grid: who chooses the control flow. Anthropic&apos;s engineering guidance
        defines a workflow as a system where a human writes the code path and the model fills in
        specific steps, and an agent as a system where the model decides its own next step at
        runtime. A workflow can call a model, use tools, and touch real systems; a human chose the
        route before it ran.
      </p>

      <div className="edu-tablewrap">
        <table className="edu-table">
          <thead>
            <tr>
              <th>Term</th>
              <th>What it is</th>
              <th>Loops on its own?</th>
              <th>Touches real systems?</th>
              <th>Stops when</th>
            </tr>
          </thead>
          <tbody>
            {TIER_ROWS.map((r) => (
              <tr
                key={r.cells[0]}
                className={r.highlight ? 'edu-tier-highlight' : r.offaxis ? 'edu-tier-offaxis' : undefined}
              >
                <td className="edu-tier-name">
                  <span
                    className={`edu-dot${r.hollow ? ' edu-dot--hollow' : ''}`}
                    style={r.hollow ? undefined : { background: r.dot }}
                  />
                  {r.cells[0]}
                </td>
                {r.cells.slice(1).map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
