import Link from 'next/link';
import type { BridgeClaim } from '@/lib/types';
import { DOMAIN_LABEL } from '@/lib/format';
import ConfidenceBadge from './ConfidenceBadge';

export default function BridgeBand({
  bridges,
  admin,
}: {
  bridges: BridgeClaim[];
  admin: boolean;
}) {
  if (!bridges.length) return null;
  return (
    <section>
      <div className="section-label">Bridge-claims connecting out</div>
      <div className="bridge-band">
        {bridges.map((b) => (
          <Link key={b.id} href={`/bridge/${b.code}`} className="bridge-link">
            <span className="bl-code">⤧ {b.code}</span>
            <span className="bl-statement">{b.statement}</span>
            <span className="bl-domains">
              {DOMAIN_LABEL[b.domain_from]} → {DOMAIN_LABEL[b.domain_to]}
            </span>
            {admin && <ConfidenceBadge label={b.confidence_label} />}
          </Link>
        ))}
      </div>
    </section>
  );
}
