import type { Metadata } from 'next';
import { getPortalIdentity } from '@/lib/portal/identity';
import { getLatestSavantIssue } from '@/lib/data/savant-issues';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';
import SavantView from '@/components/savant/SavantView';
import SavantTeaser from '@/components/savant/SavantTeaser';
import SavantPdfButton from '@/components/savant/SavantPdfButton';

// The latest Savant issue. Key-gated like the company intel deck: an
// access-key holder or the admin sees the full issue, anyone else sees the
// masthead, the table of contents, and a plate pointing at how to get a key
// (never a 404 that hides the product, never anything from the pack or the
// narrative beyond the issue's own title).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Savant · The AI Atlas' };

export default async function SavantLatestPage() {
  const identity = await getPortalIdentity();
  const allowed = identity.tier === 'admin' || identity.active;
  const saved = await getLatestSavantIssue(identity.tier !== 'admin');

  return (
    <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
      <PageTop
        pathname="/savant"
        label="Savant"
        viewer={{ admin: identity.tier === 'admin', portal: identity.active }}
        action={saved && allowed ? <SavantPdfButton week={saved.week_end} /> : undefined}
      >
        {saved ? `Issue No. ${saved.pack.issueNumber} · Week ending ${dateLabel(saved.week_end)}` : null}
      </PageTop>

      {!saved ? (
        <div className="plate">
          <p style={{ margin: 0 }}>The first issue writes itself Friday 20:00 UTC.</p>
        </div>
      ) : allowed ? (
        <SavantView saved={saved} />
      ) : (
        <SavantTeaser title={saved.narrative.title} />
      )}
    </section>
  );
}
