// The AI economy supply chain, as a static layered graph.
//
// This is the structural source of truth for the /supply-chain surface: the layers,
// the nodes (curated from docs/ai-supply-chain-map.md), and the cross-layer dependency
// edges. It is intentionally dependency-free (no DB, no 'use server') so it can be
// imported by both the server read layer and, indirectly, the client renderer.
//
// The HYBRID model: this file owns the immutable structure; the database owns only the
// mutable overlay (per-node risk_level + admin_note) and node->signal links, keyed by
// the node `slug` and resolved at read time (the same pattern as concept_claims and
// signals.claim_touches). A node removed here just leaves harmless, never-resolved
// overlay rows behind.
//
// Risk is a STUB: `riskDefault` is a hand-set starting value, never a computed score.
// The effective risk a reader sees is `overlay.risk_level ?? riskDefault`.

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

// The vertical spine (layers 0-15) reads upstream to downstream. The cross-cutting
// band sits apart because those concerns touch every tier (representing that as edges
// would be a hairball), so they carry no inter-tier flow.
export type Band = 'spine' | 'crosscutting';

export interface ScLayer {
  index: number; // matches ScNode.layer
  band: Band;
  title: string; // shown as the tier band label, e.g. "Memory"
}

export interface ScNode {
  slug: string; // stable key, kebab-case, globally unique (also the DB overlay/link key)
  layer: number; // 0-15 for the spine; 16 for the cross-cutting band
  band: Band;
  name: string; // full name, the drawer title
  label: string; // short label drawn in the node box (may wrap to two lines)
  actors: string[]; // representative firms or inputs from the doc
  isChokepoint: boolean; // a tier controlled by 1-3 firms (the doc's [CHOKEPOINT] mark)
  riskDefault: RiskLevel; // hand-set stub; effective risk = overlay ?? this
  blurb?: string; // one or two sentences for the drawer, no em dashes
}

export interface ScEdge {
  from: string; // upstream node slug (the input)
  to: string; // downstream node slug (the consumer)
  emphasis?: boolean; // a chokepoint dependency, drawn heavier at rest
}

// The view model the renderer consumes: a node plus its (effective) risk and the
// signal aggregates. In Phase 1 these come from the static defaults; the DB read layer
// overrides `risk` and fills the signal fields.
export interface ScNodeView extends ScNode {
  risk: RiskLevel;
  signalCount: number;
  hasRecentSignal: boolean;
}

export const SC_LAYERS: ScLayer[] = [
  { index: 0, band: 'spine', title: 'Raw materials & feedstocks' },
  { index: 1, band: 'spine', title: 'Manufacturing equipment' },
  { index: 2, band: 'spine', title: 'Chip design, IP & tools' },
  { index: 3, band: 'spine', title: 'Fabrication (foundries)' },
  { index: 4, band: 'spine', title: 'Memory' },
  { index: 5, band: 'spine', title: 'Advanced packaging & test' },
  { index: 6, band: 'spine', title: 'Interconnect & networking' },
  { index: 7, band: 'spine', title: 'Systems, servers & racks' },
  { index: 8, band: 'spine', title: 'Data centers' },
  { index: 9, band: 'spine', title: 'Energy & power' },
  { index: 10, band: 'spine', title: 'Cloud & compute provisioning' },
  { index: 11, band: 'spine', title: 'Data' },
  { index: 12, band: 'spine', title: 'Foundation models & training' },
  { index: 13, band: 'spine', title: 'Deployment & middleware' },
  { index: 14, band: 'spine', title: 'Applications & end products' },
  { index: 15, band: 'spine', title: 'End users & demand' },
  { index: 16, band: 'crosscutting', title: 'Cross-cutting, touches every tier' },
];

export const SC_NODES: ScNode[] = [
  // ---- LAYER 0 — Raw materials & feedstocks ----
  { slug: 'quartz-crucible', layer: 0, band: 'spine', name: 'High-purity quartz & crucibles', label: 'Quartz / crucibles',
    actors: ['Sibelco', 'The Quartz Corp', 'Spruce Pine, NC'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'High-purity quartz for ingot crucibles is concentrated in one region, Spruce Pine, North Carolina. A quiet single point of failure for wafer growth.' },
  { slug: 'silicon-wafers', layer: 0, band: 'spine', name: 'Silicon wafers', label: 'Silicon wafers',
    actors: ['Shin-Etsu', 'SUMCO', 'GlobalWafers', 'Siltronic', 'SK Siltron'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Polished monocrystalline wafers, the blank canvas every chip starts from. Five makers, heavily Japan and Taiwan weighted.' },
  { slug: 'process-gases', layer: 0, band: 'spine', name: 'Specialty & process gases', label: 'Process gases',
    actors: ['Linde', 'Air Liquide', 'Air Products', 'neon (Ukraine)'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Neon, argon, helium and reactive gases for lithography lasers, deposition and etch. Neon supply was historically tied to Ukraine.' },
  { slug: 'photoresist', layer: 0, band: 'spine', name: 'Photoresists & wet chemicals', label: 'Photoresist',
    actors: ['JSR', 'Tokyo Ohka', 'Shin-Etsu', 'Sumitomo', 'Fujifilm', 'DuPont'], isChokepoint: true, riskDefault: 'high',
    blurb: 'Light-sensitive films and ultra-pure chemicals, Japanese dominated. EUV resist in particular is a constrained chokepoint.' },
  { slug: 'critical-minerals', layer: 0, band: 'spine', name: 'Metals & critical minerals', label: 'Critical minerals',
    actors: ['copper', 'tungsten', 'cobalt', 'gallium', 'germanium', 'rare earths'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Interconnect metals, dopants, and rare earths for magnets. Several face Chinese export controls (gallium, germanium, rare earths).' },
  { slug: 'abf-resin', layer: 0, band: 'spine', name: 'ABF substrate film', label: 'ABF film',
    actors: ['Ajinomoto'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'Ajinomoto Build-up Film is a single-supplier resin essential to high-end chip substrates. One company, no real substitute.' },
  { slug: 'cooling-fluids', layer: 0, band: 'spine', name: 'Cooling & facility fluids', label: 'Cooling fluids',
    actors: ['dielectric / immersion fluids', 'glycol', 'water'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Dielectric immersion fluids, two-phase coolants and large volumes of water for the systems and the buildings.' },

  // ---- LAYER 1 — Semiconductor manufacturing equipment ----
  { slug: 'litho-euv', layer: 1, band: 'spine', name: 'EUV & DUV lithography', label: 'Lithography',
    actors: ['ASML (sole EUV)', 'Nikon', 'Canon', 'Zeiss optics', 'Cymer'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'ASML is the only maker of EUV scanners, including High-NA. The single hardest tool in the chain to replace.' },
  { slug: 'deposition-etch', layer: 1, band: 'spine', name: 'Deposition & etch tools', label: 'Deposition & etch',
    actors: ['Applied Materials', 'Lam Research', 'Tokyo Electron'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The tools that lay down and carve away thin films. Three vendors plus ASML form the big four of the equipment world.' },
  { slug: 'metrology-inspection', layer: 1, band: 'spine', name: 'Process control, metrology & inspection', label: 'Metrology',
    actors: ['KLA (dominant)', 'Applied', 'Hitachi High-Tech', 'Onto'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Measuring and inspecting wafers to hold yield. KLA dominates the category.' },
  { slug: 'mask-reticle', layer: 1, band: 'spine', name: 'Masks & reticles', label: 'Masks / reticles',
    actors: ['Hoya', 'AGC', 'pellicles', 'mask writers'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Photomask blanks, pellicles and mask writers, the stencils a lithography tool prints from.' },
  { slug: 'test-assembly-equip', layer: 1, band: 'spine', name: 'Test & assembly equipment', label: 'Test & assembly',
    actors: ['Teradyne', 'Advantest', 'die bonders', 'wire bonders'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Automated test equipment, probe cards and bonders that sort and package finished die.' },

  // ---- LAYER 2 — Chip design, IP & tools ----
  { slug: 'eda-tools', layer: 2, band: 'spine', name: 'EDA software', label: 'EDA tools',
    actors: ['Synopsys', 'Cadence', 'Siemens EDA'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'The three-way oligopoly of design software required to lay out any advanced chip. You cannot tape out without them.' },
  { slug: 'ip-cores', layer: 2, band: 'spine', name: 'IP cores & instruction sets', label: 'IP cores / ISAs',
    actors: ['Arm', 'RISC-V', 'Synopsys IP', 'Cadence IP'], isChokepoint: true, riskDefault: 'high',
    blurb: 'Licensable CPU and GPU IP plus the underlying instruction sets. Arm is a chokepoint for Arm-based designs; RISC-V is the open alternative.' },
  { slug: 'merchant-accelerators', layer: 2, band: 'spine', name: 'Merchant AI accelerators', label: 'Merchant accelerators',
    actors: ['NVIDIA (Rubin, Blackwell)', 'AMD (MI400)', 'Intel (Gaudi)'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'The GPUs and accelerators sold on the open market. NVIDIA dominates training and sets the pace of the whole chain.' },
  { slug: 'hyperscaler-asics', layer: 2, band: 'spine', name: 'Hyperscaler custom silicon', label: 'Hyperscaler ASICs',
    actors: ['Google TPU', 'AWS Trainium', 'Microsoft Maia', 'Meta MTIA', 'OpenAI + Broadcom'], isChokepoint: false, riskDefault: 'high',
    blurb: 'In-house accelerators the cloud giants design to cut their dependence on merchant GPUs.' },
  { slug: 'asic-codesign', layer: 2, band: 'spine', name: 'ASIC co-design partners', label: 'ASIC co-design',
    actors: ['Broadcom', 'Marvell', 'Alchip', 'GUC', 'MediaTek'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'The arms dealers behind custom silicon. Broadcom and Marvell together hold roughly 95% of the custom-AI-ASIC co-design market.' },
  { slug: 'accelerator-challengers', layer: 2, band: 'spine', name: 'Accelerator challengers', label: 'Challengers',
    actors: ['Cerebras', 'Groq', 'SambaNova', 'Tenstorrent', 'd-Matrix', 'Etched'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Startups attacking the GPU with wafer-scale, inference-specialized or novel architectures.' },

  // ---- LAYER 3 — Fabrication (foundries) ----
  { slug: 'tsmc-leading-edge', layer: 3, band: 'spine', name: 'TSMC leading-edge foundry', label: 'TSMC',
    actors: ['TSMC (N2, ~90%+ of advanced)'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'Manufactures the large majority of advanced AI silicon at 7nm and below. Its concentration in Taiwan is the central geopolitical risk in the chain.' },
  { slug: 'other-leading-foundry', layer: 3, band: 'spine', name: 'Other leading-edge foundries', label: 'Samsung / Intel',
    actors: ['Samsung Foundry (SF2)', 'Intel Foundry (18A, 14A)'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The only other firms chasing 2nm-class logic, both years and yield behind TSMC.' },
  { slug: 'mature-foundry', layer: 3, band: 'spine', name: 'Mature & specialty foundries', label: 'Mature foundries',
    actors: ['GlobalFoundries', 'UMC', 'SMIC', 'Tower', 'PSMC'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Trailing-edge logic, power management, analog and RF, the unglamorous parts every board still needs.' },
  { slug: 'idm-fabs', layer: 3, band: 'spine', name: 'Captive & IDM fabs', label: 'IDM fabs',
    actors: ['Intel', 'Samsung', 'Micron', 'SK Hynix', 'TI'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Firms that fabricate their own silicon in house, including the memory makers.' },
  { slug: 'fab-buildout', layer: 3, band: 'spine', name: 'Fab build-out', label: 'Fab build-out',
    actors: ['cleanroom construction', 'ultrapure water', 'CHIPS Act subsidies'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Building and qualifying the fabs themselves, subsidized by US, EU, Japanese, Korean and Indian chip programs.' },

  // ---- LAYER 4 — Memory ----
  { slug: 'hbm-trio', layer: 4, band: 'spine', name: 'High-bandwidth memory (HBM)', label: 'HBM',
    actors: ['SK Hynix (~50-62%)', 'Samsung', 'Micron'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'Only three suppliers. HBM4 is the standard for NVIDIA Rubin and AMD MI450, and capacity is sold out through 2026 and beyond.' },
  { slug: 'dram', layer: 4, band: 'spine', name: 'DRAM', label: 'DRAM',
    actors: ['SK Hynix', 'Samsung', 'Micron'], isChokepoint: false, riskDefault: 'high',
    blurb: 'DDR5 system memory and LPDDR5X for CPUs, from the same three makers. In a shortage as AI soaks up allocation.' },
  { slug: 'nand-ssd', layer: 4, band: 'spine', name: 'NAND flash & SSDs', label: 'NAND / SSD',
    actors: ['Samsung', 'SK Hynix', 'Micron', 'Kioxia', 'SanDisk / WD'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Hot storage for datasets and checkpoints.' },

  // ---- LAYER 5 — Advanced packaging & test ----
  { slug: 'cowos-packaging', layer: 5, band: 'spine', name: 'TSMC CoWoS advanced packaging', label: 'CoWoS',
    actors: ['TSMC CoWoS', 'SoIC', 'InFO'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'The current physical bottleneck, assembling logic and HBM onto one interposer. NVIDIA has booked over half of TSMC capacity.' },
  { slug: 'packaging-blocks', layer: 5, band: 'spine', name: 'Packaging building blocks', label: 'Packaging blocks',
    actors: ['TSVs', 'interposers', 'hybrid bonding', 'FOPLP'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Through-silicon vias, interposers and the shift toward panel-level packaging that the advanced platforms are built from.' },
  { slug: 'osat', layer: 5, band: 'spine', name: 'Outsourced assembly & test (OSAT)', label: 'OSAT',
    actors: ['ASE', 'Amkor', 'JCET', 'Powertech', 'Tongfu'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The contract houses that package and test the chips fabs do not finish themselves.' },
  { slug: 'substrate-makers', layer: 5, band: 'spine', name: 'ABF substrate makers', label: 'Substrates',
    actors: ['Ibiden', 'Shinko', 'Unimicron', 'AT&S'], isChokepoint: true, riskDefault: 'high',
    blurb: 'The constrained makers of high-end ABF substrates that every advanced package sits on.' },
  { slug: 'idm-packaging', layer: 5, band: 'spine', name: 'IDM packaging', label: 'IDM packaging',
    actors: ['Intel (EMIB, Foveros)', 'Samsung (I-Cube, X-Cube)'], isChokepoint: false, riskDefault: 'low',
    blurb: 'In-house advanced packaging from the integrated device makers.' },

  // ---- LAYER 6 — Interconnect & networking ----
  { slug: 'scale-up-fabric', layer: 6, band: 'spine', name: 'Scale-up interconnect', label: 'Scale-up fabric',
    actors: ['NVLink', 'Infinity Fabric', 'UALink'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The fast fabric wiring accelerators together inside a rack. NVLink leads; UALink is the open challenge.' },
  { slug: 'scale-out-ethernet', layer: 6, band: 'spine', name: 'Scale-out Ethernet switching', label: 'Ethernet',
    actors: ['Broadcom (~80% high-end)', 'Tomahawk', 'Arista', 'Cisco'], isChokepoint: true, riskDefault: 'high',
    blurb: 'Rack-to-rack networking. Broadcom holds roughly 80% of high-end Ethernet switching silicon.' },
  { slug: 'infiniband', layer: 6, band: 'spine', name: 'InfiniBand', label: 'InfiniBand',
    actors: ['NVIDIA Quantum', 'Spectrum-X'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The NVIDIA-led alternative to Ethernet for cluster-wide networking.' },
  { slug: 'nics-dpus', layer: 6, band: 'spine', name: 'NICs & DPUs', label: 'NICs / DPUs',
    actors: ['NVIDIA ConnectX, BlueField', 'AMD Pensando', 'Intel IPU'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The network adapters and data-processing units at each server edge.' },
  { slug: 'optics', layer: 6, band: 'spine', name: 'Optics & transceivers', label: 'Optics',
    actors: ['Coherent', 'Lumentum', 'InnoLight', 'Eoptolink', 'Fabrinet'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Pluggable transceivers, co-packaged optics and silicon photonics that carry the bits between machines.' },
  { slug: 'retimers-cabling', layer: 6, band: 'spine', name: 'Retimers, cabling & connectors', label: 'Retimers / cabling',
    actors: ['Astera Labs', 'Credo', 'Amphenol'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'PCIe and CXL retimers plus the copper and fiber that physically link the boxes.' },

  // ---- LAYER 7 — Systems, servers & racks ----
  { slug: 'reference-systems', layer: 7, band: 'spine', name: 'Reference systems', label: 'Reference systems',
    actors: ['NVIDIA DGX, GB200, NVL72', 'AMD Helios'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The rack-scale designs (NVL72, Helios) that define how a cluster is built.' },
  { slug: 'odm-integrators', layer: 7, band: 'spine', name: 'ODMs & system integrators', label: 'ODMs',
    actors: ['Foxconn', 'Quanta', 'Wiwynn', 'Supermicro', 'Dell', 'HPE', 'Lenovo'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The contract manufacturers and integrators that actually assemble the servers.' },
  { slug: 'power-components', layer: 7, band: 'spine', name: 'Board & in-rack power', label: 'Power components',
    actors: ['VRMs', 'PMICs', 'PSUs', 'busbars', 'in-rack BESS'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Voltage regulators, power supplies and busways that feed clean power to the silicon.' },
  { slug: 'thermal-cooling', layer: 7, band: 'spine', name: 'Thermal management', label: 'Cooling',
    actors: ['Vertiv', 'Boyd', 'CoolIT', 'Asetek', 'Motivair'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Cold plates, direct-to-chip liquid cooling and immersion, increasingly the limit on rack density.' },
  { slug: 'passives', layer: 7, band: 'spine', name: 'Passive components', label: 'Passives',
    actors: ['Murata', 'TDK', 'Samsung Electro-Mechanics', 'Yageo'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'MLCC capacitors, inductors and resistors. Tiny parts, enormous volumes.' },

  // ---- LAYER 8 — Data centers ----
  { slug: 'hyperscale-operators', layer: 8, band: 'spine', name: 'Hyperscale owner-operators', label: 'Hyperscalers',
    actors: ['Amazon', 'Microsoft', 'Google', 'Meta', 'Oracle'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The giants that own and run the largest AI data centers.' },
  { slug: 'colocation', layer: 8, band: 'spine', name: 'Colocation & wholesale', label: 'Colocation',
    actors: ['Equinix', 'Digital Realty', 'NTT', 'Vantage', 'QTS', 'Aligned'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Leased data-center space for those who do not build their own.' },
  { slug: 'neoclouds', layer: 8, band: 'spine', name: 'Neoclouds & GPU-first operators', label: 'Neoclouds',
    actors: ['CoreWeave', 'Nebius', 'Crusoe', 'Lambda', 'Together', 'Fluidstack'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'GPU-first operators that stood up dedicated AI capacity fast, often debt and GPU-collateral financed.' },
  { slug: 'dc-buildout', layer: 8, band: 'spine', name: 'Data-center build-out', label: 'DC build-out',
    actors: ['modular / prefab', 'AI factories', 'Microsoft Fairwater'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The construction of the buildings themselves, increasingly as modular AI factories.' },
  { slug: 'facility-systems', layer: 8, band: 'spine', name: 'Site & facility systems', label: 'Facility systems',
    actors: ['land & permitting', 'water rights', 'chillers', 'MEP engineering'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Land, permitting, water rights, cooling and mechanical-electrical-plumbing, the slow physical prerequisites.' },

  // ---- LAYER 9 — Energy & power ----
  { slug: 'gas-turbines', layer: 9, band: 'spine', name: 'Natural gas generation', label: 'Gas turbines',
    actors: ['GE Vernova', 'Siemens Energy', 'Mitsubishi Power'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Turbines and behind-the-meter gas plants for speed, with roughly three-year turbine lead times.' },
  { slug: 'nuclear-smr', layer: 9, band: 'spine', name: 'Nuclear & small modular reactors', label: 'Nuclear / SMR',
    actors: ['Constellation (Crane)', 'Talen', 'NuScale', 'Oklo', 'X-energy', 'Kairos'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Restarts of existing plants plus a growing pipeline of small modular reactor offtake, around 45 GW conditional.' },
  { slug: 'renewables-ppa', layer: 9, band: 'spine', name: 'Renewables & power purchase agreements', label: 'Renewables / PPAs',
    actors: ['solar', 'wind', 'geothermal (Fervo)', 'hydro'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Solar, wind and geothermal contracted through long-term power purchase agreements.' },
  { slug: 'grid-transformers', layer: 9, band: 'spine', name: 'Grid, transformers & interconnection', label: 'Grid / transformers',
    actors: ['Hitachi Energy', 'GE Vernova', 'Siemens Energy', 'Eaton'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'Transformers are in acute shortage and interconnection queues are a major delay. Power and the grid are now the binding constraint on AI growth.' },
  { slug: 'energy-storage', layer: 9, band: 'spine', name: 'Storage & fuel supply', label: 'Storage / fuel',
    actors: ['grid batteries (BESS)', 'gas pipelines', 'uranium / HALEU'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Grid-scale storage, long-duration storage and the fuel supply (pipelines, nuclear fuel) behind generation.' },

  // ---- LAYER 10 — Cloud & compute provisioning ----
  { slug: 'hyperscale-clouds', layer: 10, band: 'spine', name: 'Hyperscale clouds', label: 'Hyperscale clouds',
    actors: ['AWS', 'Azure', 'Google Cloud', 'Oracle Cloud'], isChokepoint: false, riskDefault: 'high',
    blurb: 'How most compute is sold and reached, the big four public clouds.' },
  { slug: 'gpu-neoclouds', layer: 10, band: 'spine', name: 'GPU clouds', label: 'GPU clouds',
    actors: ['CoreWeave', 'Nebius', 'Crusoe', 'Lambda', 'Together'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'GPU-first clouds selling capacity directly, often on multi-year contracts.' },
  { slug: 'inference-api-providers', layer: 10, band: 'spine', name: 'Inference & API providers', label: 'API providers',
    actors: ['Fireworks', 'Baseten', 'Replicate', 'Modal', 'lab APIs'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Providers that sell model inference by the token rather than raw machines.' },
  { slug: 'compute-contracts', layer: 10, band: 'spine', name: 'Commercial compute structures', label: 'Compute contracts',
    actors: ['reserved', 'on-demand', 'spot', 'capacity brokering'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The contracts and brokering that turn raw capacity into a tradable commodity.' },
  { slug: 'sovereign-compute', layer: 10, band: 'spine', name: 'Sovereign & government compute', label: 'Sovereign compute',
    actors: ['national clouds', 'state-backed clusters'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'National clouds and state-backed clusters standing up domestic AI capacity.' },

  // ---- LAYER 11 — Data ----
  { slug: 'training-data', layer: 11, band: 'spine', name: 'Training data sources', label: 'Training data',
    actors: ['Common Crawl', 'licensed content', 'first-party', 'synthetic'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Web crawl, licensed content, proprietary and synthetic data, carrying real copyright and licensing exposure.' },
  { slug: 'data-licensing', layer: 11, band: 'spine', name: 'Data licensing & marketplaces', label: 'Data licensing',
    actors: ['direct deals', 'data marketplaces'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Direct licensing deals and emerging marketplaces for training content.' },
  { slug: 'labeling-rlhf', layer: 11, band: 'spine', name: 'Labeling & human feedback', label: 'Labeling / RLHF',
    actors: ['Scale AI', 'Surge AI', 'Mercor', 'Turing', 'Invisible'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Annotation, preference data and expert feedback, the human labor behind post-training.' },
  { slug: 'data-engineering', layer: 11, band: 'spine', name: 'Data engineering', label: 'Data engineering',
    actors: ['curation', 'dedup', 'tokenization', 'lineage'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Curation, filtering, deduplication and pipelines that turn raw data into a training corpus.' },
  { slug: 'eval-safety-data', layer: 11, band: 'spine', name: 'Evaluation & safety data', label: 'Eval / safety data',
    actors: ['benchmarks', 'red-team sets', 'preference data'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Benchmarks, red-teaming sets and preference data used to measure and steer models.' },

  // ---- LAYER 12 — Foundation models & training ----
  { slug: 'frontier-labs', layer: 12, band: 'spine', name: 'Frontier model developers', label: 'Frontier labs',
    actors: ['OpenAI', 'Anthropic', 'Google DeepMind', 'Meta', 'xAI', 'Mistral', 'DeepSeek', 'Qwen'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The labs that build the core models, Western and Chinese.' },
  { slug: 'cuda-runtimes', layer: 12, band: 'spine', name: 'Accelerator runtimes', label: 'CUDA / runtimes',
    actors: ['CUDA', 'ROCm', 'CANN'], isChokepoint: true, riskDefault: 'critical',
    blurb: 'The low-level software that makes accelerators usable. CUDA is the deepest NVIDIA moat, a software chokepoint as much as the silicon.' },
  { slug: 'training-frameworks', layer: 12, band: 'spine', name: 'Training software stack', label: 'Frameworks',
    actors: ['PyTorch', 'JAX', 'Megatron', 'DeepSpeed', 'Triton'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Frameworks, distributed-training libraries and compilers that the labs train on.' },
  { slug: 'open-weight', layer: 12, band: 'spine', name: 'Open-weight ecosystem', label: 'Open weights',
    actors: ['Hugging Face', 'open-model community'], isChokepoint: false, riskDefault: 'low',
    blurb: 'The hubs and community around open-weight models.' },
  { slug: 'training-tooling', layer: 12, band: 'spine', name: 'Experiment & MLOps tooling', label: 'MLOps tooling',
    actors: ['Weights & Biases', 'orchestration', 'scheduling'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Experiment tracking, orchestration and scheduling around training runs.' },

  // ---- LAYER 13 — Deployment & middleware ----
  { slug: 'inference-serving', layer: 13, band: 'spine', name: 'Inference serving & optimization', label: 'Inference serving',
    actors: ['vLLM', 'TensorRT-LLM', 'SGLang'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'The engines that serve a trained model fast and cheaply.' },
  { slug: 'routing-gateways', layer: 13, band: 'spine', name: 'Routing & gateways', label: 'Routing / gateways',
    actors: ['model routers', 'API gateways'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Model routers and gateways that abstract over many models.' },
  { slug: 'retrieval-memory', layer: 13, band: 'spine', name: 'Retrieval & memory', label: 'Retrieval / memory',
    actors: ['Pinecone', 'Weaviate', 'Chroma', 'Milvus', 'pgvector'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Vector databases, embeddings and retrieval-augmented generation that give models context.' },
  { slug: 'agents-orchestration', layer: 13, band: 'spine', name: 'Agents & orchestration', label: 'Agents',
    actors: ['LangChain', 'LlamaIndex', 'CrewAI', 'MCP'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Agent frameworks, tool use and the Model Context Protocol that let models act.' },
  { slug: 'llmops', layer: 13, band: 'spine', name: 'Guardrails & observability', label: 'LLMOps',
    actors: ['LangSmith', 'Arize', 'guardrails', 'prompt management'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Guardrails, observability and prompt management for production deployments.' },

  // ---- LAYER 14 — Applications & end products ----
  { slug: 'horizontal-assistants', layer: 14, band: 'spine', name: 'Horizontal assistants & coding', label: 'Assistants',
    actors: ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Cursor', 'Claude Code'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The general assistants and coding tools most people actually touch.' },
  { slug: 'embedded-ai', layer: 14, band: 'spine', name: 'Embedded AI features', label: 'Embedded AI',
    actors: ['Microsoft 365', 'Google Workspace', 'Salesforce', 'Adobe', 'SAP'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'AI folded into the software suites enterprises already run.' },
  { slug: 'vertical-apps', layer: 14, band: 'spine', name: 'Vertical & domain apps', label: 'Vertical apps',
    actors: ['legal', 'healthcare', 'finance', 'support', 'education'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Domain-specific applications across regulated and specialist industries.' },
  { slug: 'agentic-systems', layer: 14, band: 'spine', name: 'Agentic systems', label: 'Agentic systems',
    actors: ['autonomous workflows', 'semi-autonomous workflows'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Autonomous and semi-autonomous workflows that chain the tools above.' },
  { slug: 'generative-media', layer: 14, band: 'spine', name: 'Generative media', label: 'Generative media',
    actors: ['image', 'video', 'audio', 'music', 'voice'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Image, video, audio and voice generation.' },
  { slug: 'physical-edge-ai', layer: 14, band: 'spine', name: 'Physical & edge AI', label: 'Physical / edge AI',
    actors: ['robotics', 'autonomous vehicles', 'drones (Jetson Thor)', 'AI PCs'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Robotics, autonomous vehicles, drones and on-device AI at the edge.' },

  // ---- LAYER 15 — End users & demand ----
  { slug: 'enterprises', layer: 15, band: 'spine', name: 'Enterprises & developers', label: 'Enterprises',
    actors: ['every industry vertical', 'software developers'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The businesses and developers whose adoption justifies the capex many layers upstream.' },
  { slug: 'governments', layer: 15, band: 'spine', name: 'Governments', label: 'Governments',
    actors: ['public sector', 'defense', 'sovereign programs'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Public-sector and sovereign demand.' },
  { slug: 'consumers', layer: 15, band: 'spine', name: 'Consumers', label: 'Consumers',
    actors: ['mass-market users'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Mass-market consumer use across assistants and embedded features.' },
  { slug: 'demand-signal', layer: 15, band: 'spine', name: 'Aggregate demand signal', label: 'Demand signal',
    actors: ['the pull that funds the chain'], isChokepoint: false, riskDefault: 'high',
    blurb: 'The aggregate demand that justifies, or fails to justify, the spending all the way upstream.' },

  // ---- Cross-cutting (touches every tier) ----
  { slug: 'capital-financing', layer: 16, band: 'crosscutting', name: 'Capital & financing', label: 'Capital',
    actors: ['hyperscaler capex ($600B+)', 'private credit', 'sovereign wealth', 'circular financing'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Hyperscaler capex, private credit, sovereign wealth and the circular financing among chip, cloud and model players, a concentration-of-risk concern.' },
  { slug: 'talent', layer: 16, band: 'crosscutting', name: 'Talent & human capital', label: 'Talent',
    actors: ['ML researchers', 'chip designers', 'DC technicians', 'electricians'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Researchers, chip designers, technicians and trades, with intense competition for scarce specialists.' },
  { slug: 'software-standards', layer: 16, band: 'crosscutting', name: 'Software & standards', label: 'Standards',
    actors: ['CUDA / ROCm / CANN', 'OCP', 'UEC', 'UALink', 'JEDEC', 'PCIe-SIG'], isChokepoint: false, riskDefault: 'medium',
    blurb: 'Accelerator software lock-in plus the standards bodies and open-source stack underpinning the tooling.' },
  { slug: 'policy-geopolitics', layer: 16, band: 'crosscutting', name: 'Policy, geopolitics & regulation', label: 'Policy',
    actors: ['export controls', 'chip acts', 'Taiwan / Korea risk', 'EU AI Act'], isChokepoint: false, riskDefault: 'high',
    blurb: 'Export controls, industrial policy, manufacturing concentration risk, critical-mineral controls and AI regulation.' },
  { slug: 'reverse-circular', layer: 16, band: 'crosscutting', name: 'Reverse, circular & secondary', label: 'Circular',
    actors: ['refurbishment', 'secondary GPU market', 'e-waste', 'recycling'], isChokepoint: false, riskDefault: 'low',
    blurb: 'Hardware lifecycle, the secondary GPU market, recycling and carbon accounting across the chain.' },
];

// Cross-layer dependency edges (upstream -> downstream). Same-tier relationships are
// left to the drawer prose; only flows that cross a tier are drawn. `emphasis` marks a
// dependency where either endpoint is a chokepoint, so the concentration of value and
// risk is visible at rest.
export const SC_EDGES: ScEdge[] = [
  // L0 materials -> fabrication / equipment / packaging
  { from: 'quartz-crucible', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'silicon-wafers', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'process-gases', to: 'litho-euv', emphasis: true },
  { from: 'process-gases', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'photoresist', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'critical-minerals', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'critical-minerals', to: 'power-components' },
  { from: 'abf-resin', to: 'substrate-makers', emphasis: true },
  { from: 'cooling-fluids', to: 'thermal-cooling' },

  // L1 equipment -> fabrication / test
  { from: 'litho-euv', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'litho-euv', to: 'other-leading-foundry', emphasis: true },
  { from: 'deposition-etch', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'deposition-etch', to: 'mature-foundry' },
  { from: 'metrology-inspection', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'mask-reticle', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'test-assembly-equip', to: 'osat' },
  { from: 'test-assembly-equip', to: 'cowos-packaging', emphasis: true },

  // L2 design -> fabrication
  { from: 'eda-tools', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'ip-cores', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'merchant-accelerators', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'hyperscaler-asics', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'asic-codesign', to: 'tsmc-leading-edge', emphasis: true },
  { from: 'merchant-accelerators', to: 'other-leading-foundry', emphasis: true },
  { from: 'accelerator-challengers', to: 'tsmc-leading-edge', emphasis: true },

  // L3 fabrication -> memory base die / packaging
  { from: 'tsmc-leading-edge', to: 'hbm-trio', emphasis: true },
  { from: 'tsmc-leading-edge', to: 'cowos-packaging', emphasis: true },
  { from: 'other-leading-foundry', to: 'osat' },
  { from: 'mature-foundry', to: 'osat' },
  { from: 'idm-fabs', to: 'dram' },
  { from: 'idm-fabs', to: 'nand-ssd' },

  // L4 memory -> packaging / systems
  { from: 'hbm-trio', to: 'cowos-packaging', emphasis: true },
  { from: 'dram', to: 'reference-systems' },
  { from: 'nand-ssd', to: 'facility-systems' },

  // L5 packaging -> systems
  { from: 'cowos-packaging', to: 'reference-systems', emphasis: true },
  { from: 'osat', to: 'reference-systems' },
  { from: 'substrate-makers', to: 'reference-systems', emphasis: true },
  { from: 'packaging-blocks', to: 'cowos-packaging', emphasis: true },
  { from: 'idm-packaging', to: 'odm-integrators' },

  // L6 interconnect -> systems
  { from: 'scale-up-fabric', to: 'reference-systems' },
  { from: 'scale-out-ethernet', to: 'reference-systems', emphasis: true },
  { from: 'infiniband', to: 'reference-systems' },
  { from: 'nics-dpus', to: 'reference-systems' },
  { from: 'optics', to: 'reference-systems' },
  { from: 'retimers-cabling', to: 'odm-integrators' },

  // L7 systems -> data centers
  { from: 'reference-systems', to: 'hyperscale-operators' },
  { from: 'reference-systems', to: 'neoclouds' },
  { from: 'odm-integrators', to: 'hyperscale-operators' },
  { from: 'odm-integrators', to: 'colocation' },
  { from: 'thermal-cooling', to: 'facility-systems' },
  { from: 'power-components', to: 'facility-systems' },

  // L9 energy -> data centers (power is the binding constraint beneath the buildings)
  { from: 'grid-transformers', to: 'hyperscale-operators', emphasis: true },
  { from: 'grid-transformers', to: 'facility-systems', emphasis: true },
  { from: 'gas-turbines', to: 'hyperscale-operators' },
  { from: 'nuclear-smr', to: 'hyperscale-operators' },
  { from: 'renewables-ppa', to: 'hyperscale-operators' },
  { from: 'energy-storage', to: 'facility-systems' },

  // L8 data centers -> cloud provisioning
  { from: 'hyperscale-operators', to: 'hyperscale-clouds' },
  { from: 'colocation', to: 'hyperscale-clouds' },
  { from: 'neoclouds', to: 'gpu-neoclouds' },
  { from: 'dc-buildout', to: 'hyperscale-operators' },

  // L10 cloud + L11 data -> models
  { from: 'hyperscale-clouds', to: 'frontier-labs' },
  { from: 'gpu-neoclouds', to: 'frontier-labs' },
  { from: 'sovereign-compute', to: 'frontier-labs' },
  { from: 'training-data', to: 'frontier-labs' },
  { from: 'labeling-rlhf', to: 'frontier-labs' },
  { from: 'data-engineering', to: 'frontier-labs' },
  { from: 'eval-safety-data', to: 'frontier-labs' },
  { from: 'data-licensing', to: 'training-data' },

  // L12 models -> deployment
  { from: 'frontier-labs', to: 'inference-serving' },
  { from: 'frontier-labs', to: 'agents-orchestration' },
  { from: 'cuda-runtimes', to: 'inference-serving', emphasis: true },
  { from: 'training-frameworks', to: 'frontier-labs' },

  // L13 deployment -> applications
  { from: 'inference-serving', to: 'horizontal-assistants' },
  { from: 'routing-gateways', to: 'horizontal-assistants' },
  { from: 'retrieval-memory', to: 'vertical-apps' },
  { from: 'agents-orchestration', to: 'agentic-systems' },
  { from: 'frontier-labs', to: 'horizontal-assistants' },

  // L14 applications -> end users
  { from: 'horizontal-assistants', to: 'enterprises' },
  { from: 'horizontal-assistants', to: 'consumers' },
  { from: 'embedded-ai', to: 'enterprises' },
  { from: 'vertical-apps', to: 'enterprises' },
  { from: 'agentic-systems', to: 'enterprises' },
  { from: 'generative-media', to: 'consumers' },
  { from: 'physical-edge-ai', to: 'enterprises' },
  { from: 'horizontal-assistants', to: 'demand-signal' },
];

export const SC_NODE_BY_SLUG: ReadonlyMap<string, ScNode> = new Map(
  SC_NODES.map((n) => [n.slug, n])
);

// Risk is descriptive (shown to everyone, like a signal's direction), not part of the
// stripped personal layer. The dot color rides the existing heat scale (cool to warm).
export const RISK_LABEL: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};
export const RISK_DOT_VAR: Record<RiskLevel, string> = {
  low: 'var(--heat-1)',
  medium: 'var(--heat-2)',
  high: 'var(--heat-3)',
  critical: 'var(--heat-4)',
};

// The Phase-1 view: effective risk = riskDefault, no signals yet. The DB read layer
// (lib/supply-chain/data.ts) returns the same shape with the overlay and signals folded in.
export function defaultNodeViews(): ScNodeView[] {
  return SC_NODES.map((n) => ({ ...n, risk: n.riskDefault, signalCount: 0, hasRecentSignal: false }));
}

// Fail fast in development if the static graph is malformed: duplicate slugs or an edge
// pointing at a node that does not exist would silently drop boxes or lines. This never
// runs in production (no throw at request time).
if (process.env.NODE_ENV !== 'production') {
  const seen = new Set<string>();
  for (const n of SC_NODES) {
    if (seen.has(n.slug)) throw new Error(`supply-chain map: duplicate node slug "${n.slug}"`);
    seen.add(n.slug);
  }
  for (const e of SC_EDGES) {
    if (!seen.has(e.from)) throw new Error(`supply-chain map: edge from unknown node "${e.from}"`);
    if (!seen.has(e.to)) throw new Error(`supply-chain map: edge to unknown node "${e.to}"`);
  }
}
