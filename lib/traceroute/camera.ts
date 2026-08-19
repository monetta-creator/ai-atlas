// Camera poses and the maths for moving between them.
//
// Pure: no three.js import, so poses can be tuned, tested, and reasoned about without a
// renderer. lib/traceroute/scene-silicon.ts applies the result.
//
// Perspective, not orthographic. The brief is presence: the reader should feel located
// beside the stack rather than to be reading a diagram of it. Field of view is held between
// 45 and 50 degrees, wide enough to feel spatial and narrow enough to avoid the fisheye that
// reads as a game.

import type { PoseKey } from './phases';
import type { Pose } from './types';

/**
 * Where the camera sits for each beat of the loop. The stack runs from about y = -2 at the
 * prompt to y = 17 at the output, so these track up it as the data does.
 */
export const INFERENCE_POSES: Record<PoseKey, Pose> = {
  input:     { pos: [9, 3.5, 15], target: [0, 0.6, 0], fov: 48 },
  block:     { pos: [11, 7, 14], target: [0, 6, 0], fov: 47 },
  attention: { pos: [-9, 6.5, 14], target: [-2.5, 5, 0], fov: 46 },
  mlp:       { pos: [12, 9, 12], target: [2.5, 8, 0], fov: 46 },
  stack:     { pos: [14, 10, 19], target: [0, 9.5, 0], fov: 50 },
  head:      { pos: [9, 15.5, 14], target: [0, 14.5, 0], fov: 46 },
  loop:      { pos: [13, 8, 20], target: [0, 8, 0], fov: 50 },
};

/** The resting pose before playback starts: the whole stack in frame. */
export const OVERVIEW: Pose = { pos: [15, 9, 23], target: [0, 8, 0], fov: 50 };

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const k = Math.max(0, Math.min(1, t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    pos: [mix(a.pos[0], b.pos[0]), mix(a.pos[1], b.pos[1]), mix(a.pos[2], b.pos[2])],
    target: [mix(a.target[0], b.target[0]), mix(a.target[1], b.target[1]), mix(a.target[2], b.target[2])],
    fov: mix(a.fov, b.fov),
  };
}

/** Matches --ease-soft, used for settling and recovery. */
function easeSoft(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
}

/**
 * How fast the camera chases its target pose, as a per-second rate turned into a per-frame
 * factor. Framerate independent, so a 30fps device travels the same path as a 120fps one.
 */
export function chase(dtMs: number, perSecond = 3.2): number {
  return 1 - Math.exp((-perSecond * dtMs) / 1000);
}

/**
 * Blend weight for reader-controlled look.
 *
 * Locking the camera during playback feels dead; leaving it free means the reader drifts
 * off-frame and the show breaks. So the scripted pose is applied multiplied by this weight:
 * it drops to 0 the moment they grab the scene, and eases back to 1 about a second after
 * they let go. They can always nudge, and the framing always comes home.
 */
export function lookBlend(msSinceRelease: number | null, recoverMs = 1200): number {
  if (msSinceRelease === null) return 0; // still holding
  return easeSoft(Math.max(0, Math.min(1, msSinceRelease / recoverMs)));
}
