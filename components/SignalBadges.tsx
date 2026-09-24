import {
  SIGNAL_LENS_LABEL, SIGNAL_LENS_COLOR, SIGNIFICANCE_LABEL, significanceColor,
  EVIDENCE_TYPE_LABEL,
} from '@/lib/format';
import type { SignalLens, Significance, EvidenceType } from '@/lib/types';

// Lens pills, tinted by each lens's identity color (a calm accent, never a fill).
export function LensBadges({ lenses }: { lenses: SignalLens[] }) {
  if (!lenses?.length) return null;
  return (
    <span className="signal-lenses">
      {lenses.map((l) => (
        <span
          key={l}
          className="badge signal-lens-badge"
          style={{
            color: SIGNAL_LENS_COLOR[l],
            borderColor: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 38%, var(--line))`,
            background: `color-mix(in oklab, ${SIGNAL_LENS_COLOR[l]} 7%, var(--surface))`,
          }}
        >
          {SIGNAL_LENS_LABEL[l]}
        </span>
      ))}
    </span>
  );
}

// High/Medium/Low — a small mono tag with a colored dot (warm = High).
export function SignificanceTag({ significance }: { significance: Significance }) {
  const color = significanceColor(significance);
  return (
    <span className="sig-tag" style={{ color }} title={`Significance: ${SIGNIFICANCE_LABEL[significance]}`}>
      <span className="sig-dot" style={{ background: color }} />
      {SIGNIFICANCE_LABEL[significance]}
    </span>
  );
}

// A quiet, uncolored tag for what KIND of evidence a signal is (a study vs. an
// announcement), not what it is about. Renders nothing when unclassified.
export function EvidenceTypeTag({ evidenceType }: { evidenceType?: EvidenceType | null }) {
  if (!evidenceType) return null;
  return (
    <span className="sig-tag" style={{ color: 'var(--faint-ink)' }} title="Evidence type">
      {EVIDENCE_TYPE_LABEL[evidenceType]}
    </span>
  );
}
