import {
  SIGNAL_CONTEXT_LABEL, SIGNAL_CONTEXT_COLOR, SIGNIFICANCE_LABEL, significanceColor,
} from '@/lib/format';
import type { SignalContext, Significance } from '@/lib/types';

// Context pill, tinted by the context's identity color (a calm accent, never a fill).
export function ContextBadge({ context }: { context: SignalContext }) {
  if (!context) return null;
  const color = SIGNAL_CONTEXT_COLOR[context];
  return (
    <span className="signal-lenses">
      <span
        className="badge signal-lens-badge"
        style={{
          color,
          borderColor: `color-mix(in oklab, ${color} 38%, var(--line))`,
          background: `color-mix(in oklab, ${color} 7%, var(--surface))`,
        }}
      >
        {SIGNAL_CONTEXT_LABEL[context]}
      </span>
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
