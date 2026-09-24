import type { SchemaTable } from './introspect';

// Pure schema-layout machinery for the Schema map (/datasets/schema). No
// imports beyond types, so plain Node (scripts/test-schema-layout.mjs) loads
// this directly and the client component can import it too.

export type SubsystemGroup =
  | 'argument-map' | 'signals-pipeline' | 'sources-evidence' | 'research' | 'scout'
  | 'scan' | 'intel' | 'tooling' | 'portal' | 'agent' | 'reports' | 'editions' | 'prefs-and-meta';

export const GROUP_LABELS: Record<SubsystemGroup, string> = {
  'argument-map': 'Argument map',
  'signals-pipeline': 'Signal Board & discovery pipeline',
  'sources-evidence': 'Sources & evidence',
  research: 'Research Portal',
  scout: 'Startup Scout',
  scan: 'External Scan',
  intel: 'Intel Desk',
  tooling: 'Tooling Monitor',
  portal: 'Data Portal access',
  agent: 'Atlas Agent',
  reports: 'Reports',
  editions: 'Daily Edition',
  'prefs-and-meta': 'Prefs & site meta',
};

// Every table in the live schema must be placed here explicitly, so a new
// migration that adds a table without updating this map fails the build
// (groupTables throws) instead of silently rendering nowhere.
export const SUBSYSTEMS: Record<string, SubsystemGroup> = {
  // ---- argument-map ---------------------------------------------------------
  questions: 'argument-map', stances: 'argument-map', claims: 'argument-map',
  bridge_claims: 'argument-map', edges: 'argument-map', node_lenses: 'argument-map',
  concepts: 'argument-map', concept_edges: 'argument-map', concept_claims: 'argument-map',
  concept_gap_scan: 'argument-map', argument_gap_scan: 'argument-map',
  theses: 'argument-map', thesis_reports: 'argument-map',
  supply_chain_node_meta: 'argument-map', supply_chain_node_signals: 'argument-map',
  question_summaries: 'argument-map',
  positions_crosscutting: 'argument-map', position_components: 'argument-map',
  rationales: 'argument-map', snapshots: 'argument-map',

  // ---- signals & discovery pipeline -----------------------------------------
  signals: 'signals-pipeline', signal_candidates: 'signals-pipeline',
  pipeline_runs: 'signals-pipeline', pipeline_prefs: 'signals-pipeline',
  digest_snapshots: 'signals-pipeline', dedupe_scan: 'signals-pipeline',

  // ---- sources & evidence -----------------------------------------------
  sources: 'sources-evidence', evidence: 'sources-evidence',
  extraction_queue: 'sources-evidence', source_tiers: 'sources-evidence',

  // ---- research ---------------------------------------------------------
  papers: 'research', paper_concepts: 'research',
  research_threads: 'research', thread_papers: 'research', thread_revisions: 'research',
  research_thread_scan: 'research', research_runs: 'research',
  research_prefs: 'research', research_agent_prefs: 'research',

  // ---- scout --------------------------------------------------------------
  companies: 'scout', company_events: 'scout', company_documents: 'scout',
  scout_verticals: 'scout', scout_runs: 'scout', scout_prefs: 'scout',

  // ---- scan ---------------------------------------------------------------
  scan_items: 'scan', scan_runs: 'scan', scan_topics: 'scan', scan_prefs: 'scan',

  // ---- intel --------------------------------------------------------------
  intel_companies: 'intel', intel_items: 'intel', intel_facts: 'intel',
  intel_metrics: 'intel', intel_runs: 'intel', intel_prefs: 'intel',

  // ---- tooling --------------------------------------------------------------
  tooling_categories: 'tooling', tooling_products: 'tooling', tooling_events: 'tooling',
  tooling_runs: 'tooling', tooling_prefs: 'tooling',

  // ---- portal (access keys, requests, usage, saved views) -------------------
  portal_keys: 'portal', portal_access_requests: 'portal',
  portal_usage: 'portal', portal_views: 'portal',

  // ---- agent --------------------------------------------------------------
  agent_findings: 'agent', agent_actions: 'agent', agent_briefs: 'agent', agent_prefs: 'agent',

  // ---- reports --------------------------------------------------------------
  reports: 'reports', generated_reports: 'reports',

  // ---- editions -------------------------------------------------------------
  edition_prefs: 'editions',

  // ---- prefs & site meta ------------------------------------------------
  content_blocks: 'prefs-and-meta', home_prefs: 'prefs-and-meta',
  ai_cost_log: 'prefs-and-meta', ai_rate_cards: 'prefs-and-meta',
  tickets: 'prefs-and-meta', ticket_images: 'prefs-and-meta',
};

export type AccessTier = 'public' | 'key' | 'admin';

export interface TierInfo { tier: AccessTier; reason: string }

// Per-table access tier + a one-line reason. 'public' = its published layer
// is readable by guests (even if a fuller layer needs a key or admin).
// 'key' = ships only in key-gated datasets or portal surfaces. 'admin' =
// never leaves the server.
export const ACCESS_TIER: Record<string, TierInfo> = {
  // argument-map
  questions: { tier: 'public', reason: 'the public question pages read it directly' },
  stances: { tier: 'public', reason: 'the public question pages read it directly' },
  claims: { tier: 'public', reason: 'the argument-nodes dataset and claim pages are public (confidence stripped)' },
  bridge_claims: { tier: 'public', reason: 'the argument-nodes dataset and bridge pages are public (confidence stripped)' },
  edges: { tier: 'public', reason: 'the argument-edges dataset is public' },
  node_lenses: { tier: 'public', reason: 'lens tags render on public map pages and the argument-nodes dataset' },
  concepts: { tier: 'public', reason: 'the concepts dataset and /concepts pages are public' },
  concept_edges: { tier: 'public', reason: 'prerequisite edges render on public concept pages' },
  concept_claims: { tier: 'public', reason: 'confirmed claim links render on public concept pages' },
  concept_gap_scan: { tier: 'admin', reason: 'the AI gap-diagnosis scan is a recommend-only admin working set' },
  argument_gap_scan: { tier: 'admin', reason: 'the AI gap-diagnosis scan is a recommend-only admin working set' },
  theses: { tier: 'public', reason: 'the thesis-reports dataset joins its claim_codes and statement' },
  thesis_reports: { tier: 'public', reason: 'the thesis-reports dataset and /thesis-report pages are public' },
  supply_chain_node_meta: { tier: 'public', reason: 'renders on the public /traceroute supply-chain scenes' },
  supply_chain_node_signals: { tier: 'public', reason: 'renders on the public /traceroute supply-chain scenes' },
  question_summaries: { tier: 'admin', reason: 'AI question-state summaries live on the admin-only /q/[slug]/summary page' },
  positions_crosscutting: { tier: 'admin', reason: 'the personal cross-cutting worldview layer, /worldview is admin-only' },
  position_components: { tier: 'admin', reason: 'the personal cross-cutting worldview layer, /worldview is admin-only' },
  rationales: { tier: 'admin', reason: 'the personal confidence-move audit trail, never exported' },
  snapshots: { tier: 'admin', reason: 'the personal confidence-history audit trail behind /calibration' },

  // signals-pipeline
  signals: { tier: 'public', reason: 'the signals dataset ships every published signal' },
  signal_candidates: { tier: 'admin', reason: 'the pre-publish draft funnel, never leaves the server' },
  pipeline_runs: { tier: 'admin', reason: 'internal run checkpoint state for the /pipeline console' },
  pipeline_prefs: { tier: 'admin', reason: 'the pipeline cron/A-B config singleton' },
  digest_snapshots: { tier: 'admin', reason: 'an audit log for the still-unwired digest sender' },
  dedupe_scan: { tier: 'admin', reason: 'the persisted dedupe-scan working set behind /signals/drafts' },

  // sources-evidence
  sources: { tier: 'public', reason: 'the sources bibliography dataset ships publicly referenced sources' },
  evidence: { tier: 'public', reason: 'the evidence-ledger dataset ships every public evidence row' },
  extraction_queue: { tier: 'admin', reason: 'scaffolded but unwired; no read path exists' },
  source_tiers: { tier: 'admin', reason: 'the internal rating cache; its tier/kind values ship stamped onto scan/intel items, not this table' },

  // research
  papers: { tier: 'public', reason: 'the research-papers dataset ships kept papers; the fuller research-export needs a key' },
  paper_concepts: { tier: 'public', reason: 'suggested-concept links render on public paper pages' },
  research_threads: { tier: 'public', reason: 'thread synthesis pages are public' },
  thread_papers: { tier: 'public', reason: 'confirmed paper-thread groupings render on public thread pages' },
  thread_revisions: { tier: 'admin', reason: 'the synthesis revision trail stays admin-only' },
  research_thread_scan: { tier: 'admin', reason: 'internal bookkeeping for the fortnightly revision digest' },
  research_runs: { tier: 'admin', reason: 'internal engine checkpoint state' },
  research_prefs: { tier: 'admin', reason: 'the research engine config singleton' },
  research_agent_prefs: { tier: 'admin', reason: 'the queue agent steering-note singleton' },

  // scout
  companies: { tier: 'public', reason: 'the scout-companies dataset ships tracked companies only; queued rows never leave the server' },
  company_events: { tier: 'public', reason: 'the scout-events dataset ships events on tracked companies only' },
  company_documents: { tier: 'admin', reason: 'retained document text from the portal research panel, never public' },
  scout_verticals: { tier: 'admin', reason: 'discovery query templates are operational config; vertical names surface via join only' },
  scout_runs: { tier: 'admin', reason: 'internal discovery-run checkpoint state' },
  scout_prefs: { tier: 'admin', reason: 'the steering-note and rubric config singleton' },

  // scan
  scan_items: { tier: 'key', reason: 'ships only in the key-gated external-scan dataset' },
  scan_runs: { tier: 'admin', reason: 'internal run checkpoint state behind the /scan console' },
  scan_topics: { tier: 'admin', reason: 'the topic registry seeds from an untracked private file and is never downloadable itself' },
  scan_prefs: { tier: 'admin', reason: 'the crons on/off and model-picker config singleton' },

  // intel
  intel_companies: { tier: 'key', reason: 'ships only in the key-gated intel-companies dataset' },
  intel_items: { tier: 'key', reason: 'ships only in the key-gated intel-items dataset' },
  intel_facts: { tier: 'key', reason: 'ships only in the key-gated intel-facts dataset' },
  intel_metrics: { tier: 'key', reason: 'ships only in the key-gated intel-metrics dataset' },
  intel_runs: { tier: 'admin', reason: 'internal run checkpoint state behind the /intel console' },
  intel_prefs: { tier: 'admin', reason: 'the crons on/off and model-picker config singleton' },

  // tooling
  tooling_categories: { tier: 'public', reason: 'category names render on the public /tooling catalog and tooling-catalog dataset' },
  tooling_products: { tier: 'key', reason: 'the agent fit read and dossier ship only in the key-gated tooling-products dataset; cataloged facts alone ship publicly via tooling-catalog' },
  tooling_events: { tier: 'key', reason: 'ships only in the key-gated tooling-events dataset' },
  tooling_runs: { tier: 'admin', reason: 'internal run checkpoint state behind the /tooling/console' },
  tooling_prefs: { tier: 'admin', reason: 'the weekly-engine config singleton' },

  // portal
  portal_keys: { tier: 'admin', reason: 'hashed access keys, never leave the server' },
  portal_access_requests: { tier: 'admin', reason: 'requester name/email/reason, admin review only' },
  portal_usage: { tier: 'admin', reason: 'per-key usage log behind /access' },
  portal_views: { tier: 'admin', reason: 'saved filter views are per-key working state' },

  // agent
  agent_findings: { tier: 'admin', reason: 'the resident operator is admin-only end to end' },
  agent_actions: { tier: 'admin', reason: 'the resident operator is admin-only end to end' },
  agent_briefs: { tier: 'admin', reason: 'the resident operator is admin-only end to end' },
  agent_prefs: { tier: 'admin', reason: 'the resident operator is admin-only end to end' },

  // reports
  reports: { tier: 'public', reason: 'a saved period report is public the moment it is saved' },
  generated_reports: { tier: 'public', reason: 'a published generated report is public; drafts stay admin (or portal for tooling reports)' },

  // editions
  edition_prefs: { tier: 'admin', reason: 'the Daily Edition config singleton' },

  // prefs-and-meta
  content_blocks: { tier: 'admin', reason: 'edited only in edit mode; treated as admin working content' },
  home_prefs: { tier: 'admin', reason: 'the lobby widget-board layout singleton' },
  ai_cost_log: { tier: 'admin', reason: 'per-call spend log behind /costs' },
  ai_rate_cards: { tier: 'admin', reason: 'pricing config behind /costs' },
  tickets: { tier: 'admin', reason: 'feedback-box submissions, reviewed only at /tickets' },
  ticket_images: { tier: 'admin', reason: 'ticket screenshots, served only through the admin-gated image route' },
};

// Dataset slug -> the tables its builder reads, derived by hand from
// lib/datasets/builders.ts. `catalog` reads no table (its rows are generated
// from the registry array itself), hence the empty list.
export const DATASET_TABLES: Record<string, string[]> = {
  signals: ['signals', 'sources'],
  'argument-nodes': ['questions', 'stances', 'claims', 'bridge_claims', 'node_lenses'],
  'argument-edges': ['edges', 'stances', 'claims', 'bridge_claims'],
  'evidence-ledger': ['evidence', 'claims', 'bridge_claims', 'signals', 'sources'],
  sources: ['sources', 'evidence', 'signals', 'signal_candidates'],
  'articles-full-text': ['signals', 'sources', 'signal_candidates'],
  concepts: ['concepts', 'concept_edges', 'concept_claims'],
  'signals-by-claim': ['signals', 'claims', 'bridge_claims', 'evidence'],
  'thesis-reports': ['thesis_reports', 'theses'],
  'research-papers': ['papers'],
  'research-export': ['papers', 'thread_papers', 'research_threads'],
  'scout-companies': ['companies', 'scout_verticals', 'company_events'],
  'scout-events': ['company_events', 'companies'],
  'external-scan': ['scan_items', 'scan_runs', 'scan_topics'],
  'signals-export': ['signals', 'sources', 'signal_candidates', 'claims', 'bridge_claims'],
  'intel-items': ['intel_items', 'intel_runs', 'intel_companies', 'intel_facts'],
  'intel-companies': ['intel_companies'],
  'intel-facts': ['intel_facts', 'intel_companies', 'intel_items'],
  'intel-metrics': ['intel_metrics', 'intel_companies'],
  'tooling-products': ['tooling_products', 'tooling_categories'],
  'tooling-events': ['tooling_events', 'tooling_products'],
  'tooling-features': ['tooling_products'],
  'tooling-catalog': ['tooling_products', 'tooling_categories'],
  catalog: [],
};

export function groupTables(tableNames: string[]): Record<SubsystemGroup, string[]> {
  const out = {} as Record<SubsystemGroup, string[]>;
  for (const g of Object.keys(GROUP_LABELS) as SubsystemGroup[]) out[g] = [];
  for (const name of tableNames) {
    const group = SUBSYSTEMS[name];
    if (!group) throw new Error(`No subsystem group for table "${name}"; add it to SUBSYSTEMS in lib/schema/layout.ts.`);
    out[group].push(name);
  }
  return out;
}

export interface ClusterEdge { from: SubsystemGroup; to: SubsystemGroup; count: number }

// FK edges aggregated to group pairs, undirected (a<b canonicalized) and
// deduped, with a count of how many underlying FKs contribute. Self-edges
// (both endpoints in the same group) are dropped: the map draws cross-group
// lines only.
export function clusterEdges(tables: SchemaTable[]): ClusterEdge[] {
  const counts = new Map<string, number>();
  for (const t of tables) {
    const fromGroup = SUBSYSTEMS[t.name];
    if (!fromGroup) throw new Error(`No subsystem group for table "${t.name}"; add it to SUBSYSTEMS in lib/schema/layout.ts.`);
    for (const fk of t.fks) {
      const toGroup = SUBSYSTEMS[fk.refTable];
      if (!toGroup || toGroup === fromGroup) continue;
      const [a, b] = [fromGroup, toGroup].sort();
      const key = `${a}\u0000${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('\u0000') as [SubsystemGroup, SubsystemGroup];
      return { from, to, count };
    })
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export interface LaidGroup {
  key: SubsystemGroup;
  label: string;
  tableCount: number;
  totalRows: number;
  tables: SchemaTable[]; // sorted by row count desc
  col: number;
  row: number;
}

// Deterministic grid layout: groups in a fixed, alphabetical-by-key order
// (stable across renders and across a schema that gains/loses tables), 4
// columns wide, wrapping to as many rows as needed. Tables within a group
// are sorted by row count descending.
const GRID_COLS = 4;

export function layoutGroups(tables: SchemaTable[]): LaidGroup[] {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const grouped = groupTables(tables.map((t) => t.name));
  const keys = (Object.keys(GROUP_LABELS) as SubsystemGroup[]).filter((k) => grouped[k].length > 0);
  return keys.map((key, i) => {
    const groupTablesList = grouped[key]
      .map((name) => byName.get(name)!)
      .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
    return {
      key,
      label: GROUP_LABELS[key],
      tableCount: groupTablesList.length,
      totalRows: groupTablesList.reduce((sum, t) => sum + t.rows, 0),
      tables: groupTablesList,
      col: i % GRID_COLS,
      row: Math.floor(i / GRID_COLS),
    };
  });
}
