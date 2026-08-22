import Link from 'next/link';
import type { CalibrationMove } from '@/lib/types';
import { heatVar, convictionBand } from '@/lib/format';

// "Recent conviction moves": the personal-layer pulse of the board.
// Admin-only (rendered only when personal); reuses getCalibration().moves. Shows the
// five most recent moves with their required rationale.
export default function ConvictionMovementPanel({ moves }: { moves: CalibrationMove[] }) {
  const recent = moves.slice(0, 5);
  return (
    <div className="ls-card">
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div className="section-label" style={{ margin: 0 }}>Recent conviction moves</div>
        <Link href="/calibration" className="text-xs" style={{ color: 'var(--accent)' }}>Calibration →</Link>
      </div>
      {recent.length === 0 ? (
        <p className="ls-empty">No conviction moves recorded yet. Every move you commit lands here.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {recent.map((mv) => (
            <div key={mv.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {mv.href ? (
                  <Link href={mv.href} style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                    {mv.code ?? mv.label.slice(0, 36)}
                  </Link>
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{mv.label.slice(0, 36)}</span>
                )}
                <span style={{ display: 'inline-flex', gap: 4, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: heatVar(convictionBand(mv.old_conviction)) }}>{mv.old_conviction?.toFixed(2) ?? '–'}</span>
                  <span style={{ color: 'var(--faint-ink)' }}>→</span>
                  <span style={{ color: heatVar(convictionBand(mv.new_conviction)) }}>{mv.new_conviction?.toFixed(2) ?? '–'}</span>
                </span>
                <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>· {mv.at}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--dim)', margin: 0, lineHeight: 1.45 }}>{mv.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
