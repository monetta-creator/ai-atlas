import { config } from 'dotenv';
config({ path: '.env.local' });
import pg from 'pg';

// Every confidence resets to a neutral default — the author's to move.
// "Borrow the map, own the confidences." (Seed Data v2)
const NEUTRAL = 0.5;

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------- questions
const questions = [
  { slug: 'capability', sort: 1, primary_lens: 'stack',
    title: 'Are frontier model capabilities still improving fast, or has the curve bent?',
    summary: 'Nearly every financial and infrastructure bet is an implicit forecast of this capability curve.' },
  { slug: 'build-out', sort: 2, primary_lens: null,
    title: 'Can the physical build-out (power, chips, data centers) be delivered on the announced timeline?',
    summary: 'The domain where constraints are most concrete and least about belief.' },
  { slug: 'unit-economics', sort: 3, primary_lens: null,
    title: 'Do the unit economics of AI products actually work?',
    summary: 'Conflates lab economics, app-layer economics, and customer ROI: different answers each.' },
  { slug: 'mispricing', sort: 4, primary_lens: null,
    title: 'Is the market mispriced, and if so, in which direction?',
    summary: 'The most over-discussed question, and where domain confusion is worst.' },
  { slug: 'rent', sort: 5, primary_lens: 'stack',
    title: 'Where does durable competitive advantage settle, and does any layer earn outsized rents?',
    summary: 'Under-discussed relative to importance; the whole valuation case depends on someone capturing durable margin.' },
  { slug: 'geopolitics', sort: 6, primary_lens: null,
    title: 'Does the export-control / geopolitical regime constrain the trajectory, or get routed around?',
    summary: 'A live variable, often mistreated as background.' },
];

// ---------------------------------------------------------------- stances
const stances = [
  // Q1
  { code: 'Q1-S1A', q: 'capability', sort: 1, title: 'Scaling still works, the curve just moved.',
    holder: 'lab research leadership; scaling-law researchers',
    summary: 'Pretraining returns diminish, but inference-time compute, RL on verifiable rewards, and tool use opened new axes nowhere near saturated.',
    test: 'Two consecutive generations from multiple labs show no improvement on held-out, contamination-controlled benchmarks despite order-of-magnitude more compute: field-wide flat output against rising input.' },
  { code: 'Q1-S1B', q: 'capability', sort: 2, title: "The economically useful curve has bent, even if benchmarks haven't.",
    holder: 'careful capability skeptics; a growing camp of enterprise buyers',
    summary: 'Scores rise but marginal real-world reliability (the thing that lets you remove a human) has flattened, and the last 5% is where the money is.',
    test: 'A documented wave of agentic deployments running unsupervised at low error rates in high-stakes domains (sustained production, not demos), or a trusted reliability-tracking benchmark that climbs.' },
  { code: 'Q1-S1C', q: 'capability', sort: 3, title: "We can't tell, because evaluation is broken.",
    holder: 'eval researchers / methodologists',
    summary: 'Contamination, teaching-to-the-test, and saturation mean the slope is genuinely unknown. Epistemically humble, under-discussed, real.',
    test: 'Maturation of held-out, continuously-refreshed, contamination-resistant evaluation the field converges on and trusts.' },
  // Q2
  { code: 'Q2-S2A', q: 'build-out', sort: 1, title: 'Power is the binding constraint, and it bites before chips do.',
    holder: 'grid operators, utility / energy analysts',
    summary: "Interconnection queues, transformer and turbine lead times are multi-year; you can't will a gigawatt onto the grid.",
    test: 'Behind-the-meter generation and grid upgrades come online fast enough to meet announced load, with interconnection timelines actually shortening.' },
  { code: 'Q2-S2B', q: 'build-out', sort: 2, title: 'Capital and chips are the constraint; power is solvable with money.',
    holder: 'hyperscaler infra leads, some infra investors',
    summary: 'Power is an engineering / financing problem capital solves; the real bottleneck is advanced packaging (CoWoS), HBM, and funding.',
    test: 'Power cost / availability becomes the explicit, repeated reason clusters slip or relocate despite available capital.' },
  { code: 'Q2-S2C', q: 'build-out', sort: 3, title: 'The build is real but announced numbers are aspirational signaling.',
    holder: 'skeptical infra analysts, short-side researchers',
    summary: 'Headline figures are partly negotiating posture and fundraising theater; the real build is large but a fraction of announcements, and the gap is the story.',
    test: 'Announced capex converts to poured concrete and energized capacity near stated magnitudes within ~18 months.' },
  // Q3
  { code: 'Q3-S3A', q: 'unit-economics', sort: 1, title: "Margins are structurally improving; the model is viable; we're early.",
    holder: 'lab CFOs, growth investors',
    summary: 'Inference cost/token has fallen orders of magnitude; serving gross margins positive and improving; losses are training capex and S-curve acquisition. Revenue growing faster than prior software categories.',
    test: 'Revenue growth decelerates sharply while training costs keep rising, with no path to amortizing training over a growing base.' },
  { code: 'Q3-S3B', q: 'unit-economics', sort: 2, title: 'Labs subsidize usage; true unit economics are hidden.',
    holder: 'skeptical software analysts, VCs who passed',
    summary: "Headline margins exclude the cost of the model rebuilt every 12–18 months; 'cost/token falling' is true but irrelevant if you must keep spending more to reset the clock. Revenue per dollar of compute is poor.",
    test: "A lab shows a full cycle (train → serve → retire) where a generation's lifetime revenue exceeds fully-loaded training + serving cost, disclosed cleanly." },
  { code: 'Q3-S3C', q: 'unit-economics', sort: 3, title: 'Lab vs application economics are different questions; the app layer is where value accrues (or doesn’t).',
    holder: 'app-layer founders, enterprise SaaS investors',
    summary: 'Bear version: labs commoditize apps from below. Bull version: workflow integration + proprietary data create defensible margin above the model.',
    test: '(bear) Durable high-retention app businesses with margins that survive the next model release commoditizing their core feature.' },
  // Q4
  { code: 'Q4-S4A', q: 'mispricing', sort: 1, title: "It's a bubble; valuations price a future that won't arrive on schedule.",
    holder: 'short-side researchers, value investors, dot-com / telecom-analogy economists',
    summary: 'Circular financing, vendor financing, concentration risk echo prior manias; even if AI is transformative, the timing / magnitude priced in are wrong.',
    test: 'The largest AI-exposed firms grow into multiples via durable FCF, with circular arrangements unwinding into genuine third-party demand.' },
  { code: 'Q4-S4B', q: 'mispricing', sort: 2, title: 'Roughly fairly priced for a real platform shift; the leaders earn it.',
    holder: 'growth investors, some sell-side',
    summary: 'Unlike dot-com, leaders have real revenue, margins, cash flow today; hyperscaler capex is funded from operating cash flow.',
    test: 'Hyperscaler FCF turns sharply negative under capex weight, or AI revenue plateaus while capex continues.' },
  { code: 'Q4-S4C', q: 'mispricing', sort: 3, title: 'Mispriced, but heterogeneously: some assets bubbles, some cheap.',
    holder: 'discriminating fundamental investors',
    summary: "The index-level 'bubble or not' question is malformed; NVIDIA, hyperscalers, labs, app-layer, picks-and-shovels have wildly different risk profiles.",
    test: 'AI-exposed assets become highly correlated in a drawdown such that the distinctions stop mattering: everything trades as one risk factor.' },
  // Q5
  { code: 'Q5-S5A', q: 'rent', sort: 1, title: 'Labs converge to commodity; advantage accrues to distribution and chips.',
    holder: 'analysts noting frontier models cluster tightly and API switching costs are low',
    summary: 'Rents go to distribution (hyperscalers, OS / device) and scarce inputs (NVIDIA, TSMC, power).',
    test: "A lab sustains a large, durable capability lead customers pay a premium for and won't switch from." },
  { code: 'Q5-S5B', q: 'rent', sort: 2, title: 'Labs build durable moats via capability leads, ecosystems, capital scale.',
    holder: 'lab leadership, their investors',
    summary: 'The capital to stay frontier is itself the moat; plus brand, safety reputation, ecosystem lock-in, data flywheels.',
    test: 'Open-weight or cheaper models reach parity for the bulk of economic use cases, collapsing the premium.' },
  { code: 'Q5-S5C', q: 'rent', sort: 3, title: 'Open weights commoditize the middle; rents survive only at the extreme frontier and the physical layer.',
    holder: 'open-source proponents, some infra investors',
    summary: 'Most value captured by good-enough open models running cheaply; labs fight over a shrinking premium tier while durable rents sit in silicon and power.',
    test: "Open models persistently lag far enough that enterprises won't deploy them for serious work." },
  // Q6
  { code: 'Q6-S6A', q: 'geopolitics', sort: 1, title: 'Export controls meaningfully slow Chinese frontier capability and bifurcate the market.',
    holder: 'US policy hawks, some semi analysts',
    summary: 'Controls on leading-edge chips / tools create a real, compounding capability and cost gap.',
    test: 'Chinese labs repeatedly reach frontier parity via domestic / smuggled hardware and efficiency gains.' },
  { code: 'Q6-S6B', q: 'geopolitics', sort: 2, title: 'Controls are leaky and accelerate Chinese self-sufficiency; net harm to US vendors.',
    holder: 'some industry execs, China-watchers',
    summary: 'Smuggling, domestic fab progress, and algorithmic efficiency route around controls while cutting US firms out of a huge market.',
    test: 'A durable, widening Chinese capability lag despite these efforts.' },
  { code: 'Q6-S6C', q: 'geopolitics', sort: 3, title: 'Geopolitics is second-order; economics dominate either way.',
    holder: 'market analysts who think the commercial trajectory swamps policy',
    summary: 'Real but bounded.',
    test: 'An export-control or Taiwan event causes a structural supply-chain break that reprices the whole sector.' },
];

// ---------------------------------------------------------------- claims (+ F1 frame)
const claims = [
  { code: '1.1', domain: 'capability', resolv: 'clean', reflexive: false,
    statement: 'Frontier benchmark scores kept rising gen-over-gen through 2025–26.',
    test: 'Trajectories flatten despite continued compute scaling.',
    domain_note: 'Capability (clean only as good as the benchmarks)' },
  { code: '1.2', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Benchmark gains are increasingly contaminated / saturated, overstating progress.',
    test: 'Contamination-controlled re-tests reproduce the gains.',
    domain_note: 'Capability (methodologically hard)' },
  { code: '1.3', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Agentic reliability (multi-step completion without human correction) is improving materially, not just peak single-shot.',
    test: 'Production agent error / intervention rates fail to fall across 2025–26.',
    domain_note: 'Capability · UNDER-TESTED; feeds bridge B1' },
  { code: '1.4', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: "Inference-time compute yields gains that don't saturate quickly on hard reasoning.",
    test: 'Reasoning-model gains plateau sharply with more inference compute on novel problems.',
    domain_note: 'Capability (real but uneven so far)' },

  { code: '2.1', domain: 'build_out', resolv: 'slow', reflexive: false,
    statement: 'Grid interconnection / power timelines exceed data-center construction timelines in major US markets.',
    test: 'Queue / energization delays fail to gate announced projects.',
    domain_note: 'Build-out (partly observable now)' },
  { code: '2.2', domain: 'build_out', resolv: 'slow', reflexive: false,
    statement: 'Advanced packaging (CoWoS) + HBM is the tightest single supply node.',
    test: 'Packaging / HBM expansions clear the backlog without being the cited bottleneck.',
    domain_note: 'Build-out (semi-observable: TSMC / SK Hynix)' },
  { code: '2.3', domain: 'build_out', resolv: 'slow', reflexive: true,
    statement: 'Announced aggregate capex materially exceeds what will be deployed.',
    test: 'Capex converts to deployed capacity at announced scale / timing.',
    domain_note: 'Build-out + Market' },
  { code: '2.4', domain: 'build_out', resolv: 'clean', reflexive: false,
    statement: 'Data-center demand is measurably pressuring regional power prices / emissions.',
    test: "Prices in DC-dense regions don't diverge from baseline; utilities don't cite AI load in rate cases.",
    domain_note: 'Build-out (accumulating now)' },

  { code: '3.1', domain: 'economics', resolv: 'clean', reflexive: false,
    statement: 'Inference cost per unit of capability is falling rapidly.',
    test: 'Cost-per-token-at-fixed-quality stops declining.',
    domain_note: 'Economics + Capability (currently true)' },
  { code: '3.2', domain: 'economics', resolv: 'slow', reflexive: false,
    statement: 'Frontier training costs rise fast enough to outpace per-model revenue.',
    test: "A generation's lifetime revenue exceeds fully-loaded cost.",
    domain_note: 'Economics (disclosure-obscured)' },
  { code: '3.3', domain: 'economics', resolv: 'slow', reflexive: false,
    statement: 'Enterprises achieve measurable ROI and renew / expand, not just pilot.',
    test: 'Net revenue retention + pilot-to-production stay low across the base.',
    domain_note: 'Economics + Capability · UNDER-TESTED; sits under bridge B1→B2' },
  { code: '3.4', domain: 'economics', resolv: 'slow', reflexive: false,
    statement: 'App-layer companies retain margin after the model commoditizes their feature.',
    test: 'App-layer margins compress sharply on each major model release.',
    domain_note: 'Economics (case-by-case)' },
  { code: '3.5', domain: 'economics', resolv: 'slow', reflexive: false,
    statement: 'Recognized revenue (not bookings / ARR run-rate) grows at claimed rates.',
    test: 'Audited recognized revenue diverges materially from announced ARR.',
    domain_note: 'Economics + Market (disclosure-limited)' },

  { code: '4.1', domain: 'market', resolv: 'slow', reflexive: true,
    statement: 'A material share of AI revenue is circular (vendors funding customers who buy from them).',
    test: 'Tracing counterparties shows only a small share traces to vendor-provided capital.',
    domain_note: 'Market · the defining reflexive structure' },
  { code: '4.2', domain: 'market', resolv: 'clean', reflexive: false,
    statement: 'Hyperscaler AI capex is funded from operating cash flow, not debt; FCF stays positive.',
    test: 'FCF turns negative or debt issuance spikes to fund capex.',
    domain_note: 'Market (quarterly)' },
  { code: '4.3', domain: 'market', resolv: 'slow', reflexive: false,
    statement: 'One vendor’s revenue depends heavily on a few customers who are themselves unprofitable on AI.',
    test: 'Customer base broadens and customers reach AI profitability.',
    domain_note: 'Market (partly visible)' },
  { code: '4.4', domain: 'market', resolv: 'clean', reflexive: false,
    statement: 'AI-exposed equities move heterogeneously, not as one factor.',
    test: 'A sector drawdown shows high cross-correlation across AI names.',
    domain_note: 'Market (resolved by a stress event)' },

  { code: '5.1', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Frontier models cluster tightly (small gaps, fast catch-up).',
    test: 'Gap between #1 and #3 widens and persists across generations.',
    domain_note: 'Capability + Market' },
  { code: '5.2', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Open-weight models reach "good enough" parity for most economic use cases.',
    test: 'Open models stay materially behind on tasks enterprises pay for.',
    domain_note: 'Capability + Economics · HINGE; arguably the most load-bearing claim; feeds B4' },
  { code: '5.3', domain: 'market', resolv: 'slow', reflexive: false,
    statement: 'API switching costs are low (customers multi-home and swap easily).',
    test: "Enterprises show high lock-in, won't switch despite price / quality gaps.",
    domain_note: 'Market (partly visible)' },
  { code: '5.4', domain: 'economics', resolv: 'slow', reflexive: false,
    statement: 'The capital scale to stay frontier is itself a sustainable barrier.',
    test: 'A new entrant reaches the frontier on materially less capital.',
    domain_note: 'Economics + Capability' },

  { code: '6.1', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Chinese frontier models lag US frontier by a widening margin.',
    test: 'Chinese models reach / hold parity on trusted evals.',
    domain_note: 'Capability (lens: geopolitics)' },
  { code: '6.2', domain: 'capability', resolv: 'slow', reflexive: false,
    statement: 'Algorithmic / training-efficiency gains reduce the compute (and chip-access) needed for frontier capability.',
    test: 'Frontier capability stays tightly coupled to raw leading-edge compute access.',
    domain_note: 'Capability (lens: geopolitics) · feeds B3, bears on Q2 and Q3' },
  { code: '6.3', domain: 'market', resolv: 'slow', reflexive: false,
    statement: 'Export controls cut US vendor addressable market more than they slow rivals.',
    test: 'US vendor China revenue recovers despite controls.',
    domain_note: 'Market (lens: geopolitics)' },

  // Frame F1 (is_frame: true — no domain, no test, no confidence; quarantined from evidence)
  { code: 'F1', is_frame: true,
    statement: 'Is intelligence the bottleneck on economic output, or is it organizational / deployment absorption?' },
];

// ---------------------------------------------------------------- bridge-claims
const bridges = [
  { code: 'B1', from: 'capability', to: 'economics', resolv: 'slow', reflexive: false,
    statement: 'Agentic reliability gains will translate into enterprise ROI.',
    test: 'Reliability metrics improve while enterprise ROI / renewal stays pilot-bound.', note: null },
  { code: 'B2', from: 'economics', to: 'market', resolv: 'slow', reflexive: false,
    statement: 'Enterprise ROI will translate into durable recognized revenue (not bookings).',
    test: 'ROI rises but recognized revenue diverges from ARR / bookings.', note: null },
  { code: 'B3', from: 'capability', to: 'build_out', resolv: 'slow', reflexive: false,
    statement: 'Training-efficiency gains will reduce aggregate compute demand (threatening "more compute = more value").',
    test: "Frontier capability stays tightly coupled to raw compute; efficiency gains don't dent aggregate demand.",
    note: 'Tail into Market.' },
  { code: 'B4', from: 'capability', to: 'market', resolv: 'slow', reflexive: false,
    statement: 'Model commoditization determines where rent settles (away from labs).',
    test: 'Labs sustain a durable premium despite clustering and low switching costs.', note: null },
];

// ---------------------------------------------------------------- node lenses
const nodeLenses = [
  ['claim', '6.1', 'geopolitics'],
  ['claim', '6.2', 'geopolitics'],
  ['claim', '6.3', 'geopolitics'],
];

// ---------------------------------------------------------------- edges
// [from_type, from_code, to_type, to_code, relation, note]
const edges = [
  // Q1 claim -> stance
  ['claim', '1.1', 'stance', 'Q1-S1A', 'supports', null],
  ['claim', '1.1', 'stance', 'Q1-S1B', 'contradicts', null],
  ['claim', '1.2', 'stance', 'Q1-S1B', 'supports', null],
  ['claim', '1.2', 'stance', 'Q1-S1C', 'supports', null],
  ['claim', '1.2', 'stance', 'Q1-S1A', 'contradicts', null],
  ['claim', '1.3', 'stance', 'Q1-S1A', 'supports', null],
  ['claim', '1.3', 'stance', 'Q1-S1B', 'contradicts', null],
  ['claim', '1.4', 'stance', 'Q1-S1A', 'supports', null],
  ['claim', '1.4', 'stance', 'Q1-S1B', 'contradicts', 'weak'],
  // Q2
  ['claim', '2.1', 'stance', 'Q2-S2A', 'supports', null],
  ['claim', '2.1', 'stance', 'Q2-S2B', 'contradicts', null],
  ['claim', '2.2', 'stance', 'Q2-S2B', 'supports', null],
  ['claim', '2.2', 'stance', 'Q2-S2A', 'contradicts', null],
  ['claim', '2.3', 'stance', 'Q2-S2C', 'supports', null],
  ['claim', '2.3', 'stance', 'Q2-S2A', 'contradicts', null],
  ['claim', '2.3', 'stance', 'Q2-S2B', 'contradicts', null],
  ['claim', '2.4', 'stance', 'Q2-S2A', 'supports', null],
  // Q3
  ['claim', '3.1', 'stance', 'Q3-S3A', 'supports', null],
  ['claim', '3.2', 'stance', 'Q3-S3B', 'supports', null],
  ['claim', '3.2', 'stance', 'Q3-S3A', 'contradicts', null],
  ['claim', '3.3', 'stance', 'Q3-S3A', 'supports', null],
  ['claim', '3.3', 'stance', 'Q3-S3B', 'contradicts', null],
  ['claim', '3.3', 'stance', 'Q3-S3C', 'supports', 'bull reading'],
  ['claim', '3.4', 'stance', 'Q3-S3C', 'supports', 'bull reading; contradicts the bear reading'],
  ['claim', '3.5', 'stance', 'Q3-S3A', 'supports', null],
  ['claim', '3.5', 'stance', 'Q3-S3B', 'contradicts', null],
  // Q4
  ['claim', '4.1', 'stance', 'Q4-S4A', 'supports', null],
  ['claim', '4.1', 'stance', 'Q4-S4B', 'contradicts', null],
  ['claim', '4.2', 'stance', 'Q4-S4B', 'supports', null],
  ['claim', '4.2', 'stance', 'Q4-S4A', 'contradicts', null],
  ['claim', '4.3', 'stance', 'Q4-S4A', 'supports', null],
  ['claim', '4.3', 'stance', 'Q4-S4B', 'contradicts', null],
  ['claim', '4.4', 'stance', 'Q4-S4C', 'supports', null],
  ['claim', '4.4', 'stance', 'Q4-S4A', 'contradicts', 'opposes single-factor framing'],
  ['claim', '4.4', 'stance', 'Q4-S4B', 'contradicts', 'opposes single-factor framing'],
  // Q5
  ['claim', '5.1', 'stance', 'Q5-S5A', 'supports', null],
  ['claim', '5.1', 'stance', 'Q5-S5C', 'supports', null],
  ['claim', '5.1', 'stance', 'Q5-S5B', 'contradicts', null],
  ['claim', '5.2', 'stance', 'Q5-S5C', 'supports', null],
  ['claim', '5.2', 'stance', 'Q5-S5B', 'contradicts', null],
  ['claim', '5.3', 'stance', 'Q5-S5A', 'supports', null],
  ['claim', '5.3', 'stance', 'Q5-S5B', 'contradicts', null],
  ['claim', '5.4', 'stance', 'Q5-S5B', 'supports', null],
  ['claim', '5.4', 'stance', 'Q5-S5A', 'contradicts', null],
  ['claim', '5.4', 'stance', 'Q5-S5C', 'contradicts', null],
  // Q6
  ['claim', '6.1', 'stance', 'Q6-S6A', 'supports', null],
  ['claim', '6.1', 'stance', 'Q6-S6B', 'contradicts', null],
  ['claim', '6.2', 'stance', 'Q6-S6B', 'supports', null],
  ['claim', '6.2', 'stance', 'Q6-S6A', 'contradicts', null],
  ['claim', '6.3', 'stance', 'Q6-S6B', 'supports', null],
  ['claim', '6.3', 'stance', 'Q6-S6A', 'contradicts', null],

  // strongest-opposing stance <-> stance
  ['stance', 'Q1-S1A', 'stance', 'Q1-S1B', 'contradicts', 'strongest-opposing: the metric that matters'],
  ['stance', 'Q1-S1C', 'stance', 'Q1-S1A', 'contradicts', 'opposes premise: can we read the slope'],
  ['stance', 'Q1-S1C', 'stance', 'Q1-S1B', 'contradicts', 'opposes premise: can we read the slope'],
  ['stance', 'Q2-S2A', 'stance', 'Q2-S2B', 'contradicts', 'which input binds'],
  ['stance', 'Q2-S2C', 'stance', 'Q2-S2A', 'contradicts', 'opposes premise: announced build is real at scale'],
  ['stance', 'Q2-S2C', 'stance', 'Q2-S2B', 'contradicts', 'opposes premise: announced build is real at scale'],
  ['stance', 'Q3-S3A', 'stance', 'Q3-S3B', 'contradicts', 'viable vs hidden-subsidy'],
  ['stance', 'Q3-S3C', 'stance', 'Q3-S3A', 'depends_on', 'reframes: splits the question'],
  ['stance', 'Q3-S3C', 'stance', 'Q3-S3B', 'depends_on', 'reframes: splits the question'],
  ['stance', 'Q4-S4A', 'stance', 'Q4-S4B', 'contradicts', 'direct'],
  ['stance', 'Q4-S4C', 'stance', 'Q4-S4A', 'contradicts', 'opposes framing: the AI trade is one thing'],
  ['stance', 'Q4-S4C', 'stance', 'Q4-S4B', 'contradicts', 'opposes framing: the AI trade is one thing'],
  ['stance', 'Q5-S5B', 'stance', 'Q5-S5A', 'contradicts', 'moat vs commoditization'],
  ['stance', 'Q5-S5B', 'stance', 'Q5-S5C', 'contradicts', 'moat vs commoditization'],
  ['stance', 'Q5-S5A', 'stance', 'Q5-S5C', 'depends_on', 'agree labs commoditize, differ on where rent lands'],
  ['stance', 'Q6-S6A', 'stance', 'Q6-S6B', 'contradicts', 'controls work vs backfire'],
  ['stance', 'Q6-S6C', 'stance', 'Q6-S6A', 'contradicts', 'opposes on magnitude'],
  ['stance', 'Q6-S6C', 'stance', 'Q6-S6B', 'contradicts', 'opposes on magnitude'],

  // claim -> bridge_claim (fed-by)
  ['claim', '1.3', 'bridge_claim', 'B1', 'supports', null],
  ['claim', '3.3', 'bridge_claim', 'B1', 'supports', null],
  ['claim', '1.2', 'bridge_claim', 'B1', 'contradicts', null],
  ['claim', '3.3', 'bridge_claim', 'B2', 'supports', null],
  ['claim', '3.5', 'bridge_claim', 'B2', 'supports', null],
  ['claim', '4.3', 'bridge_claim', 'B2', 'contradicts', null],
  ['claim', '6.2', 'bridge_claim', 'B3', 'supports', null],
  ['claim', '2.2', 'bridge_claim', 'B3', 'contradicts', null],
  ['claim', '1.4', 'bridge_claim', 'B3', 'depends_on', 'mixed signal'],
  ['claim', '5.1', 'bridge_claim', 'B4', 'supports', null],
  ['claim', '5.2', 'bridge_claim', 'B4', 'supports', null],
  ['claim', '5.3', 'bridge_claim', 'B4', 'supports', null],
  ['claim', '5.4', 'bridge_claim', 'B4', 'contradicts', null],

  // frame -> claim (organizes); F1 lives in claims with is_frame=true
  ['claim', 'F1', 'claim', '1.3', 'organizes', null],
  ['claim', 'F1', 'claim', '3.3', 'organizes', null],
];

async function main() {
  await client.connect();
  await client.query('begin');

  // questions
  const qId = {};
  for (const q of questions) {
    const r = await client.query(
      // On conflict we keep only the structural columns up to date. The prose
      // (title, summary) is editable on /data, so the DB is now its source of
      // truth — re-seeding must not clobber on-site edits (same as confidence).
      `insert into questions (title, slug, summary, primary_lens, sort_order)
       values ($1,$2,$3,$4,$5)
       on conflict (slug) do update set
         primary_lens=excluded.primary_lens, sort_order=excluded.sort_order
       returning id`,
      [q.title, q.slug, q.summary, q.primary_lens, q.sort]
    );
    qId[q.slug] = r.rows[0].id;
  }

  // stances
  const sId = {};
  for (const s of stances) {
    const r = await client.query(
      // Prose (title, holder, summary, test) is editable on /data, so it is not
      // overwritten on conflict — only the structural columns are kept in sync.
      `insert into stances (question_id, code, title, holder, summary, test, confidence, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (code) do update set
         question_id=excluded.question_id, sort_order=excluded.sort_order
       returning id`,
      [qId[s.q], s.code, s.title, s.holder, s.summary, s.test, NEUTRAL, s.sort]
    );
    sId[s.code] = r.rows[0].id;
  }

  // claims (+ F1)
  const cId = {};
  for (const c of claims) {
    const isFrame = c.is_frame === true;
    const r = await client.query(
      // Prose (statement, test, domain_note) is editable on /data, so it is not
      // overwritten on conflict — only the structural columns are kept in sync.
      `insert into claims (code, statement, test, domain, domain_note, resolvability, confidence, is_frame, reflexive)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (code) do update set
         domain=excluded.domain, resolvability=excluded.resolvability,
         is_frame=excluded.is_frame, reflexive=excluded.reflexive
       returning id`,
      [c.code, c.statement, isFrame ? null : c.test, isFrame ? null : c.domain,
       c.domain_note ?? null, isFrame ? null : c.resolv, isFrame ? null : NEUTRAL,
       isFrame, c.reflexive === true]
    );
    cId[c.code] = r.rows[0].id;
  }

  // bridge_claims
  const bId = {};
  for (const b of bridges) {
    const r = await client.query(
      // Prose (statement, test, note) is editable on /data, so it is not
      // overwritten on conflict — only the structural columns are kept in sync.
      `insert into bridge_claims (code, statement, domain_from, domain_to, test, resolvability, confidence, reflexive, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (code) do update set
         domain_from=excluded.domain_from, domain_to=excluded.domain_to,
         resolvability=excluded.resolvability, reflexive=excluded.reflexive
       returning id`,
      [b.code, b.statement, b.from, b.to, b.test, b.resolv, NEUTRAL, b.reflexive === true, b.note]
    );
    bId[b.code] = r.rows[0].id;
  }

  const idOf = (type, code) =>
    type === 'stance' ? sId[code] : type === 'bridge_claim' ? bId[code] : cId[code];

  // node lenses
  for (const [t, code, lens] of nodeLenses) {
    await client.query(
      `insert into node_lenses (target_type, target_id, lens) values ($1,$2,$3)
       on conflict (target_type, target_id, lens) do nothing`,
      [t, idOf(t, code), lens]
    );
  }

  // edges
  for (const [ft, fc, tt, tc, rel, note] of edges) {
    const fromId = idOf(ft, fc);
    const toId = idOf(tt, tc);
    if (!fromId || !toId) throw new Error(`edge endpoint not found: ${ft}:${fc} -> ${tt}:${tc}`);
    await client.query(
      `insert into edges (from_type, from_id, to_type, to_id, relation, note) values ($1,$2,$3,$4,$5,$6)
       on conflict (from_type, from_id, to_type, to_id, relation) do update set note=excluded.note`,
      [ft, fromId, tt, toId, rel, note]
    );
  }

  await client.query('commit');

  const count = async (t) => (await client.query(`select count(*)::int n from ${t}`)).rows[0].n;
  console.log('seed complete:');
  console.log('  questions     ', await count('questions'));
  console.log('  stances       ', await count('stances'));
  console.log('  claims (incl F)', await count('claims'));
  console.log('  bridge_claims ', await count('bridge_claims'));
  console.log('  node_lenses   ', await count('node_lenses'));
  console.log('  edges         ', await count('edges'));
  await client.end();
}

main().catch(async (e) => {
  try { await client.query('rollback'); } catch {}
  console.error('SEED FAILED:', e.message);
  process.exit(1);
});
