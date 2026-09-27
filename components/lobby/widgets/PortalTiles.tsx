import Link from 'next/link';
import { portalGroups } from '@/lib/nav';
import { PORTAL_ICONS, NAV_ICONS } from '@/components/portal-icons';
import { pageInfoFor } from '@/lib/page-info';

// One compact row of every portal (bare: draws its own `.lw-portals` chrome,
// no `.lw-card` wrapper, mirrors the old lobby tile grid but denser). Pure
// and data-free beyond portalGroups()/pageInfoFor(), so no try/catch is
// needed here (nothing can throw beyond a render bug).
function icon(key: string) {
  return PORTAL_ICONS[key] ?? NAV_ICONS[key];
}

// The explainer's summary is a full paragraph; a tile line wants one clause.
function firstClause(summary: string, max = 80): string {
  const sentence = summary.split(/(?<=[.!?])\s+/)[0] ?? summary;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, max - 1).trimEnd()}…`;
}

export default function PortalTiles({}: { personal: boolean }) {
  const tiles = portalGroups().map((g) => {
    const info = pageInfoFor(g.href);
    return { key: g.key, href: g.href, icon: g.icon, label: g.label, desc: info ? firstClause(info.summary) : '' };
  });
  return (
    <div className="lw-portals">
      <div className="lw-head">Portals</div>
      <div className="lw-portals-grid">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} className="lw-portals-tile">
            {icon(t.icon)}
            <span className="lw-portals-body">
              <span className="lw-portals-name">{t.label}</span>
              <span className="lw-portals-desc">{t.desc}</span>
            </span>
          </Link>
        ))}
        <Link href="/portals" className="lw-portals-tile lw-portals-all">
          {icon('portals')}
          <span className="lw-portals-body">
            <span className="lw-portals-name">All portals</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
