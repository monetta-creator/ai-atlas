// Every clickable object in the `world` scene, described as data.
//
// Geometry is DESCRIBED here and BUILT by lib/traceroute/scene-world.ts. Nothing is
// imported from a modelling tool: each prop is a primitive (box, slab, disc, cylinder,
// extruded profile) or a lattice of one via `repeat`. That constraint is deliberate. It
// keeps the whole world in version control as readable text, keeps the visual register
// consistent by construction, and removes an asset pipeline from the critical path.
//
// Coordinates are STOP-LOCAL. Each stop spans roughly 10 to 20 units regardless of its
// real size; Stop.scaleLabel carries the truth ("about 90 metres end to end"). Y is up.
// The camera's resting forward direction is -Z.
//
// `repeat` is what makes a hall of racks or a die of tiles affordable: the renderer emits
// one InstancedMesh per repeated prop, so a thousand objects cost one draw call.
//
// The architecture and inference stops live in the `silicon` scene and take their parts
// from lib/traceroute/architecture.ts instead. They have no entries here.

import type { PropDetail } from './geometry';
import type { Anchor, MaterialKey, PropId, StopId } from './types';

export type PropKind = 'box' | 'slab' | 'disc' | 'cylinder' | 'extrude' | 'grid';

export interface Prop {
  id: PropId;
  stop: StopId;
  label: string;
  /** One or two sentences. No em dashes. */
  blurb: string;
  kind: PropKind;
  /** Width, height, depth in stop-local units. */
  size: [number, number, number];
  /** Centre position at rest. */
  at: [number, number, number];
  /** Euler rotation in radians. */
  rot?: [number, number, number];
  /** Explode offset. The renderer lerps `at` -> `at + explodeTo` on a single 0..1 scalar. */
  explodeTo?: [number, number, number];
  material: MaterialKey;
  /** Lattice: how many copies, and the spacing between them. */
  repeat?: { count: [number, number, number]; pitch: [number, number, number] };
  anchor?: Anchor;
  /** Sub-features built by lib/traceroute/geometry.ts. Skipped for repeated props. */
  detail?: PropDetail;
  /** Part of the power path, lit by the energy overlay. */
  energy?: boolean;
  /** Suppress the click target. Pure set dressing, no drawer. */
  passive?: boolean;
}

export const PROPS: Prop[] = [
  // ---------------------------------------------------------------- STOP 0 · desk
  {
    id: 'desk.surface', stop: 'desk', label: 'The desk', kind: 'slab',
    blurb: 'The client end of the request.',
    size: [16, 0.4, 8], at: [0, -1.2, 0], material: 'enclosure', passive: true,
  },
  {
    id: 'desk.laptop', stop: 'desk', label: 'The client machine', kind: 'box',
    blurb: 'Ample for compilation, video, games. Two orders of magnitude short for inference.',
    size: [6, 0.3, 4], at: [0, -0.85, 0], material: 'metal',
    detail: 'ports',
  },
  {
    id: 'desk.screen', stop: 'desk', label: 'The screen', kind: 'slab',
    blurb: 'Where the prompt is typed and the response streams back.',
    size: [6, 3.8, 0.2], at: [0, 1.1, -1.9], rot: [-0.12, 0, 0], material: 'glass',
    detail: 'screen',
  },
  {
    id: 'desk.router', stop: 'desk', label: 'The router', kind: 'box',
    blurb: 'First hop. The prompt leaves as TLS-encrypted packets.',
    size: [2.2, 0.5, 1.4], at: [6.5, -0.75, 1.5], material: 'enclosure',
    anchor: { conceptSlug: 'inference' },
    detail: 'ports',
  },

  // ---------------------------------------------------------------- STOP 1 · machine
  {
    id: 'machine.board', stop: 'machine', label: 'The mainboard', kind: 'slab',
    blurb: 'Carries the CPU, memory, and expansion slots. None of it holds model weights.',
    size: [14, 0.3, 10], at: [0, 0, 0], material: 'pcb', passive: true,
  },
  {
    id: 'machine.cpu', stop: 'machine', label: 'The CPU', kind: 'box',
    blurb: 'A few wide general-purpose cores. Inference wants thousands of narrow ones.',
    size: [2.4, 0.5, 2.4], at: [-2.5, 0.4, -1], explodeTo: [0, 3, 0], material: 'silicon',
    anchor: { conceptSlug: 'compute' },
    detail: 'fins',
  },
  {
    id: 'machine.ram', stop: 'machine', label: 'System memory', kind: 'box',
    blurb: '16 to 32 GB at roughly 50 GB/s. HBM on an accelerator runs past 3 TB/s.',
    size: [0.6, 2.4, 5], at: [1.5, 1.2, -1], explodeTo: [0, 2.5, 0], material: 'pcb',
    repeat: { count: [4, 1, 1], pitch: [1.1, 0, 0] },
    anchor: { conceptSlug: 'parameters' },
  },
  {
    id: 'machine.gpu', stop: 'machine', label: 'Consumer GPU', kind: 'slab',
    blurb: 'Correct architecture, roughly 100x short on memory capacity and bandwidth.',
    size: [8, 1.4, 3.4], at: [0, 0.9, 2.6], explodeTo: [0, 4, 3], material: 'metal',
    anchor: { conceptSlug: 'compute' },
    detail: 'fins',
  },
  {
    id: 'machine.nic', stop: 'machine', label: 'The network interface', kind: 'box',
    blurb: 'Hands the request to the network stack.',
    size: [2, 0.4, 1.6], at: [5, 0.35, 3.2], explodeTo: [4, 1, 2], material: 'accent',
    detail: 'ports',
  },
  {
    id: 'machine.psu', stop: 'machine', label: 'Power supply', kind: 'box',
    blurb: 'A few hundred watts, versus tens of megawatts at the other end.',
    size: [3.4, 2, 3], at: [-5.5, 1, 3], material: 'enclosure', energy: true,
    anchor: { scSlug: 'power-components' },
    detail: 'fan',
  },

  // ---------------------------------------------------------------- STOP 2 · grid
  {
    id: 'grid.wall', stop: 'grid', label: 'The wall', kind: 'slab',
    blurb: 'Power enters and data leaves across the same boundary.',
    size: [20, 12, 0.6], at: [0, 3, -4], material: 'concrete', passive: true,
  },
  {
    id: 'grid.meter', stop: 'grid', label: 'The meter', kind: 'box',
    blurb: 'Household draw. One AI cabinet exceeds it many times over.',
    size: [1.4, 2, 0.8], at: [-4, 3.5, -3.4], material: 'enclosure', energy: true,
    detail: 'screen',
  },
  {
    id: 'grid.panel', stop: 'grid', label: 'The breaker panel', kind: 'box',
    blurb: 'Splits the service into branch circuits.',
    size: [1.8, 2.6, 0.6], at: [-1, 3.2, -3.5], material: 'metal', energy: true,
    detail: 'slots',
  },
  {
    id: 'grid.drop', stop: 'grid', label: 'The service line', kind: 'cylinder',
    blurb: 'Low-voltage service from the street transformer.',
    size: [0.25, 14, 0.25], at: [-7, 6, -3], rot: [0, 0, 0.35], material: 'copper', energy: true,
    anchor: { scSlug: 'facility-systems' },
  },
  {
    id: 'grid.fiber', stop: 'grid', label: 'The data line', kind: 'cylinder',
    blurb: 'Single-mode fibre. The prompt travels as modulated light.',
    size: [0.18, 16, 0.18], at: [6, 4, -3], rot: [0, 0, -0.28], material: 'accent',
  },
  {
    id: 'grid.substation', stop: 'grid', label: 'The substation', kind: 'box',
    blurb: 'Steps transmission voltage down for local distribution.',
    size: [5, 3, 4], at: [-14, 1.5, -16], material: 'metal', energy: true,
    anchor: { scSlug: 'facility-systems' },
  },

  // ---------------------------------------------------------------- STOP 3 · campus
  {
    id: 'campus.hall', stop: 'campus', label: 'The data hall', kind: 'box',
    blurb: 'Purpose-built shell, tens of thousands of square metres of white space.',
    size: [16, 3.5, 9], at: [0, 1.75, 0], material: 'concrete',
    repeat: { count: [2, 1, 1], pitch: [18, 0, 0] },
    anchor: { scSlug: 'hyperscale-operators' },
    detail: 'slots',
  },
  {
    id: 'campus.substation', stop: 'campus', label: 'The substation', kind: 'box',
    blurb: 'Dedicated high-voltage intake. Site selection now follows available power.',
    size: [7, 2.5, 5], at: [-16, 1.25, 9], material: 'metal', energy: true,
    anchor: { scSlug: 'facility-systems' },
  },
  {
    id: 'campus.cooling', stop: 'campus', label: 'The cooling plant', kind: 'box',
    blurb: 'Chillers and heat rejection. Thermal load equals electrical load.',
    size: [4, 2, 10], at: [12, 1, 10], material: 'metal', energy: true,
    repeat: { count: [3, 1, 1], pitch: [5, 0, 0] },
    anchor: { scSlug: 'thermal-cooling' },
    detail: 'fins',
  },
  {
    id: 'campus.generators', stop: 'campus', label: 'Backup generators', kind: 'box',
    blurb: 'Standby diesel behind the UPS, sized for the full critical load.',
    size: [2.4, 1.6, 5], at: [-8, 0.8, 13], material: 'enclosure', energy: true,
    repeat: { count: [6, 1, 1], pitch: [3, 0, 0] },
  },
  {
    id: 'campus.fiber', stop: 'campus', label: 'The fiber vault', kind: 'box',
    blurb: 'Carrier entry vault. Where the request actually arrives.',
    size: [2, 1, 2], at: [20, 0.5, -6], material: 'accent',
  },

  // ---------------------------------------------------------------- STOP 4 · hall
  {
    id: 'hall.floor', stop: 'hall', label: 'The floor', kind: 'slab',
    blurb: 'Raised, so air and cable can move underneath. Rated for a load most office buildings could not carry.',
    size: [40, 0.4, 24], at: [0, -0.2, 0], material: 'concrete', passive: true,
  },
  {
    id: 'hall.row', stop: 'hall', label: 'A row of racks', kind: 'box',
    blurb: 'Cabinets in rows, tens per row. Density is the constraint, not floor area.',
    size: [1.2, 4, 2.4], at: [-15, 2, -6], material: 'metal',
    repeat: { count: [12, 1, 4], pitch: [2.6, 0, 6] },
    anchor: { scSlug: 'hyperscale-operators' },
    detail: 'slots',
  },
  {
    id: 'hall.containment', stop: 'hall', label: 'Aisle containment', kind: 'slab',
    blurb: 'Hot-aisle containment. Mixing supply and return air wastes capacity.',
    size: [32, 0.3, 2.4], at: [0, 4.2, -6], material: 'glass',
    repeat: { count: [1, 1, 4], pitch: [0, 0, 6] },
    anchor: { scSlug: 'thermal-cooling' },
  },
  {
    id: 'hall.busway', stop: 'hall', label: 'Overhead busway', kind: 'box',
    blurb: 'Overhead busway with per-cabinet tap boxes. An AI rack can draw over 100 kW.',
    size: [34, 0.5, 0.5], at: [0, 5.4, -6], material: 'copper', energy: true,
    repeat: { count: [1, 1, 4], pitch: [0, 0, 6] },
    anchor: { scSlug: 'power-components' },
  },
  {
    id: 'hall.crah', stop: 'hall', label: 'Air handlers', kind: 'box',
    blurb: 'Computer-room air handlers. Increasingly bypassed for direct liquid.',
    size: [2.4, 4, 2], at: [19, 2, 0], material: 'metal', energy: true,
    repeat: { count: [1, 1, 5], pitch: [0, 0, 5] },
    anchor: { scSlug: 'thermal-cooling' },
    detail: 'fins',
  },

  // ---------------------------------------------------------------- STOP 5 · rack
  {
    id: 'rack.frame', stop: 'rack', label: 'The cabinet', kind: 'box',
    blurb: 'A 19-inch, 42U to 48U cabinet. The form factor predates the industry.',
    size: [6, 14, 8], at: [0, 7, 0], material: 'metal', passive: true,
    detail: 'slots',
  },
  {
    id: 'rack.node', stop: 'rack', label: 'A compute node', kind: 'slab',
    blurb: 'One node: eight accelerators, two host CPUs, NVMe, and the fabric NICs.',
    size: [5.6, 1.1, 7.6], at: [0, 2, 0], explodeTo: [0, 0, 9], material: 'enclosure',
    repeat: { count: [1, 8, 1], pitch: [0, 1.5, 0] },
    anchor: { scSlug: 'reference-systems' },
  },
  {
    id: 'rack.pdu', stop: 'rack', label: 'Power distribution', kind: 'box',
    blurb: 'Rack PDU feeding every node. Redundant A and B sides.',
    size: [0.7, 13, 0.7], at: [3.2, 7, 3.4], material: 'copper', energy: true,
    anchor: { scSlug: 'power-components' },
  },
  {
    id: 'rack.switch', stop: 'rack', label: 'The fabric switch', kind: 'slab',
    blurb: 'Scale-up fabric. The accelerators address each other as one device.',
    size: [5.6, 1.1, 7.6], at: [0, 13, 0], explodeTo: [0, 2, 6], material: 'metal',
    anchor: { scSlug: 'reference-systems' },
    detail: 'ports',
  },
  {
    id: 'rack.manifold', stop: 'rack', label: 'Coolant manifold', kind: 'cylinder',
    blurb: 'Direct-to-chip liquid loop. Air fails past roughly a kilowatt per package.',
    size: [0.5, 13, 0.5], at: [-3.2, 7, 3.4], material: 'copper', energy: true,
    anchor: { scSlug: 'thermal-cooling' },
  },

  // ---------------------------------------------------------------- STOP 6 · board
  {
    id: 'board.pcb', stop: 'board', label: 'The board', kind: 'slab',
    blurb: 'Twenty-plus layers, impedance-controlled, thousands of length-matched signals.',
    size: [18, 0.4, 12], at: [0, 0, 0], material: 'pcb',
    anchor: { scSlug: 'substrate-makers' },
    detail: 'layers',
  },
  {
    id: 'board.package', stop: 'board', label: 'The accelerator package', kind: 'box',
    blurb: 'Compute die plus HBM on an interposer. The output of the whole supply chain.',
    size: [5.5, 0.8, 5.5], at: [0, 0.6, 0], explodeTo: [0, 5, 0], material: 'silicon',
    anchor: { scSlug: 'cowos-packaging' },
  },
  {
    id: 'board.hbm', stop: 'board', label: 'Memory stacks', kind: 'box',
    blurb: 'High-bandwidth memory beside the die. The weights are resident here during inference.',
    size: [1.6, 0.7, 2.6], at: [4.2, 0.55, 0], explodeTo: [4, 4, 0], material: 'silicon',
    repeat: { count: [2, 1, 2], pitch: [-8.4, 0, 3.4] },
    anchor: { scSlug: 'hbm-trio', conceptSlug: 'parameters' },
  },
  {
    id: 'board.vrm', stop: 'board', label: 'Voltage regulators', kind: 'box',
    blurb: 'Multiphase regulation: hundreds of amps under a volt, with microsecond transients.',
    size: [1.2, 0.7, 1.2], at: [-7, 0.55, 4], material: 'copper', energy: true,
    repeat: { count: [1, 1, 4], pitch: [0, 0, -2.4] },
    anchor: { scSlug: 'power-components' },
  },
  {
    id: 'board.coldplate', stop: 'board', label: 'The cold plate', kind: 'slab',
    blurb: 'Cold plate on the package lid, carrying roughly a kilowatt into the loop.',
    size: [8, 0.6, 8], at: [0, 2.2, 0], explodeTo: [0, 7, 0], material: 'metal', energy: true,
    anchor: { scSlug: 'thermal-cooling' },
    detail: 'fins',
  },
  {
    id: 'board.connector', stop: 'board', label: 'The fabric connector', kind: 'box',
    blurb: 'Scale-up link to the other seven boards in the node.',
    size: [3.5, 0.9, 0.8], at: [0, 0.6, -5.4], material: 'accent',
  },

  // ---------------------------------------------------------------- STOP 7 · die
  {
    id: 'die.lid', stop: 'die', label: 'The lid', kind: 'slab',
    blurb: 'Integrated heat spreader, lifted off the package.',
    size: [12, 0.6, 12], at: [0, 3.2, 0], explodeTo: [0, 8, 0], material: 'metal',
  },
  {
    id: 'die.interposer', stop: 'die', label: 'The interposer', kind: 'slab',
    blurb: 'Passive silicon carrying die-to-die wiring at a pitch organic substrate cannot reach.',
    size: [11, 0.35, 11], at: [0, 0, 0], material: 'substrate',
    anchor: { scSlug: 'cowos-packaging' },
    detail: 'layers',
  },
  {
    id: 'die.compute', stop: 'die', label: 'The compute die', kind: 'grid',
    blurb: 'A lattice of near-identical tiles, each thousands of multiply-accumulate units.',
    size: [0.62, 0.3, 0.62], at: [-2.4, 0.35, -2.4], material: 'silicon',
    repeat: { count: [9, 1, 9], pitch: [0.68, 0, 0.68] },
    anchor: { scSlug: 'tsmc-leading-edge', conceptSlug: 'compute' },
  },
  {
    id: 'die.hbm-stack', stop: 'die', label: 'A memory stack', kind: 'box',
    blurb: 'Eight to twelve DRAM dies stacked, joined by through-silicon vias.',
    size: [2.6, 1.2, 4], at: [4.2, 0.75, 0], explodeTo: [5, 3, 0], material: 'silicon',
    repeat: { count: [2, 1, 1], pitch: [-8.4, 0, 0] },
    anchor: { scSlug: 'hbm-trio' },
    detail: 'layers',
  },
  {
    id: 'die.microbump', stop: 'die', label: 'Microbumps', kind: 'grid',
    blurb: 'Tens of thousands of joints at tens of microns pitch.',
    size: [0.12, 0.16, 0.12], at: [-2.4, -0.24, -2.4], material: 'copper',
    repeat: { count: [17, 1, 17], pitch: [0.34, 0, 0.34] },
    anchor: { scSlug: 'litho-euv' },
  },

  // ---------------------------------------------------------------- STOP 10 · return
  {
    id: 'return.laptop', stop: 'return', label: 'The client machine', kind: 'box',
    blurb: 'Idle throughout. The round trip is a few hundred milliseconds.',
    size: [6, 0.3, 4], at: [0, -0.85, 0], material: 'metal',
  },
  {
    id: 'return.screen', stop: 'return', label: 'The answer', kind: 'slab',
    blurb: 'Tokens stream back as they are sampled, not as a finished block.',
    size: [6, 3.8, 0.2], at: [0, 1.1, -1.9], rot: [-0.12, 0, 0], material: 'accent',
    detail: 'screen',
  },
];

export const PROP_BY_ID: ReadonlyMap<PropId, Prop> = new Map(PROPS.map((p) => [p.id, p]));

export const PROPS_BY_STOP: ReadonlyMap<StopId, Prop[]> = (() => {
  const m = new Map<StopId, Prop[]>();
  for (const p of PROPS) {
    const list = m.get(p.stop);
    if (list) list.push(p);
    else m.set(p.stop, [p]);
  }
  return m;
})();

/** Props on the power path, for the energy overlay. */
export const ENERGY_PROPS: ReadonlyMap<StopId, Prop[]> = (() => {
  const m = new Map<StopId, Prop[]>();
  for (const p of PROPS) {
    if (!p.energy) continue;
    const list = m.get(p.stop);
    if (list) list.push(p);
    else m.set(p.stop, [p]);
  }
  return m;
})();
