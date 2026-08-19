// Server reads for the /supply-chain surface. Co-located rather than folded into the
// already-large lib/data.ts, to keep this surface self-contained. The static structure
// comes from ./map; the DB contributes only the overlay (effective risk, admin note) and
// the linked signals, resolved by slug at read time. Guests get published-only signals
// and never the admin note (the personal layer for this surface).

import { q, one } from '@/lib/db';
import { SIGNAL_COLUMNS } from '@/lib/data';
import { SC_LAYERS, SC_EDGES, SC_NODES, SC_NODE_BY_SLUG } from '@/lib/supply-chain/map';
import type { RiskLevel, ScEdge, ScLayer, ScNodeView } from '@/lib/supply-chain/map';
import type { Signal } from '@/lib/types';

export interface SupplyChainData {
  layers: ScLayer[];
  nodes: ScNodeView[];
  edges: ScEdge[];
}

export interface ScNodeDetail {
  node: ScNodeView;
  admin_note: string | null; // null for guests
  risk_override: RiskLevel | null; // the raw overlay value (null = using the stub default); admin form needs it
  signals: Signal[]; // published-only for guests
}

const RECENT_DAYS = 14;

// The whole graph plus its overlay: effective risk per node, signal counts, and the
// 14-day recency flag that drives the ambient pulse. Two cheap queries, then a merge.
export async function getSupplyChain(personal: boolean): Promise<SupplyChainData> {
  const meta = await q<{ slug: string; risk_level: RiskLevel | null }>(
    `select slug, risk_level from supply_chain_node_meta`
  );
  const riskBySlug = new Map(meta.map((m) => [m.slug, m.risk_level]));

  // node_slug values not present in the map are harmless: they never match a node below.
  const agg = await q<{ node_slug: string; n: number; recent: boolean }>(
    `select l.node_slug,
            count(*)::int as n,
            bool_or(s.published_at >= now() - interval '14 days') as recent
       from supply_chain_node_signals l
       join signals s on s.id = l.signal_id
      ${personal ? '' : 'where s.is_published = true'}
      group by l.node_slug`
  );
  const aggBySlug = new Map(agg.map((a) => [a.node_slug, a]));

  const nodes: ScNodeView[] = SC_NODES.map((n) => {
    const a = aggBySlug.get(n.slug);
    return {
      ...n,
      risk: riskBySlug.get(n.slug) ?? n.riskDefault, // overlay wins, else the stub default
      signalCount: a?.n ?? 0,
      hasRecentSignal: a?.recent ?? false,
    };
  });

  return { layers: SC_LAYERS, nodes, edges: SC_EDGES };
}

// One node's detail for the drawer: effective risk, the admin note (admins only), and the
// linked signals (published-only for guests), most recent first.
export async function getSupplyChainNode(slug: string, personal: boolean): Promise<ScNodeDetail | null> {
  const base = SC_NODE_BY_SLUG.get(slug);
  if (!base) return null;

  const overlay = await one<{ risk_level: RiskLevel | null; admin_note: string | null }>(
    `select risk_level, admin_note from supply_chain_node_meta where slug = $1`,
    [slug]
  );

  const signals = await q<Signal>(
    `select ${SIGNAL_COLUMNS}
       from supply_chain_node_signals l
       join signals s on s.id = l.signal_id
       left join sources src on src.id = s.source_id
      where l.node_slug = $1 ${personal ? '' : 'and s.is_published = true'}
      order by s.published_at desc, s.created_at desc`,
    [slug]
  );

  const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const hasRecentSignal = signals.some(
    (s) => s.published_at != null && new Date(s.published_at).getTime() >= cutoff
  );

  return {
    node: {
      ...base,
      risk: overlay?.risk_level ?? base.riskDefault,
      signalCount: signals.length,
      hasRecentSignal,
    },
    admin_note: personal ? overlay?.admin_note ?? null : null,
    risk_override: personal ? overlay?.risk_level ?? null : null,
    signals,
  };
}
