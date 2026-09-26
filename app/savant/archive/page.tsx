import Link from 'next/link';
import { getPortalIdentity } from '@/lib/portal/identity';
import { listSavantIssueMetas } from '@/lib/data/savant-issues';
import { toSheetCard } from '@/lib/reports/cards';
import ReportCover from '@/components/reports/ReportCover';
import PageTop from '@/components/PageTop';
import { SAVANT_STRAPLINE } from '@/lib/savant/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Savant archive · The AI Atlas' };

// Every past issue, newest first, as the Report Portal's own cover cards
// (components/reports/ReportCover, the CSS miniature of the branded PDF
// cover) in an .rp-grid, so an issue reads exactly like it does on /reports.
// Key-gated like the issue itself: an access-key holder or the admin gets
// the grid; anyone else gets the masthead and a plate pointing at how to
// get a key, never the list of issue titles (a title can name what the
// week's peer watch covered).
export default async function SavantArchivePage() {
  const identity = await getPortalIdentity();
  const allowed = identity.tier === 'admin' || identity.active;
  const metas = allowed ? await listSavantIssueMetas(identity.tier !== 'admin') : [];
  const cards = metas.map(toSheetCard);

  return (
    <section className="wrap rp-wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
      <PageTop
        pathname="/savant/archive"
        label="Archive"
        infoKey="/savant/archive"
        viewer={{ admin: identity.tier === 'admin', portal: identity.active }}
      />

      {!allowed ? (
        <div className="sv-wrap">
          <div className="sv-masthead">
            <div>
              <p className="sv-wordmark">THE AI ATLAS</p>
              <p className="sv-signature">Savant</p>
            </div>
          </div>
          <p className="sv-strapline">{SAVANT_STRAPLINE}</p>
          <div className="sv-rule" />
          <div className="plate sv-lockplate">
            <p className="sv-lock-head">Read with an access key</p>
            <p className="sv-lock-body">
              The Savant archive lists every past issue by title, and a title can name what that week&rsquo;s peer and
              market watch covered. It needs an access key or the admin password.
            </p>
            <div className="sv-lock-actions">
              <Link href="/datasets/request" className="btn btn--primary btn--sm">Request an access key</Link>
              <Link href="/reports" className="btn btn--quiet btn--sm">Report Portal</Link>
            </div>
          </div>
        </div>
      ) : cards.length === 0 ? (
        <p style={{ color: 'var(--faint-ink)', marginTop: 24 }}>No issues yet.</p>
      ) : (
        <div className="rp-grid">
          {cards.map((card) => (
            <article key={card.id} className="rp-card" data-kind={card.kind}>
              <Link href={card.href} className="rp-cover-link" aria-label={`Read ${card.title}`}>
                <ReportCover card={card} />
              </Link>
              <div className="rp-info">
                <div className="rp-kicker">
                  {card.kindLabel}
                  {!card.isPublished ? ' · draft' : ''}
                </div>
                <Link href={card.href} className="rp-title">{card.title}</Link>
                {card.subject && <div className="rp-subject">{card.subject}</div>}
                {card.chips.length > 0 && <div className="rp-chips">{card.chips.join(' · ')}</div>}
                <div className="rp-foot">
                  <span className="rp-date">{card.date}</span>
                  <div className="rp-actions">
                    <a href={card.pdfHref} className="btn btn--ghost btn--sm">PDF</a>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
