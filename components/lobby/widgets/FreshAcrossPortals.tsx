import Link from 'next/link';
import { getNewEntrants, getTrackedSince, getRecentSignals } from '@/lib/data';
import { dateLabel } from '@/lib/format';

// Three short columns of what is new across the portals this week, all from
// the exact public reads the guest-facing pages and widgets already use
// (ToolingEntrants' viewer object, the research digest's tracked-since read,
// the Signal Board's recent-signals read), so nothing here can leak a draft
// or an admin-only field. Each column degrades on its own: one read failing
// never blanks the other two.
const SEVEN_DAYS_AGO = () => new Date(new Date().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);

async function newTools() {
  try {
    const rows = await getNewEntrants(SEVEN_DAYS_AGO(), { admin: false, portal: false }, { limit: 3 });
    return rows.map((p) => ({ id: p.id, href: `/tooling/${p.slug}`, label: p.name, date: p.first_seen }));
  } catch {
    return null;
  }
}

async function newPapers() {
  try {
    const rows = await getTrackedSince(SEVEN_DAYS_AGO());
    return rows.slice(0, 3).map((p) => ({ id: p.id, href: `/research/${p.id}`, label: p.title, date: p.reviewed_at }));
  } catch {
    return null;
  }
}

async function newSignals() {
  try {
    const since = SEVEN_DAYS_AGO();
    // The ten newest, then the last seven days' first three (no dated reader exists).
    const rows = await getRecentSignals(10);
    const fresh = rows.filter((s) => s.published_on >= since).slice(0, 3);
    return fresh.map((s) => ({ id: s.id, href: `/signals/${s.id}`, label: s.headline, date: s.published_on }));
  } catch {
    return null;
  }
}

function Column({ title, items }: { title: string; items: { id: string; href: string; label: string; date: string | null }[] | null }) {
  return (
    <div className="lw-fresh-col">
      <div className="lw-fresh-title">{title}</div>
      {items === null ? (
        <p className="lw-fail">Widget unavailable</p>
      ) : items.length === 0 ? (
        <p className="lw-sub">Nothing new this week.</p>
      ) : (
        <ul className="lw-fresh-list">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={it.href}>{it.label}</Link>
              {it.date && <span className="lw-fresh-date">{dateLabel(it.date)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function FreshAcrossPortals({}: { personal: boolean }) {
  const [tools, papers, signals] = await Promise.all([newTools(), newPapers(), newSignals()]);
  return (
    <>
      <div className="lw-head">New this week</div>
      <div className="lw-fresh-grid">
        <Column title="New tools" items={tools} />
        <Column title="New papers" items={papers} />
        <Column title="New signals" items={signals} />
      </div>
    </>
  );
}
