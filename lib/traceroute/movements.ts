// Four movements.
//
// The ten stops in ./stops are camera waypoints: real places, kept because the 3D journey
// travels through them and because their objects are what actually teach. But a reader does
// not want eleven numbered exhibits with names like "The hall". That reads as a table of
// contents, and nobody follows a table of contents.
//
// So the places stay as content and the READER sees four movements, each titled with a claim
// rather than a label. The reader learns what a rack is by looking at one inside "It leaves
// the building", not by arriving at a heading that says "The rack".
//
// Each movement owns its own prose. Concatenating the stops' blurbs would read like stitched
// captions, so the lede is written once, for the movement, at the altitude a reader actually
// travels at.

import type { StopId } from './types';

export type MovementId = 'here' | 'away' | 'narrow' | 'running';

export interface Movement {
  id: MovementId;
  /** A claim, never a noun. This is the fix for "don't call out sections like the hall". */
  title: string;
  /** Two or three sentences at reading altitude. No em dashes. */
  lede: string;
  /** Camera waypoints this movement travels through. Not shown as headings. */
  stops: StopId[];
  /** Rail label, shorter than the title. */
  short: string;
}

export const MOVEMENTS: Movement[] = [
  {
    id: 'here',
    short: 'Weights',
    title: 'Local hardware cannot hold the weights',
    lede: "A frontier model's parameters run to hundreds of gigabytes and need memory bandwidth measured in terabytes per second. Consumer hardware has neither, so the client sends an HTTPS request instead of running anything.",
    stops: ['desk', 'machine'],
  },
  {
    id: 'away',
    short: 'Datacenter',
    title: 'The request routes to a datacenter',
    lede: 'Out over fibre to a facility with its own substation, chiller plant, and tens of megawatts of contracted power. Inside, rows of cabinets under overhead busway and hot-aisle containment.',
    stops: ['grid', 'campus', 'hall'],
  },
  {
    id: 'narrow',
    short: 'Accelerator',
    title: 'It lands on one accelerator',
    lede: 'One rack, one node, one board. The package holds a compute die and HBM stacks bonded to a silicon interposer, under a cold plate that carries off roughly a kilowatt.',
    stops: ['rack', 'board', 'die'],
  },
  {
    id: 'running',
    short: 'Forward pass',
    title: 'One forward pass per token',
    lede: 'The prompt is tokenised, embedded, and pushed through every transformer block. The output head produces logits over the vocabulary, one token is sampled, and the pass repeats with that token appended.',
    stops: ['architecture', 'inference', 'return'],
  },
];

if (process.env.NODE_ENV !== 'production') {
  const seen = new Set<StopId>();
  for (const mv of MOVEMENTS) {
    for (const s of mv.stops) {
      if (seen.has(s)) throw new Error(`traceroute/movements: stop "${s}" is in two movements`);
      seen.add(s);
    }
  }
}
