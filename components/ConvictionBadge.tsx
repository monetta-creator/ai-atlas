import { convictionText, heatVar } from '@/lib/format';
import type { ConvictionLabel } from '@/lib/types';

// Inline conviction renderer (Console .heat-dot): a heat-colored dot + the word.
export default function ConvictionBadge({
  label,
  size = 'sm',
}: {
  label: ConvictionLabel;
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
      <span style={{ color }}>{convictionText(label)}</span>
    </span>
  );
}
