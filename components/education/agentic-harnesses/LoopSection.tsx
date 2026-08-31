'use client';

import { useState } from 'react';

// Spec 02: the agentic loop, with and without a harness. The source page
// toggled SVG groups via style.display; here the mode is state and only the
// active diagram renders.

type Mode = 'without' | 'with';

function WithoutDiagram() {
  return (
    <svg
      width="100%"
      viewBox="0 0 580 400"
      role="img"
      aria-label="Diagram of a bare model call: you write the prompt, the model reasons without tools, and a text answer comes back for you to read before writing the next prompt yourself"
    >
      <defs>
        <marker id="edu-a1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--edu-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="edu-a3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--edu-neutral)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      <rect x={60} y={170} width={140} height={60} rx={2} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />
      <text className="edu-th" x={130} y={192} textAnchor="middle">You</text>
      <text className="edu-ts" x={130} y={210} textAnchor="middle">write the prompt</text>

      <line x1={200} y1={200} x2={258} y2={200} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-a1)" />

      <rect x={260} y={170} width={140} height={60} rx={2} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" strokeWidth={1} />
      <text className="edu-th" x={330} y={192} textAnchor="middle">Model</text>
      <text className="edu-ts" x={330} y={210} textAnchor="middle">reasons, no tools</text>

      <line x1={400} y1={200} x2={458} y2={200} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-a1)" />

      <rect x={460} y={170} width={110} height={60} rx={2} fill="var(--edu-neutral-soft)" stroke="var(--edu-neutral)" strokeWidth={1} />
      <text className="edu-th" x={515} y={192} textAnchor="middle">Answer</text>
      <text className="edu-ts" x={515} y={210} textAnchor="middle">text only</text>

      <path d="M 515 230 L 515 320 L 130 320 L 130 232" fill="none" stroke="var(--edu-neutral)" strokeWidth={1} strokeDasharray="4 3" markerEnd="url(#edu-a3)" />
      <text className="edu-ts" x={322} y={345} textAnchor="middle">nothing runs on its own: you read it, then write the next prompt yourself</text>
    </svg>
  );
}

function WithDiagram() {
  return (
    <svg
      width="100%"
      viewBox="0 0 580 400"
      role="img"
      aria-label="Diagram of the agentic loop showing where the human operator gives the task, approves risky actions, and reviews the result at loop exit"
    >
      <defs>
        <marker id="edu-b1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--edu-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="edu-b2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="edu-b3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke="var(--edu-amber)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      {/* Row 1: automated loop */}
      <rect x={10} y={60} width={110} height={50} rx={2} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />
      <text className="edu-th" x={65} y={80} textAnchor="middle">You</text>
      <text className="edu-ts" x={65} y={96} textAnchor="middle">give the task</text>
      <circle cx={20} cy={60} r={9} fill="var(--ink)" />
      <text x={20} y={60} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>1</text>

      <line x1={120} y1={85} x2={138} y2={85} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-b1)" />

      <rect x={140} y={60} width={100} height={50} rx={2} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" strokeWidth={1} />
      <text className="edu-th" x={190} y={80} textAnchor="middle">Model</text>
      <text className="edu-ts" x={190} y={96} textAnchor="middle">reasons, requests</text>

      <line x1={240} y1={85} x2={258} y2={85} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-b1)" />

      <rect x={260} y={60} width={110} height={50} rx={2} fill="var(--edu-blue-soft)" stroke="var(--edu-blue)" strokeWidth={1} />
      <text className="edu-th" x={315} y={80} textAnchor="middle">Tool call</text>
      <text className="edu-ts" x={315} y={96} textAnchor="middle">file, shell, search</text>

      <line x1={370} y1={85} x2={408} y2={85} stroke="var(--edu-blue)" strokeWidth={1} markerEnd="url(#edu-b1)" />

      <rect x={410} y={60} width={100} height={50} rx={2} fill="var(--edu-amber-soft)" stroke="var(--edu-amber)" strokeWidth={1} />
      <text className="edu-th" x={460} y={80} textAnchor="middle">Execution</text>
      <text className="edu-ts" x={460} y={96} textAnchor="middle">real filesystem</text>

      {/* Branch down to approval, between tool call and execution */}
      <line x1={385} y1={85} x2={385} y2={178} stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" markerEnd="url(#edu-b2)" />

      <rect x={310} y={180} width={150} height={50} rx={2} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />
      <text className="edu-th" x={385} y={200} textAnchor="middle">You</text>
      <text className="edu-ts" x={385} y={216} textAnchor="middle">approve or deny?</text>
      <circle cx={320} cy={180} r={9} fill="var(--ink)" />
      <text x={320} y={180} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>2</text>

      {/* Main feedback loop, routed clear of the human boxes */}
      <path d="M 510 85 L 550 85 L 550 345 L 185 345 L 185 110" fill="none" stroke="var(--edu-amber)" strokeWidth={1} strokeDasharray="4 3" markerEnd="url(#edu-b3)" />
      <text className="edu-ts" x={367} y={365} textAnchor="middle">result feeds back into context; the loop repeats until the task is done</text>

      {/* Review branches off the loop's return leg: it happens at exit, once the loop stops */}
      <line x1={550} y1={295} x2={537} y2={295} stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" markerEnd="url(#edu-b2)" />
      <rect x={385} y={270} width={150} height={50} rx={2} fill="var(--bg)" stroke="var(--ink)" strokeWidth={1} strokeDasharray="3 3" />
      <text className="edu-th" x={460} y={290} textAnchor="middle">You</text>
      <text className="edu-ts" x={460} y={306} textAnchor="middle">review at loop exit</text>
      <circle cx={395} cy={270} r={9} fill="var(--ink)" />
      <text x={395} y={270} textAnchor="middle" dominantBaseline="central" style={{ fill: 'var(--surface)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>3</text>
    </svg>
  );
}

export default function LoopSection() {
  const [mode, setMode] = useState<Mode>('without');

  return (
    <section id="loop" className="edu-section">
      <div className="edu-eyebrow">Spec 02</div>
      <h2>What a harness actually does</h2>
      <p className="edu-lede">
        A harness is software that runs a model in a loop: call the model, execute what it asks
        for, feed the result back, repeat. The dashed boxes below are you: the diagram marks where
        you enter the loop. Toggle it to see what changes when the loop exists at all.
      </p>

      <div className="edu-loop">
        <div className="edu-loop-svg">
          {mode === 'without' ? <WithoutDiagram /> : <WithDiagram />}
        </div>
        <div className="edu-loop-panel">
          <div className="edu-toggle" role="group" aria-label="Toggle the diagram">
            <button type="button" aria-pressed={mode === 'without'} onClick={() => setMode('without')}>
              Without a harness
            </button>
            <button type="button" aria-pressed={mode === 'with'} onClick={() => setMode('with')}>
              With a harness
            </button>
          </div>
          <div className="edu-loopbox">
            {mode === 'without' ? (
              <>
                <strong>Without a harness</strong>
                You ask a question, the model answers in text. It has no way to check a file, run a
                command, or see whether its own suggestion actually worked. Every step still runs
                through you.
              </>
            ) : (
              <>
                <strong>With a harness</strong>
                The model requests an action, the harness runs it for real, and the outcome feeds
                straight back into the next model turn. You still sit inside that loop, approving
                anything risky as it happens, and reviewing the result once the loop stops.
              </>
            )}
          </div>
        </div>
      </div>

      <div className="edu-operators">
        <div className="edu-opcard">
          <span className="edu-opnum">1</span>
          <h4>Kick off</h4>
          <p>
            You write the task in plain language. Everything downstream traces back to how much you
            specified up front; a vague prompt gets more decisions made for you.
          </p>
        </div>
        <div className="edu-opcard">
          <span className="edu-opnum">2</span>
          <h4>Approve or deny</h4>
          <p>
            Before anything risky (running a command, editing outside the project folder, calling
            an external service) most harnesses pause and ask: allow once, allow for the rest of
            this session, or deny. This is the permission system in practice.
          </p>
        </div>
        <div className="edu-opcard">
          <span className="edu-opnum">3</span>
          <h4>Review</h4>
          <p>
            Once the loop stops, you read the diff, the test output, or the opened pull request
            before it ships. The harness surfaces the result; you decide whether the work is good
            enough to merge.
          </p>
        </div>
      </div>

      <ul className="edu-checklist">
        <li>
          <strong>Tool execution.</strong> The harness registers the actions the model can request
          (read a file, run a command, search), parses each request against a schema, runs it for
          real, and captures the output to return.
        </li>
        <li>
          <strong>Permissions.</strong> It decides what runs automatically and what needs your
          sign-off first: which commands are safe to fire without asking, which directories are
          writable, which need a human in the loop.
        </li>
        <li>
          <strong>Context management.</strong> Long tasks generate more transcript than fits in one
          context window, so the harness trims, summarizes, or drops old tool output to keep the
          task moving.
        </li>
        <li>
          <strong>State and environment.</strong> It owns the actual container, working directory,
          and installed packages. The model only knows what the harness reports back; it never
          touches the environment directly.
        </li>
      </ul>
    </section>
  );
}
