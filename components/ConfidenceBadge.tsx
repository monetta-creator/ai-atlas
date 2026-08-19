import { confidenceText, heatVar } from '@/lib/format';
import type { ConfidenceLabel } from '@/lib/types';

// Inline confidence renderer (Console .heat-dot): a heat-colored dot + the word.
export default function ConfidenceBadge({
  label,
  size = 'sm',
}: {
  label: ConfidenceLabel;
  size?: 'sm' | 'md';
}) {
  const md = size === 'md';
  const color = heatVar(label);
  return (
    <span className="heat-dot" style={md ? { fontSize: '13px' } : undefined}>
      <b
        style={{
          background: color,
          width: md ? '12px' : undefined,
          height: md ? '12px' : undefined,
        }}
      />
      <span style={{ color }}>{confidenceText(label)}</span>
    </span>
  );
}
