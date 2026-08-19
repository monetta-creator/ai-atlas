import { exec } from '../db';
import type { RiskLevel } from '../supply-chain/map';

// ---- Supply chain overlay (the /supply-chain admin layer) -------------------
// The map structure lives in lib/supply-chain/map.ts; these write only the mutable
// overlay (per-node risk + note) and the node -> signal links, keyed by slug.

export async function setSupplyChainNodeMeta(
  slug: string,
  input: { risk_level: RiskLevel | null; admin_note: string | null }
): Promise<void> {
  await exec(
    `insert into supply_chain_node_meta (slug, risk_level, admin_note)
     values ($1, $2, $3)
     on conflict (slug) do update
        set risk_level = excluded.risk_level,
            admin_note = excluded.admin_note,
            updated_at = now()`,
    [slug, input.risk_level, input.admin_note]
  );
}

export async function linkSignalToNode(slug: string, signalId: string): Promise<void> {
  await exec(
    `insert into supply_chain_node_signals (node_slug, signal_id)
     values ($1, $2)
     on conflict (node_slug, signal_id) do nothing`,
    [slug, signalId]
  );
}

export async function unlinkSignalFromNode(slug: string, signalId: string): Promise<void> {
  await exec(
    `delete from supply_chain_node_signals where node_slug = $1 and signal_id = $2`,
    [slug, signalId]
  );
}
