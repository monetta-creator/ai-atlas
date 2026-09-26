import Link from 'next/link';
import PageTop from '@/components/PageTop';
import { PORTAL_ICONS, NAV_ICONS } from '@/components/portal-icons';
import { getPortalIdentity } from '@/lib/portal/identity';
import { canSee, portalGroups } from '@/lib/nav';
import { pageInfoFor } from '@/lib/page-info';

// The portals directory (2026-09-26): the page form of the rail's Portals
// folder. One card per portal the viewer may see: icon, name, the portal's
// own one-line summary (lib/page-info), and its pages as chips, filtered
// to what this viewer can open. Pure over lib/nav; no DB.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Portals · The AI Atlas' };

export default async function PortalsPage() {
  const identity = await getPortalIdentity();
  const viewer = { admin: identity.tier === 'admin', portal: identity.active };
  const groups = portalGroups().filter((g) => canSee(g.access, viewer));

  return (
    <section className="wrap" style={{ maxWidth: 1080, paddingBottom: 100 }}>
      <PageTop pathname="/portals" label="Portals" viewer={viewer} />
      <div className="pd-grid">
        {groups.map((g) => {
          const info = pageInfoFor(g.href);
          const pages = g.children.filter((l) => !l.hidden && canSee(l.access, viewer));
          return (
            <article key={g.key} className="pd-card">
              <Link href={g.href} className="pd-head">
                <span className="pd-icon">{PORTAL_ICONS[g.icon] ?? NAV_ICONS[g.icon]}</span>
                <span className="pd-name">{g.label}</span>
              </Link>
              {info?.summary && <p className="pd-summary">{info.summary}</p>}
              {pages.length > 0 && (
                <div className="pd-pages">
                  {pages.map((l) => (
                    <Link key={l.href} href={l.href} className="pd-page" data-access={l.access}>
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
