import type { Stance } from '@/lib/types';
import ConfidenceBadge from './ConfidenceBadge';

export default function StanceCard({
  stance,
  admin,
  opposing,
  evidence,
}: {
  stance: Stance;
  admin: boolean;
  opposing: string[];
  evidence?: { supports: number; contradicts: number; neutral: number };
}) {
  const evTotal = evidence ? evidence.supports + evidence.contradicts + evidence.neutral : 0;
  return (
    <div className="stance" style={{ marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="stance-head">
        <div style={{ flex: 1 }}>
          <div className="who">{stance.code}</div>
          <h3>{stance.title}</h3>
        </div>
        {admin && <ConfidenceBadge label={stance.confidence_label} />}
      </div>

      {stance.holder && (
        <p style={{ fontSize: 12.5, color: 'var(--faint-ink)', margin: '8px 0 0' }}>
          Held by {stance.holder}
        </p>
      )}
      {stance.summary && <p className="strongest">{stance.summary}</p>}

      <div
        style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--line)' }}
      >
        <div className="test">
          <span className="tlabel">would move me off</span>
          <span>{stance.test}</span>
        </div>
        {opposing.length > 0 && (
          <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 10 }}>
            Strongest opposing:{' '}
            <span style={{ color: 'var(--contradicts)', fontWeight: 500 }}>{opposing.join(', ')}</span>
          </p>
        )}
        {evTotal > 0 && evidence && (
          <p style={{ fontSize: 11.5, color: 'var(--faint-ink)', marginTop: 10 }}>
            Evidence behind its claims:{' '}
            <span style={{ color: 'var(--supports)', fontWeight: 500 }}>{evidence.supports} support</span>
            {' · '}
            <span style={{ color: 'var(--contradicts)', fontWeight: 500 }}>{evidence.contradicts} contradict</span>
            {evidence.neutral > 0 && <> · {evidence.neutral} neutral</>}
          </p>
        )}
      </div>
    </div>
  );
}
