import { fitBand } from '@/lib/tooling/report-core';
import { FIT_BAND_LABEL } from './labels';
import type { ToolingScores } from '@/lib/types';

const DIMENSION_LABEL: Record<Exclude<keyof ToolingScores, 'steal'>, string> = {
  relevance: 'Relevance',
  enterprise_readiness: 'Enterprise readiness',
  differentiation: 'Differentiation',
  momentum: 'Momentum',
  build_difficulty: 'Build difficulty',
};
const DIMENSIONS = Object.keys(DIMENSION_LABEL) as (keyof typeof DIMENSION_LABEL)[];

// The scoring agent's read (portal + admin only; agent_fit/agent_scores are
// portal-tier columns). Recommend-only: nothing here writes anything.
export default function AgentReadPanel({
  fit, scores, reason,
}: {
  fit: number | null | undefined;
  scores: ToolingScores | null | undefined;
  reason: string | null | undefined;
}) {
  const band = fitBand(fit ?? null);
  if (!band) return null;
  return (
    <div className="rounded-[var(--radius)] border p-3" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
      <div className="flex items-center flex-wrap gap-2">
        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>✦ {FIT_BAND_LABEL[band]}</span>
        <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>{fit}/100</span>
      </div>
      {scores && (
        <div className="flex flex-col gap-1.5" style={{ marginTop: 10 }}>
          {DIMENSIONS.map((d) => (
            <div key={d} className="flex items-center gap-2" style={{ fontSize: 12 }}>
              <span style={{ width: 150, color: 'var(--dim)' }}>{DIMENSION_LABEL[d]}</span>
              <span style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--line)', overflow: 'hidden', display: 'inline-block' }}>
                <span
                  style={{
                    display: 'block', height: '100%', borderRadius: 999, background: 'var(--accent)',
                    width: `${Math.max(0, Math.min(5, scores[d] ?? 0)) / 5 * 100}%`,
                  }}
                />
              </span>
              <span style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', width: 26, textAlign: 'right' }}>
                {scores[d]}/5
              </span>
            </div>
          ))}
        </div>
      )}
      {scores?.steal && scores.steal.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5" style={{ marginTop: 10 }}>
          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>Worth stealing:</span>
          {scores.steal.map((s) => (
            <span key={s} className="badge badge--accent" style={{ fontSize: 11 }}>{s}</span>
          ))}
        </div>
      )}
      {reason && <p className="text-sm" style={{ color: 'var(--dim)', marginTop: 10 }}>{reason}</p>}
    </div>
  );
}
