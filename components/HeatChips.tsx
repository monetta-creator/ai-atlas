import { heatFill, heatVar } from '@/lib/format';
import type { ConvictionLabel } from '@/lib/types';

// The five-chip conviction meter (Console design system): chips fill cool→warm
// with the raw 0–1 conviction; the color comes from the band label.
export default function HeatChips({
  conviction,
  label,
}: {
  conviction: number | null;
  label: ConvictionLabel;
}) {
  const filled = heatFill(conviction);
  const color = heatVar(label);
  return (
    <span className="heat-chips" aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <i
          key={i}
          style={{
            width: 7,
            height: 12,
            borderRadius: 2,
            background: i < filled ? color : 'var(--line)',
            display: 'inline-block',
          }}
        />
      ))}
    </span>
  );
}
