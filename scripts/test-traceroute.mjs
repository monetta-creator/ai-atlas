// Plain-node test for Traceroute's pure modules.
//
//   node scripts/test-traceroute.mjs
//
// Node strips the TypeScript types natively, so the .ts modules load directly with no build
// step. Everything under test is deliberately free of React, three.js, and the DB, which is
// what makes this possible and is the reason the highest-risk piece was built that way.

import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));

// TypeScript resolves extensionless relative imports and the `@/*` path alias; Node does
// neither. Teach the resolver both so the app's own source loads unmodified, with no build
// step and no test-only copies of the modules under test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const attempts = [specifier];
    if (specifier.startsWith('@/')) attempts.push(new URL(specifier.slice(2), `file://${root}`).href);
    for (const base of [...attempts]) {
      if (!/\.[a-z]+$/.test(base)) attempts.push(`${base}.ts`, `${base}/index.ts`);
    }
    let lastErr;
    for (const a of attempts) {
      try {
        return nextResolve(a, context);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  },
});
const { compileRun } = await import(`${root}lib/traceroute/compile.ts`);
const player = await import(`${root}lib/traceroute/player.ts`);
const { RUNS } = await import(`${root}lib/traceroute/runs/index.ts`);
const { ARCH_PART_IDS } = await import(`${root}lib/traceroute/architecture.ts`);
const { contextAt } = await import(`${root}lib/traceroute/run-types.ts`);
const { CONDENSED_CYCLE, FULL_CYCLE } = await import(`${root}lib/traceroute/phases.ts`);

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    console.log(`  FAIL  ${msg}`);
    failures++;
  }
};

const PART_IDS = new Set(ARCH_PART_IDS);

for (const run of RUNS) {
  console.log(`\n== ${run.id} ==`);
  const tl = compileRun(run);
  const full = compileRun(run, { condenseAfterCycle: Infinity });

  console.log(
    `  ${run.promptTokens.length} prompt tokens, ${run.outputs.length} generated · ` +
      `${tl.steps.length} steps condensed / ${full.steps.length} full · ` +
      `${(tl.totalMs / 1000).toFixed(0)}s at 1x`
  );

  // ---- structure
  ok(tl.steps.length > 0, 'timeline is non-empty');
  ok(tl.cycles.length === run.outputs.length + 1, 'one rail entry per cycle plus the prologue');
  ok(full.steps.length > tl.steps.length, 'condensing actually removes steps');
  ok(tl.totalMs > 0, 'timeline has duration');

  // ---- every part reference resolves. The literal union makes this a compile error too,
  // but the runtime check catches data built dynamically.
  for (const s of tl.steps) {
    for (const id of s.focus) ok(PART_IDS.has(id), `${s.key} focus "${id}" is a real part`);
    for (const id of s.dim) ok(PART_IDS.has(id), `${s.key} dim "${id}" is a real part`);
    for (const e of s.flow) {
      ok(PART_IDS.has(e.from), `${s.key} flow.from "${e.from}" is a real part`);
      ok(PART_IDS.has(e.to), `${s.key} flow.to "${e.to}" is a real part`);
    }
    ok(!s.focus.some((id) => s.dim.includes(id)), `${s.key} no part is both focused and dimmed`);
    ok(s.caption.length > 0, `${s.key} has a caption`);
    ok(!s.caption.includes('—'), `${s.key} caption has no em dash`);
    ok(s.durationMs > 0, `${s.key} has a duration`);
  }

  // ---- keys are unique and the index agrees
  const keys = new Set(tl.steps.map((s) => s.key));
  ok(keys.size === tl.steps.length, 'step keys are unique');
  for (const [key, i] of tl.byKey) ok(tl.steps[i].key === key, `byKey["${key}"] points at itself`);

  // ---- the autoregressive property: context grows by exactly one per cycle
  for (let c = 0; c < run.outputs.length; c++) {
    const before = contextAt(run, c).length;
    const after = contextAt(run, c + 1).length;
    ok(after === before + 1, `cycle ${c} grows the context by exactly one token`);
  }

  // ---- the KV cache property: only the newest position is processed after the prologue
  for (const s of tl.steps) {
    if (s.cycle < 0) {
      ok(
        s.positionsActive.length === run.promptTokens.length,
        'prologue processes every prompt position'
      );
    } else if (s.phase !== 'done') {
      ok(
        s.positionsActive.length === 1,
        `${s.key} processes exactly one position (KV cache), got ${s.positionsActive.length}`
      );
    }
  }

  // ---- the loop is explicit in the data
  const appendSteps = tl.steps.filter((s) => s.phase === 'append');
  ok(appendSteps.length === run.outputs.length, 'one append beat per generated token');
  for (const s of appendSteps) {
    ok(
      s.flow.some((e) => e.kind === 'loop'),
      `${s.key} carries the loop-back connector`
    );
  }

  // ---- cycle shape
  const firstCycle = tl.cycles.find((c) => c.cycle === 0);
  const secondCycle = tl.cycles.find((c) => c.cycle === 1);
  if (firstCycle) {
    ok(
      firstCycle.endIndex - firstCycle.startIndex + 1 === FULL_CYCLE.length,
      'cycle 0 gets the full pass'
    );
  }
  if (secondCycle) {
    const len = secondCycle.endIndex - secondCycle.startIndex + 1;
    const expected = secondCycle.cycle === run.outputs.length - 1
      ? CONDENSED_CYCLE.length + 1   // last cycle absorbs the closing 'done' beat
      : CONDENSED_CYCLE.length;
    ok(len === expected, `cycle 1 is condensed (${len} steps, expected ${expected})`);
  }

  // ---- player: seek is idempotent
  let s0 = player.initialState();
  const target = Math.floor(tl.steps.length / 2);
  const a = player.reduce(s0, { t: 'seek', index: target }, tl);
  const b = player.reduce(a, { t: 'seek', index: target }, tl);
  ok(JSON.stringify(a) === JSON.stringify(b), 'seek is idempotent');

  // ---- player: clamping
  const over = player.reduce(s0, { t: 'seek', index: 99999 }, tl);
  const under = player.reduce(s0, { t: 'seek', index: -50 }, tl);
  ok(over.index === tl.steps.length - 1, 'seek clamps at the end');
  ok(under.index === 0, 'seek clamps at the start');

  // ---- player: playing to step N lands on the same frame as seeking to N.
  // This is THE property that makes scrubbing trustworthy.
  let playState = player.reduce(player.initialState(), { t: 'play' }, tl);
  let guard = 0;
  const visited = [];
  while (playState.playing && guard++ < 100_000) {
    visited.push(playState.index);
    playState = player.reduce(playState, { t: 'tick', dtMs: 16.7 }, tl);
  }
  ok(guard < 100_000, 'playback terminates');
  ok(!playState.playing, 'playback stops itself at the end');
  ok(playState.index === tl.steps.length - 1, 'playback ends on the last step');

  const uniqueVisited = [...new Set(visited)];
  ok(
    uniqueVisited.length === tl.steps.length,
    `playback visits every step (${uniqueVisited.length} of ${tl.steps.length})`
  );
  ok(
    uniqueVisited.every((v, i) => v === i),
    'playback visits steps in order with none skipped'
  );

  for (const i of [0, target, tl.steps.length - 1]) {
    const seeked = player.frameFor(player.reduce(player.initialState(), { t: 'seek', index: i }, tl), tl);
    ok(seeked.step.key === tl.steps[i].key, `frameFor after seek(${i}) is step ${i}`);
    ok(seeked.progress === 0, `frameFor after seek(${i}) starts at progress 0`);
  }

  // ---- player: a very long frame crosses multiple steps rather than stalling
  let jump = player.reduce(player.initialState(), { t: 'play' }, tl);
  jump = player.reduce(jump, { t: 'tick', dtMs: 60_000 }, tl);
  ok(jump.index > 2, 'a long frame advances past several steps');

  // ---- player: play at the end restarts
  const ended = { index: tl.steps.length - 1, playing: false, rate: 1, elapsedMs: tl.steps[tl.steps.length - 1].durationMs };
  const replayed = player.reduce(ended, { t: 'play' }, tl);
  ok(replayed.index === 0 && replayed.playing, 'play at the end restarts from the top');

  // ---- player: rate affects speed but never the destination
  let fast = player.reduce(player.initialState(), { t: 'play' }, tl);
  fast = player.reduce(fast, { t: 'rate', rate: 2 }, tl);
  let fastGuard = 0;
  while (fast.playing && fastGuard++ < 100_000) fast = player.reduce(fast, { t: 'tick', dtMs: 16.7 }, tl);
  ok(fast.index === tl.steps.length - 1, 'rate 2x still ends on the last step');
}

console.log(
  failures === 0
    ? `\nALL ${checks} CHECKS PASSED`
    : `\n${failures} of ${checks} CHECKS FAILED`
);
process.exit(failures === 0 ? 0 : 1);
