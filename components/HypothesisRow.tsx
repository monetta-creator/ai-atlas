import Link from 'next/link';
import type { Hypothesis } from '@/lib/types';
import { RESOLVABILITY_LABEL } from '@/lib/format';
import HeatChips from './HeatChips';

// One ledger row on the hypothesis board. Conviction (the chips) is the personal
// layer — rendered only for the admin; guests get the statement, test, and the
// public evidence/signal tallies.
export default function HypothesisRow({ hypothesis, admin }: { hypothesis: Hypothesis; admin: boolean }) {
  const h = hypothesis;
  const showConviction = admin && h.conviction != null;
  return (
    <Link
      href={`/hypothesis/${encodeURIComponent(h.code)}`}
      className="claim"
      style={showConviction ? undefined : { gridTemplateColumns: '1fr' }}
    >
      {showConviction && (
        <div className="conf">
          <HeatChips conviction={h.conviction} label={h.conviction_label} />
        </div>
      )}
      <div className="ctext">
        <p className="ct">
          {h.code} · {h.statement}
        </p>
        {h.test && (
          <div className="test">
            <span className="tlabel">would falsify</span>
            <span>{h.test}</span>
          </div>
        )}
        <div className="cmeta">
          {h.status !== 'active' && <span className="tag">{h.status}</span>}
          {h.resolvability && <span>{RESOLVABILITY_LABEL[h.resolvability]} to resolve</span>}
          {typeof h.evidence_count === 'number' && (
            <span>{h.evidence_count} evidence</span>
          )}
          {typeof h.signal_count === 'number' && h.signal_count > 0 && (
            <span>{h.signal_count} signal{h.signal_count === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
