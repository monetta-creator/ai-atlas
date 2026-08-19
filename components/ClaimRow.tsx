import Link from 'next/link';
import type { Claim } from '@/lib/types';
import { DOMAIN_LABEL, RESOLVABILITY_LABEL } from '@/lib/format';
import HeatChips from './HeatChips';

export default function ClaimRow({ claim, admin }: { claim: Claim; admin: boolean }) {
  const showConf = admin && claim.confidence != null;
  return (
    <Link
      href={`/claim/${encodeURIComponent(claim.code)}`}
      className="claim"
      style={showConf ? undefined : { gridTemplateColumns: '1fr' }}
    >
      {showConf && (
        <div className="conf">
          <HeatChips confidence={claim.confidence} label={claim.confidence_label} />
        </div>
      )}
      <div className="ctext">
        <p className="ct">
          {claim.code} · {claim.statement}
        </p>
        {claim.test && (
          <div className="test">
            <span className="tlabel">would falsify</span>
            <span>{claim.test}</span>
          </div>
        )}
        {(claim.domain || claim.resolvability || claim.reflexive) && (
          <div className="cmeta">
            {claim.domain && <span className="tag">{DOMAIN_LABEL[claim.domain]}</span>}
            {claim.resolvability && <span>{RESOLVABILITY_LABEL[claim.resolvability]} to resolve</span>}
            {claim.reflexive && <span style={{ color: 'var(--accent)' }}>⟳ reflexive</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
