import Link from 'next/link';
import { getNavCounts } from '@/lib/data';

// The working queues, mirroring SiteNav's admin badge hrefs (Papers/Scout
// route into their consoles, not the public portal pages, since this widget
// is about what needs review).
const LINKS: { href: string; label: string; key: 'pipeline' | 'drafts' | 'papers' | 'scout' | 'tickets' | null }[] = [
  { href: '/pipeline', label: 'Pipeline', key: 'pipeline' },
  { href: '/signals/drafts', label: 'Drafts', key: 'drafts' },
  { href: '/research/console', label: 'Papers', key: 'papers' },
  { href: '/scout/console', label: 'Scout', key: 'scout' },
  { href: '/tickets', label: 'Tickets', key: 'tickets' },
  { href: '/sources', label: 'Sources', key: null },
];

export default async function DeskCounts() {
  let counts: Awaited<ReturnType<typeof getNavCounts>>;
  try {
    counts = await getNavCounts();
  } catch {
    return <div className="lw-fail">Widget unavailable</div>;
  }
  return (
    <>
      <div className="lw-head">Desk</div>
      <div className="lw-deskgrid">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="btn btn--ghost btn--sm">
            {l.label}{l.key && counts[l.key] > 0 ? ` · ${counts[l.key]}` : ''}
          </Link>
        ))}
      </div>
    </>
  );
}
