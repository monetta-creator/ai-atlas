// Shared vocabulary for Traceroute.
//
// Pure: no DB, no three.js, no React. Every module under lib/traceroute/ that is not
// explicitly a scene builder obeys that rule, matching the split documented in
// lib/supply-chain/map.ts (data and math are pure, renderers are thin).
//
// The journey is ten stops. Stops 0-7 and 10 live in the `world` scene; stops 8-9 live in
// the `silicon` scene. Each stop is its own LOCAL world where roughly one unit equals the
// stop's characteristic size, so the camera never leaves a well-conditioned numeric range.
// Absolute scale is carried as a human-readable string (`Stop.scaleLabel`), never as
// coordinates, which is what keeps a desk and a datacenter in the same codebase without
// float precision trouble.

export type StopId =
  | 'desk'
  | 'machine'
  | 'grid'
  | 'campus'
  | 'hall'
  | 'rack'
  | 'board'
  | 'die'
  | 'architecture'
  | 'inference'
  | 'return';

/** Reading order. The rail, the deep links, and the travel paths all derive from this. */
export const STOP_ORDER: StopId[] = [
  'desk',
  'machine',
  'grid',
  'campus',
  'hall',
  'rack',
  'board',
  'die',
  'architecture',
  'inference',
  'return',
];

/** Two scenes, not one continuous world. See the plan's camera section for why. */
export type SceneId = 'world' | 'silicon';

/** A perspective camera pose, in the stop's local units. */
export interface Pose {
  pos: [number, number, number];
  target: [number, number, number];
  /** Degrees. Held between 45 and 50 so it reads spatial without fisheye. */
  fov: number;
}

/** Bounds on free look, so a reader who drags the camera cannot end up facing nothing. */
export interface LookBounds {
  /** Radians, relative to the stop's forward direction. */
  yaw: [number, number];
  pitch: [number, number];
  /** Multipliers on the resting orbit distance. */
  dolly: [number, number];
}

/** Link out to content that already exists elsewhere on the site. */
export interface Anchor {
  /** Resolves against the seeded `concepts` table, rendered as /concepts/[slug]. */
  conceptSlug?: string;
  /** Resolves against SC_NODE_BY_SLUG in lib/supply-chain/map.ts. */
  scSlug?: string;
}

/**
 * Palette roles, not literal colors. `readPalette()` maps these onto the CSS design
 * tokens at runtime so the scene follows the light/dark theme for free.
 */
export type MaterialKey =
  | 'silicon'
  | 'metal'
  | 'copper'
  | 'pcb'
  | 'substrate'
  | 'enclosure'
  | 'glass'
  | 'concrete'
  | 'accent'
  | 'ghost';

/** Stable, deep-linkable prop identifier, e.g. 'board.package'. */
export type PropId = string;

export function isStopId(v: string): v is StopId {
  return (STOP_ORDER as string[]).includes(v);
}

export function stopIndex(id: StopId): number {
  return STOP_ORDER.indexOf(id);
}

export function neighbours(id: StopId): { prev: StopId | null; next: StopId | null } {
  const i = stopIndex(id);
  return {
    prev: i > 0 ? STOP_ORDER[i - 1] : null,
    next: i >= 0 && i < STOP_ORDER.length - 1 ? STOP_ORDER[i + 1] : null,
  };
}
