import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortalIdentity } from '@/lib/portal/identity';
import { getSavantIssue, listSavantIssues } from '@/lib/data/savant-issues';
import { dateLabel } from '@/lib/format';
import { isRealDay } from '@/lib/route-shapes';
import PageTop from '@/components/PageTop';
import SavantView from '@/components/savant/SavantView';
import SavantTeaser from '@/components/savant/SavantTeaser';
import SavantPdfButton from '@/components/savant/SavantPdfButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ week: string }> }): Promise<Metadata> {
  const { week } = await params;
  if (!isRealDay(week)) return { title: 'Savant · The AI Atlas' };
  return { title: `Savant, week ending ${dateLabel(week) ?? week} · The AI Atlas` };
}

// One archived issue, exactly as it published. Same key gate as /savant;
// guests see the teaser for that week instead of the issue.
export default async function SavantWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!isRealDay(week)) notFound();

  const identity = await getPortalIdentity();
  const allowed = identity.tier === 'admin' || identity.active;

  const [saved, list] = await Promise.all([
    getSavantIssue(week),
    listSavantIssues(200, identity.tier !== 'admin'),
  ]);
  if (!saved || (!saved.is_published && identity.tier !== 'admin')) notFound();

  const sorted = [...list].sort((a, b) => a.week_end.localeCompare(b.week_end));
  const idx = sorted.findIndex((e) => e.week_end === week);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
      <PageTop
        pathname={`/savant/${week}`}
        label={`Week ending ${dateLabel(week) ?? week}`}
        infoKey="/savant/[week]"
        viewer={{ admin: identity.tier === 'admin', portal: identity.active }}
        action={allowed ? <SavantPdfButton week={week} /> : undefined}
      >
        <span className="flex items-center gap-3 flex-wrap">
          {prev ? (
            <Link href={`/savant/${prev.week_end}`}>&larr; {dateLabel(prev.week_end)}</Link>
          ) : (
            <span style={{ color: 'var(--faint-ink)' }}>&larr; earlier</span>
          )}
          <span style={{ color: 'var(--faint-ink)' }}>·</span>
          {next ? (
            <Link href={`/savant/${next.week_end}`}>{dateLabel(next.week_end)} &rarr;</Link>
          ) : (
            <span style={{ color: 'var(--faint-ink)' }}>later &rarr;</span>
          )}
        </span>
      </PageTop>

      {allowed ? <SavantView saved={saved} /> : <SavantTeaser title={saved.narrative.title} />}
    </section>
  );
}
