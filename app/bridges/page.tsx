import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { getBridges, getAsOf } from '@/lib/data';
import { getEditContext } from '@/lib/content';
import { DOMAIN_LABEL, relationColor } from '@/lib/format';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import ConfidenceBadge from '@/components/ConfidenceBadge';
import ShareNotice from '@/components/ShareNotice';

export const dynamic = 'force-dynamic';

export default async function BridgesPage() {
  const admin = await isAdmin();
  const preview = await isPreview();
  const personal = admin && !preview;
  const { editing, txt } = await getEditContext();
  const [bridges, asOf] = await Promise.all([getBridges(personal), getAsOf()]);

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <div className="crumbs">
          <Link href="/map">Map</Link> / Bridges
        </div>

        {!personal && <ShareNotice asOf={asOf} />}

        <header className="pagehead" style={{ padding: '24px 0 32px' }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <Editable
                as="h1"
                k="bridges.title"
                value={txt('bridges.title', 'Bridge-claims · the spine')}
                editing={editing}
              />
              {/* lede has embedded <em> markup (between/within emphasis); Editable's value is
                  plain text, so converting it would flatten that emphasis. Left static. */}
              <p className="lede">
                Bridge-claims are statements about the causal link <em>between</em> domains, not claims{' '}
                <em>within</em> one. Each has its own test and confidence, and is fed by claims from either
                domain.
              </p>
            </div>
            {personal && (
              <Link href="/bridge/new" className="btn btn--primary" style={{ marginTop: 6, whiteSpace: 'nowrap' }}>
                Add bridge-claim
              </Link>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-[var(--gap)]">
          {bridges.map(({ bridge, fedBy }) => (
            <div key={bridge.id} className="bridge">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/bridge/${bridge.code}`} className="btag" style={{ marginBottom: 0 }}>
                  ⤧ {bridge.code}
                </Link>
                {personal && <ConfidenceBadge label={bridge.confidence_label} />}
              </div>
              <div className="domains">
                <span className="domain">{DOMAIN_LABEL[bridge.domain_from]}</span>
                <span className="arrow">
                  <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M1 7h22M18 2l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="domain">{DOMAIN_LABEL[bridge.domain_to]}</span>
                {bridge.reflexive && <span className="domain" style={{ color: 'var(--accent)' }}>⟳ reflexive</span>}
              </div>
              <Link href={`/bridge/${bridge.code}`} className="block group">
                <h3 style={{ marginBottom: 14 }}>{bridge.statement}</h3>
              </Link>
              {fedBy.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="lbl" style={{ fontSize: 9.5 }}>fed by</span>
                  {fedBy.map((f, i) => (
                    <Link
                      key={i}
                      href={`/claim/${encodeURIComponent(f.claim_code)}`}
                      className="text-[11px]"
                      style={{ color: 'var(--faint-ink)' }}
                    >
                      <span className={relationColor(f.relation as never)}>
                        {f.relation === 'supports' ? '+' : f.relation === 'contradicts' ? '−' : '·'}
                      </span>{' '}
                      {f.claim_code}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
