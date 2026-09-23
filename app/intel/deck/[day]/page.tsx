import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortalIdentity } from '@/lib/portal/identity';
import { getIntelDeckForDay, listIntelDecks } from '@/lib/data/intel-deck';
import { buildIntelDeck } from '@/lib/intel/deck-pure';
import { renderDeckSlides } from '@/components/costs-deck/slides';
import DeckController from '@/components/costs-deck/DeckController';
import { dateLabel } from '@/lib/format';
import { isRealDay } from '@/lib/route-shapes';

// One day's company intel deck on the live 16:9 stage. Portal-only: an
// access-key holder or the admin sees the deck; anyone else sees a plate
// explaining what it is and how to request a key (never a 404 that hides
// the product, never the company names). The route is chromeless
// (lib/nav.ts isChromeless), so the plate paints its own minimal frame.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ day: string }> }): Promise<Metadata> {
  const { day } = await params;
  return { title: `Company intel deck, ${dateLabel(day) ?? day} · The AI Atlas` };
}

function Plate({ title, body, links }: { title: string; body: string; links: { href: string; label: string; primary?: boolean }[] }) {
  return (
    <main className="wrap" style={{ maxWidth: 640, paddingTop: 96, paddingBottom: 96 }}>
      <div className="plate">
        <p style={{ fontFamily: 'var(--font-mono, var(--font-body))', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--faint-ink)', margin: '0 0 10px' }}>
          Company intel deck
        </p>
        <h1 style={{ margin: '0 0 12px', fontSize: 26 }}>{title}</h1>
        <p style={{ color: 'var(--dim)', fontSize: 14.5, lineHeight: 1.6, margin: '0 0 22px', maxWidth: '56ch' }}>{body}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={l.primary ? 'btn btn--primary' : 'btn btn--quiet'}>{l.label}</Link>
          ))}
        </div>
      </div>
    </main>
  );
}

export default async function IntelDeckDayPage({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  const identity = await getPortalIdentity();
  const allowed = identity.tier === 'admin' || identity.active;

  if (!allowed) {
    return (
      <Plate
        title="Keyholders only"
        body={
          identity.state === 'expired'
            ? 'Your access key has expired. Ask the maintainer to renew it and this deck opens again.'
            : 'Every weekday the Intel Desk collects what each tracked company did the day before: headlines, filings, extracted facts, metric moves, and a one-line read. The deck names tracked companies, so it opens with an access key.'
        }
        links={[{ href: '/datasets/request', label: 'Request an access key', primary: true }, { href: '/reports', label: 'Report Portal' }]}
      />
    );
  }

  if (day === 'none') {
    return (
      <Plate
        title="No deck yet"
        body="The first company intel deck builds at 16:20 UTC on the next weekday the Intel Desk runs."
        links={[{ href: '/reports', label: 'Report Portal', primary: true }]}
      />
    );
  }
  if (!isRealDay(day)) notFound();

  const saved = await getIntelDeckForDay(day);
  if (!saved || (!saved.is_published && identity.tier !== 'admin')) {
    const recent = await listIntelDecks(1);
    return (
      <Plate
        title={`No deck for ${dateLabel(day) ?? day}`}
        body={recent.length ? `The most recent deck is ${dateLabel(recent[0].scope_to) ?? recent[0].scope_to}.` : 'No company intel deck has been built yet.'}
        links={recent.length ? [{ href: `/intel/deck/${recent[0].scope_to}`, label: 'Open the latest deck', primary: true }, { href: '/reports', label: 'Report Portal' }] : [{ href: '/reports', label: 'Report Portal', primary: true }]}
      />
    );
  }

  const origin = process.env.APP_BASE_URL || '';
  const deck = buildIntelDeck(saved, origin);
  return (
    <DeckController
      slides={renderDeckSlides(deck)}
      backHref="/reports"
      pdfHref={`/intel/deck/${day}/pdf`}
    />
  );
}
