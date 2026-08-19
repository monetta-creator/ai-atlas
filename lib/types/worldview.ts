import type { BridgeClaim, ConfidenceLabel, Direction, NodeType } from './core';
// ---- Calibration viewer (the snapshot/rationale time-series reader) ----
// Every confidence move writes a full `snapshots` row + a `rationales` row; this is
// the reader over that history. The personal layer in visible form, so admin-only.
export interface CalibrationSnapshot {
  at: string;                 // pre-formatted display date
  trigger: string;            // manual | post_commit | scheduled
  bands: { thin: number; contested: number; leaning: number; settled: number };
  total: number;              // nodes with a (non-null) confidence at this snapshot
}

export interface CalibrationTrajectory {
  type: NodeType | 'position';
  id: string;
  code: string | null;        // positions have no code
  label: string;
  href: string;
  points: { at: string; confidence: number }[];  // confidence at each snapshot it appears in
  first: number;
  current: number;
  moves: number;              // number of changes across the series
}

export interface CalibrationMove {
  id: string;
  at: string;                 // pre-formatted display date
  code: string | null;
  label: string;
  href: string | null;
  old_confidence: number | null;
  new_confidence: number | null;
  reason: string;
  evidence_excerpt: string | null;
  evidence_direction: Direction | null;
  evidence_source: string | null;
}

export interface CalibrationData {
  snapshots: CalibrationSnapshot[];
  trajectories: CalibrationTrajectory[];
  moves: CalibrationMove[];
  totals: { snapshots: number; moves: number; nodesMoved: number; firstAt: string | null; lastAt: string | null };
}

// ---- Phase 7: Worldview & Spine (cross-cutting positions, §3.3) ----
// A node the author can attach to a cross-cutting position, listed in the picker.
export interface NodeOption {
  type: NodeType;            // stance | claim | bridge_claim
  id: string;
  code: string;
  label: string;             // stance title / claim or bridge statement
  question: string | null;   // owning question title (stances only)
}

// One resolved component of a position, with a link to the node it points at.
export interface WorldviewComponent {
  id: string;                // the position_components row id (for removal)
  type: NodeType;
  code: string;
  label: string;
  href: string;              // /claim/[code] · /bridge/[code] · /q/[slug]
}

export interface WorldviewPosition {
  id: string;
  statement: string;
  confidence: number | null;
  confidence_label: ConfidenceLabel;
  private: boolean;
  components: WorldviewComponent[];
}

export interface Worldview {
  spine: BridgeClaim[];           // the bridge-claims, the highest-leverage objects
  positions: WorldviewPosition[]; // the author's spanning views
}
