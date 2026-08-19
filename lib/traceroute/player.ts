// The inference player: a pure reducer over a compiled Timeline.
//
// THE HARD RULE, and the reason this module has no React and no three.js in it:
//
//   Every frame must be a pure function of (timeline, index, progress).
//   There is no accumulated state anywhere.
//
// Seeking to step 47 by dragging the scrubber must produce a picture identical to arriving
// at step 47 by pressing play and waiting. That property is what makes scrubbing feel solid
// instead of buggy, and it is easy to break the first time someone adds "a particle that
// keeps drifting". `elapsedMs` below is deliberately scoped to the CURRENT step only and is
// reset on every transition, so it can never accumulate across steps.
//
// Pure: testable with plain node, no browser required.

import type { Step, Timeline } from './compile';

export type Rate = 0.5 | 1 | 1.5 | 2;

export interface PlayerState {
  index: number;
  playing: boolean;
  rate: Rate;
  /** Milliseconds into the CURRENT step. Never accumulates across steps. */
  elapsedMs: number;
}

export type PlayerCmd =
  | { t: 'play' }
  | { t: 'pause' }
  | { t: 'toggle' }
  | { t: 'next' }
  | { t: 'prev' }
  | { t: 'seek'; index: number }
  | { t: 'seekCycle'; cycle: number }
  | { t: 'tick'; dtMs: number }
  | { t: 'rate'; rate: Rate }
  | { t: 'restart' };

export function initialState(): PlayerState {
  return { index: 0, playing: false, rate: 1, elapsedMs: 0 };
}

function clampIndex(i: number, tl: Timeline): number {
  if (tl.steps.length === 0) return 0;
  return Math.max(0, Math.min(tl.steps.length - 1, i));
}

export function reduce(s: PlayerState, c: PlayerCmd, tl: Timeline): PlayerState {
  switch (c.t) {
    case 'play':
      // Pressing play at the very end restarts rather than doing nothing.
      return atEnd(s, tl)
        ? { ...s, index: 0, elapsedMs: 0, playing: true }
        : { ...s, playing: true };
    case 'pause':
      return { ...s, playing: false };
    case 'toggle':
      return reduce(s, { t: s.playing ? 'pause' : 'play' }, tl);
    case 'next':
      return { ...s, index: clampIndex(s.index + 1, tl), elapsedMs: 0 };
    case 'prev':
      return { ...s, index: clampIndex(s.index - 1, tl), elapsedMs: 0 };
    case 'seek':
      return { ...s, index: clampIndex(c.index, tl), elapsedMs: 0 };
    case 'seekCycle': {
      const cyc = tl.cycles.find((x) => x.cycle === c.cycle);
      return cyc ? { ...s, index: clampIndex(cyc.startIndex, tl), elapsedMs: 0 } : s;
    }
    case 'rate':
      return { ...s, rate: c.rate };
    case 'restart':
      return { index: 0, playing: false, rate: s.rate, elapsedMs: 0 };
    case 'tick': {
      if (!s.playing || tl.steps.length === 0) return s;
      let index = s.index;
      let elapsed = s.elapsedMs + c.dtMs * s.rate;
      // A long frame (a backgrounded tab, a slow device) may cross several steps at once.
      // Loop rather than assuming one step per tick.
      for (;;) {
        const step = tl.steps[index];
        if (!step) break;
        if (elapsed < step.durationMs) break;
        if (index >= tl.steps.length - 1) {
          return { ...s, index: tl.steps.length - 1, elapsedMs: step.durationMs, playing: false };
        }
        elapsed -= step.durationMs;
        index += 1;
      }
      return { ...s, index, elapsedMs: elapsed };
    }
  }
}

export function atEnd(s: PlayerState, tl: Timeline): boolean {
  return (
    tl.steps.length > 0 &&
    s.index >= tl.steps.length - 1 &&
    s.elapsedMs >= tl.steps[tl.steps.length - 1].durationMs
  );
}

export function currentStep(s: PlayerState, tl: Timeline): Step | null {
  return tl.steps[clampIndex(s.index, tl)] ?? null;
}

/** 0..1 through the current step. The only continuous value the renderer gets. */
export function progress(s: PlayerState, tl: Timeline): number {
  const step = currentStep(s, tl);
  if (!step || step.durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, s.elapsedMs / step.durationMs));
}

/** 0..1 through the whole timeline, for the scrubber. */
export function overallProgress(s: PlayerState, tl: Timeline): number {
  if (tl.steps.length <= 1) return 0;
  return clampIndex(s.index, tl) / (tl.steps.length - 1);
}

/**
 * Everything the renderer needs for this instant, derived and never stored.
 * The single contract between the player and any view, 3D or DOM.
 */
export interface Frame {
  step: Step;
  progress: number;
  index: number;
  total: number;
}

export function frameFor(s: PlayerState, tl: Timeline): Frame | null {
  const step = currentStep(s, tl);
  if (!step) return null;
  return {
    step,
    progress: progress(s, tl),
    index: clampIndex(s.index, tl),
    total: tl.steps.length,
  };
}
