import { confidenceText, heatFill } from '@/lib/format';
import type { ConfidenceLabel } from '@/lib/types';

// The Console confidence renderer: five cells fill cool→warm with the raw
// confidence; each lit cell carries its own heat-step color. Admin-only —
// callers gate on `admin` and pass the (non-null) confidence number.
export default function HeatChips({
  confidence,
  label,
}: {
  confidence: number | null;
  label?: ConfidenceLabel;
}) {
  const fill = heatFill(confidence);
  return (
    <div className="heat-chips" title={label ? confidenceText(label) : undefined}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i
          key={i}
          style={i < fill ? { background: `var(--heat-${i})`, opacity: 0.95 } : undefined}
        />
      ))}
    </div>
  );
}
