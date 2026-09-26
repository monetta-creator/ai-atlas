import Link from 'next/link';
import { isAdmin, isPreview } from '@/lib/auth';
import { listEditions } from '@/lib/data';
import { dateLabel } from '@/lib/format';
import PageTop from '@/components/PageTop';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edition archive · The AI Atlas' };

// A month-grouped calendar of every past edition, newest first within each
// month. Guests see published editions only; admins (out of preview) also
// see days that ran but were never published.
function monthLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async function BlotterArchive() {
  const admin = (await isAdmin()) && !(await isPreview());
  const editions = await listEditions(120, !admin);

  const byMonth = new Map<string, typeof editions>();
  for (const e of editions) {
    const key = e.day.slice(0, 7);
    const bucket = byMonth.get(key) ?? [];
    bucket.push(e);
    byMonth.set(key, bucket);
  }
  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <>
      <section className="wrap" style={{ maxWidth: 780, paddingBottom: 100 }}>
        <PageTop pathname="/blotter/archive" label="Archive" viewer={{ admin, portal: admin }} />

        {months.length === 0 && (
          <p style={{ color: 'var(--faint-ink)', marginTop: 24 }}>No editions yet.</p>
        )}

        {months.map((m) => {
          const rows = [...(byMonth.get(m) ?? [])].sort((a, b) => b.day.localeCompare(a.day));
          return (
            <div key={m} style={{ marginTop: 32 }}>
              <div className="section-label">{monthLabel(rows[0].day)}</div>
              <ul className="bs-list bs-list--archive">
                {rows.map((e) => (
                  <li key={e.id}>
                    <Link href={`/blotter/${e.day}`} className="bs-row">
                      <span className="bs-wire-date">{dateLabel(e.day)}</span>
                      <span className="bs-rowbody">
                        <span className="bs-rowhed">{e.headline ?? `Edition of ${dateLabel(e.day)}`}</span>
                      </span>
                      {e.numbers && (
                        <span className="bs-fig">
                          <span className="bs-fig-n">{e.numbers.itemsRead}</span>
                          <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>items read</span>
                        </span>
                      )}
                    </Link>
                    <a
                      className="btn btn--ghost btn--sm"
                      href={`/blotter/${e.day}/pdf`}
                      aria-label={`PDF of the ${dateLabel(e.day)} edition`}
                    >
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </>
  );
}
