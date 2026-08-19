// The ten stops of the journey, plus the closing return.
//
// Order is fixed by STOP_ORDER in ./types. Each stop declares where the camera rests, how
// far the reader may look around from there, what it is made of (as supply-chain slugs
// resolved against the live map), and the one beat it exists to deliver.
//
// The DB overlay arrives separately: app/traceroute/page.tsx calls getSupplyChain(personal)
// and hands ScNodeView[] to the client, so a chokepoint's risk level and signal count are
// live without any new server code.

import { SC_NODE_BY_SLUG } from '@/lib/supply-chain/map';
import type { LookBounds, Pose, SceneId, StopId } from './types';
import { STOP_ORDER } from './types';

export interface Stop {
  id: StopId;
  scene: SceneId;
  /** Bold caps, e.g. "STOP 04". */
  kicker: string;
  title: string;
  /** Two sentences. No em dashes. */
  blurb: string;
  /** The one thing this stop exists to land. Rendered as the stop's pull quote. */
  beat: string;
  /** Human-readable true scale. The ONLY place absolute size lives. */
  scaleLabel: string;
  pose: Pose;
  look: LookBounds;
  /** Supply-chain nodes this stop is built from. Validated at module load. */
  scNodes: string[];
  conceptSlugs?: string[];
  /** Does the energy overlay mean anything here. */
  energy: boolean;
}

const LOOK_ROOM: LookBounds = { yaw: [-0.7, 0.7], pitch: [-0.45, 0.35], dolly: [0.65, 1.7] };
const LOOK_TIGHT: LookBounds = { yaw: [-0.5, 0.5], pitch: [-0.35, 0.3], dolly: [0.75, 1.4] };
const LOOK_WIDE: LookBounds = { yaw: [-1.1, 1.1], pitch: [-0.5, 0.3], dolly: [0.6, 2.2] };

export const STOPS: Stop[] = [
  {
    id: 'desk', scene: 'world', kicker: 'STOP 00', title: 'The client',
    blurb: 'A client machine and a prompt about to be submitted. Everything after this happens elsewhere.',
    beat: 'The request starts here.',
    scaleLabel: 'about 1.5 metres across',
    pose: { pos: [0, 2.2, 12], target: [0, 0.2, -1], fov: 48 },
    look: LOOK_TIGHT, scNodes: [], energy: false,
    conceptSlugs: ['token'],
  },
  {
    id: 'machine', scene: 'world', kicker: 'STOP 01', title: 'Inside the client',
    blurb: 'A processor, system memory, a consumer graphics card, a network interface. Enough for almost any other workload.',
    beat: 'No model weights are resident here. The request is already leaving.',
    scaleLabel: 'about 40 centimetres across',
    pose: { pos: [9, 8, 13], target: [0, 0.5, 0], fov: 48 },
    look: LOOK_ROOM, scNodes: ['power-components'], energy: true,
    conceptSlugs: ['compute', 'parameters'],
  },
  {
    id: 'grid', scene: 'world', kicker: 'STOP 02', title: 'Through the wall',
    blurb: 'Two things cross this boundary in opposite directions: low-voltage service in from the street, and the request out on single-mode fibre.',
    beat: 'Both of them are physical. Neither of them is a cloud.',
    scaleLabel: 'about 10 metres across',
    pose: { pos: [6, 5, 15], target: [-1, 3, -3], fov: 50 },
    look: LOOK_ROOM, scNodes: ['facility-systems', 'power-components'], energy: true,
  },
  {
    id: 'campus', scene: 'world', kicker: 'STOP 03', title: 'The campus',
    blurb: 'A few hundred milliseconds later the packets reach a facility designed around power density and heat rejection.',
    beat: 'This is where it actually went.',
    scaleLabel: 'about 200 metres across',
    pose: { pos: [26, 16, 34], target: [0, 2, 2], fov: 46 },
    look: LOOK_WIDE,
    scNodes: ['hyperscale-operators', 'colocation', 'facility-systems'], energy: true,
  },
  {
    id: 'hall', scene: 'world', kicker: 'STOP 04', title: 'The hall',
    blurb: 'A cold aisle between rows of identical cabinets, tens per row, tens of rows per hall.',
    beat: 'The repetition is the product. This is capacity, not a computer.',
    scaleLabel: 'about 90 metres end to end',
    pose: { pos: [0, 2.4, 16], target: [0, 2.6, -10], fov: 52 },
    look: LOOK_WIDE,
    scNodes: ['hyperscale-operators', 'thermal-cooling', 'facility-systems'], energy: true,
  },
  {
    id: 'rack', scene: 'world', kicker: 'STOP 05', title: 'One cabinet',
    blurb: 'Eight compute nodes, a fabric switch, power up one side and coolant up the other. One of thousands in this building.',
    beat: 'This cabinet alone can draw more power than a hundred homes.',
    scaleLabel: 'about 2 metres tall',
    pose: { pos: [9, 8, 16], target: [0, 6.5, 0], fov: 46 },
    look: LOOK_ROOM,
    scNodes: ['reference-systems', 'thermal-cooling', 'power-components'], energy: true,
  },
  {
    id: 'board', scene: 'world', kicker: 'STOP 06', title: 'The board',
    blurb: 'One node pulled from the rack and opened. A package, memory stacked beside it, power delivery, and a cold plate to carry the heat away.',
    beat: 'Everything upstream of here exists to produce this one object.',
    scaleLabel: 'about 60 centimetres across',
    pose: { pos: [12, 10, 15], target: [0, 1, 0], fov: 46 },
    look: LOOK_ROOM,
    scNodes: ['cowos-packaging', 'hbm-trio', 'substrate-makers', 'reference-systems'], energy: true,
    conceptSlugs: ['parameters'],
  },
  {
    id: 'die', scene: 'world', kicker: 'STOP 07', title: 'The die',
    blurb: 'The heat spreader comes off. Underneath, a lattice of near-identical tiles wired to adjacent memory through tens of thousands of microbumps.',
    beat: 'Quartz, lithography, and forty years of process development end here.',
    scaleLabel: 'about 3 centimetres across',
    pose: { pos: [8, 9, 12], target: [0, 0.4, 0], fov: 45 },
    look: LOOK_TIGHT,
    scNodes: ['tsmc-leading-edge', 'litho-euv', 'silicon-wafers', 'photoresist', 'mask-reticle'],
    energy: false,
    conceptSlugs: ['compute'],
  },
  {
    id: 'architecture', scene: 'silicon', kicker: 'STOP 08', title: 'What runs on it',
    blurb: 'Below the silicon, the shape of the thing being computed. A stack of identical blocks, each reading and rewriting the same running representation.',
    beat: 'No physical scale applies from here on. This is a schematic, not a photograph.',
    scaleLabel: 'no longer physical',
    pose: { pos: [10, 6, 15], target: [0, 6, 0], fov: 48 },
    look: LOOK_ROOM, scNodes: [], energy: false,
    conceptSlugs: ['transformer', 'attention-mechanism', 'embedding', 'parameters'],
  },
  {
    id: 'inference', scene: 'silicon', kicker: 'STOP 09', title: 'Decoding',
    blurb: 'The structure executes. Tokens become vectors, move up through every block, and emerge as a distribution over the whole vocabulary.',
    beat: 'One token at a time, and then it starts over.',
    scaleLabel: 'no longer physical',
    pose: { pos: [9, 5, 14], target: [0, 5, 0], fov: 48 },
    look: LOOK_TIGHT, scNodes: [], energy: false,
    conceptSlugs: ['inference', 'token', 'context-window'],
  },
  {
    id: 'return', scene: 'world', kicker: 'STOP 10', title: 'Response',
    blurb: 'The response streams back a few hundred milliseconds after submission. Every stage on this page happened inside that gap.',
    beat: 'A few hundred milliseconds, end to end.',
    scaleLabel: 'about 1.5 metres across',
    pose: { pos: [0, 2.2, 12], target: [0, 0.4, -1], fov: 48 },
    look: LOOK_TIGHT, scNodes: [], energy: false,
  },
];

export const STOP_BY_ID: ReadonlyMap<StopId, Stop> = new Map(STOPS.map((s) => [s.id, s]));

export function stopAt(index: number): Stop | null {
  const id = STOP_ORDER[index];
  return id ? STOP_BY_ID.get(id) ?? null : null;
}

// Integrity guard, dev only, mirroring lib/supply-chain/map.ts. A stop that names a slug
// which no longer exists in the supply-chain map should be a loud startup failure, not a
// silently empty drawer.
if (process.env.NODE_ENV !== 'production') {
  const missingStops = STOP_ORDER.filter((id) => !STOP_BY_ID.has(id));
  if (missingStops.length) {
    throw new Error(`traceroute/stops: STOP_ORDER references undefined stops: ${missingStops.join(', ')}`);
  }
  if (STOPS.length !== STOP_ORDER.length) {
    throw new Error(`traceroute/stops: ${STOPS.length} stops defined but STOP_ORDER has ${STOP_ORDER.length}`);
  }
  for (const s of STOPS) {
    for (const slug of s.scNodes) {
      if (!SC_NODE_BY_SLUG.has(slug)) {
        throw new Error(`traceroute/stops: stop "${s.id}" references unknown supply-chain slug "${slug}"`);
      }
    }
  }
}
