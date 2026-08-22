import { q } from '../db';
import type {
  Evidence, Hypothesis, Rationale, } from '../types';

// Strip the personal layer (conviction) before it ever leaves the server for a
// guest. The public structure (statements/tests/evidence directions) stays; the
// private judgment does not. This is the structural firewall behind the share view.
export function strip(h: Hypothesis, personal: boolean): Hypothesis {
  return personal ? h : { ...h, conviction: null, conviction_label: null, last_moved: null };
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

export async function getEvidenceFor(hypothesisId: string, personal: boolean): Promise<Evidence[]> {
  // source_id is nullable (a signal can be its own source), so both joins are
  // LEFT. signal_title gives the page "via <signal>" provenance. Signal-derived
  // evidence only exists for PUBLISHED signals, so no publish gating needed here.
  const rows = await q<Evidence>(
    `select ev.id, ev.hypothesis_id, ev.source_id, ev.signal_id, ev.direction,
            ev.confidence, ev.excerpt, ev.note, ev.actor, ev.created_at,
            s.title as source_title, s.outlet as source_outlet, s.reliability_prior,
            sig.title as signal_title
       from evidence ev
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where ev.hypothesis_id = $1
      order by ev.created_at desc`,
    [hypothesisId]
  );
  return personal ? rows : rows.map((r) => ({ ...r, reliability_prior: null, note: null }));
}

export async function getRationales(hypothesisId: string): Promise<Rationale[]> {
  // Resolve the cited evidence (if any) so the history shows what triggered the move.
  return q<Rationale>(
    `select r.*, ev.excerpt as evidence_excerpt, ev.direction as evidence_direction,
            coalesce(s.title, sig.title) as evidence_source
       from rationales r
       left join evidence ev on ev.id = r.evidence_id
       left join sources s on s.id = ev.source_id
       left join signals sig on sig.id = ev.signal_id
      where r.hypothesis_id = $1
      order by r.created_at desc`,
    [hypothesisId]
  );
}
