import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdmin, isPreview } from '@/lib/auth';
import { getEditionForDay, listEditions } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import Header from '@/components/Header';
import PageTop from '@/components/PageTop';
import EditionView from '@/components/edition/EditionView';
import EditionPdfButton from '@/components/edition/EditionPdfButton';

export const dynamic = 'force-dynamic';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shape AND calendar: '2026-02-30' passes the regex but Postgres throws on
// the ::date cast, which would 500 instead of 404.
function isRealDay(s: string): boolean {
  if (!DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Cheap and never throws: a bad or missing day just falls back to the
// generic title, the page body 404s on its own read.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ day: string }>;
}): Promise<Metadata> {
  const { day } = await params;
  if (!isRealDay(day)) return { title: 'Daily edition · The AI Atlas' };
  return { title: `Daily edition, ${dateLabel(day)} · The AI Atlas` };
}

// The archive read of one day's edition. Public once published; admins (out
// of preview) can also open an unpublished day to check a run before it
// goes out. Prev/next walk the full day index so the reader can page through
// the archive without going back to the calendar.
export default async function BlotterDay({ params }: { params: Promise<{ day: string }> }) {
  const { day } = await params;
  if (!isRealDay(day)) notFound();

  const admin = (await isAdmin()) && !(await isPreview());
  const [edition, list] = await Promise.all([
    getEditionForDay(day),
    listEditions(400, !admin),
  ]);
  if (!edition || !(edition.is_published || admin)) notFound();

  const sorted = [...list].sort((a, b) => a.day.localeCompare(b.day));
  const idx = sorted.findIndex((e) => e.day === day);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
        <PageTop
          pathname={`/blotter/${day}`}
          label={dateLabel(day) ?? day}
          infoKey="/blotter/[day]"
          compact
          viewer={{ admin, portal: admin }}
          action={<EditionPdfButton day={day} />}
        >
          <span className="flex items-center gap-3 flex-wrap">
            {prev ? (
              <Link href={`/blotter/${prev.day}`}>&larr; {dateLabel(prev.day)}</Link>
            ) : (
              <span style={{ color: 'var(--faint-ink)' }}>&larr; earlier</span>
            )}
            <span style={{ color: 'var(--faint-ink)' }}>·</span>
            {next ? (
              <Link href={`/blotter/${next.day}`}>{dateLabel(next.day)} &rarr;</Link>
            ) : (
              <span style={{ color: 'var(--faint-ink)' }}>later &rarr;</span>
            )}
          </span>
        </PageTop>

        <EditionView edition={edition} admin={admin} />
      </section>
    </>
  );
}
