import {
  SIGNAL_LENS_LABEL, SIGNAL_LENS_COLOR, SIGNIFICANCE_LABEL, significanceColor,
} from '@/lib/format';
import type { SignalLens, Significance } from '@/lib/types';

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
