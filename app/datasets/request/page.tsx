import Link from 'next/link';
import { getPortalIdentity } from '@/lib/portal/identity';
import { requestsOpen } from '@/lib/portal/keys';
import PageTop from '@/components/PageTop';
import RequestAccessForm from '@/components/access/RequestAccessForm';
import RenewalNotice from '@/components/portal/RenewalNotice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request access · The AI Atlas' };

// The public door to the key-gated tier: what an access key unlocks, who
// approves it, and the form. Reader-facing copy: "access key" and "the
// maintainer", never a name or an employer. A visitor whose key has lapsed
// sees the renewal notice above the form.
export default async function RequestAccessPage() {
  const identity = await getPortalIdentity();
  const admin = identity.tier === 'admin';
  // The route fails closed without an approved-domain list, so the page says
  // so instead of showing a form that would only ever return an error.
  const open = requestsOpen(process.env.PORTAL_REQUEST_EMAIL_DOMAINS);

  return (
    <>
      <section className="wrap" style={{ maxWidth: 760, paddingBottom: 100 }}>
        <PageTop pathname="/datasets/request" label="Request access" viewer={{ admin, portal: identity.active }} />

        <RenewalNotice identity={identity} style={{ marginBottom: 24 }} />

        {identity.active && identity.tier !== 'admin' && (
          <p className="text-sm" style={{ color: 'var(--dim)', marginBottom: 20 }}>
            Your key is active already. Use this form only to ask for a key for someone else, or a fresh one for yourself.
          </p>
        )}

        <div style={{ maxWidth: 640, marginBottom: 26 }}>
          <div className="section-label">What a key unlocks</div>
          <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--dim)' }}>
            <li>The <Link href="/ask">Ask</Link> workspace: questions answered from the Atlas records with citations, a live model call per turn.</li>
            <li>The key-gated exports on the <Link href="/datasets">Data Portal</Link>: retained article text and machine-extracted records, as CSV or JSON, in the browser or from a script.</li>
            <li>Generating <Link href="/tooling/reports">tooling reports</Link> and the Scout research tools.</li>
          </ul>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--dim)', margin: '12px 0 0' }}>
            Public datasets, the Signal Board, the News Blotter and the Argument Map need no key. A key adds no write access
            and never shows the Atlas&apos;s personal layer (confidence values, rationales, source priors).
          </p>
        </div>

        <div style={{ maxWidth: 640, marginBottom: 26 }}>
          <div className="section-label">How it works</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--dim)', margin: '10px 0 0' }}>
            Requests go to the maintainer, who approves them by hand. Work addresses on approved domains are accepted;
            other addresses may be declined. On approval the key arrives by a link the maintainer sends: open it once and
            this browser stays unlocked until the key expires (usually 90 days, renewable). Keys are personal and can be
            revoked; each one carries its own daily Ask budget.
          </p>
        </div>

        {open ? (
          <RequestAccessForm />
        ) : (
          <div className="plate" style={{ maxWidth: 640 }}>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--dim)', margin: 0 }}>
              Requests are not open yet. Ask the maintainer directly for an access key.
            </p>
          </div>
        )}

        <p style={{ fontSize: 12.5, color: 'var(--faint-ink)', lineHeight: 1.7, maxWidth: 640, marginTop: 20 }}>
          Already have a key? Paste it on the <Link href="/ask">Ask</Link> page to unlock this browser.
        </p>
      </section>
    </>
  );
}
