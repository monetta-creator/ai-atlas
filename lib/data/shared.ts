import { q } from '../db';
import type {
  Claim, Evidence, Rationale, } from '../types';

// Strip the personal layer (confidence) before it ever leaves the server for a
// guest. The map (questions/stances/claims/bridges/tests/evidence) stays; the
// private read does not. This is the structural firewall behind the share view.
export function strip<T extends { confidence: number | null; confidence_label: unknown }>(
  row: T, personal: boolean
): T {
  return personal ? row : { ...row, confidence: null, confidence_label: null };
}

// Claims carry an extra private field (the raw seed domain note) that must also
// be withheld from guests at the data layer.
export function stripClaim(c: Claim, personal: boolean): Claim {
  if (personal) return c;
  return { ...c, confidence: null, confidence_label: null, domain_note: null };
}

interface EvidenceCounts {
  supports: number;
  contradicts: number;
  neutral: number;
  oneSided: boolean;
}

export function countEvidence(rows: Evidence[]): EvidenceCounts {
  const supports = rows.filter((r) => r.direction === 'supports').length;
  const contradicts = rows.filter((r) => r.direction === 'contradicts').length;
  const neutral = rows.filter((r) => r.direction === 'neutral').length;
  const oneSided =
    (supports >= 2 && contradicts === 0) || (contradicts >= 2 && supports === 0);
  return { supports, contradicts, neutral, oneSided };
}

export async function getEvidenceFor(
  targetType: 'claim' | 'bridge_claim', targetId: string, personal: boolean
): Promise<Evidence[]> {
  // source_id is nullable since 0006 (a signal can be its own source), so both joins
  // are LEFT. signal_title gives the claim page "via <signal>" provenance. Signal-derived
  // evidence only exists for PUBLISHED signals, so no publish gating is needed here.
  const rows = await q<Evidence>(
    `select ev.*, s.title as source_title, s.outlet as source_outlet, s.reliability_prior,
            sig.title as signal_title
       from evidence ev
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where ev.target_type = $1 and ev.target_id = $2
      order by ev.created_at desc`,
    [targetType, targetId]
  );
  return personal ? rows : rows.map((r) => ({ ...r, reliability_prior: null, note: null }));
}

export async function getRationales(
  targetType: string, targetId: string
): Promise<Rationale[]> {
  // Resolve the cited evidence (if any) so the history can show what triggered the move.
  return q<Rationale>(
    `select r.*, ev.excerpt as evidence_excerpt, ev.direction as evidence_direction,
            coalesce(s.title, sig.title) as evidence_source
       from rationales r
       left join evidence ev on ev.id = r.evidence_id
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where r.target_type = $1 and r.target_id = $2
      order by r.created_at desc`,
    [targetType, targetId]
  );
}
