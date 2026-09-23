import Link from 'next/link';
import type { ReactNode } from 'react';
import { pathwayFor, tabsFor, leafFor, groupFor, type NavViewer, type BadgeKey } from '@/lib/nav';
import { pageInfoFor, PAGE_INFO, type PageInfoContent } from '@/lib/page-info';
import PageInfo from './PageInfo';

// The one page-top grammar (2026-09-23): a pathway row with the "i" at its
// right edge, the title row with an optional primary action, and the group's
// tabs when the viewer can see two or more sibling pages. No lede: the
// explanatory sentence lives in the info dialog. Server component; the
// title may be a string or a node (an Editable h1).
export default function PageTop({
  pathname, label, title, action, viewer, counts, info, infoKey, compact, children,
}: {
  pathname: string;
  label: string;                       // the page's name in the pathway (plain text)
  title?: ReactNode;                   // defaults to <h1>{label}</h1>; pass null when the body owns the h1 (read views)
  action?: ReactNode;                  // right-aligned primary action
  viewer: NavViewer;
  counts?: Partial<Record<BadgeKey, number>> | null;
  info?: PageInfoContent | null;       // defaults to the registry entry for the route
  infoKey?: string;                    // explicit registry key (detail pages: '/claim', '/signals/[id]')
  compact?: boolean;                   // statement-length titles: display face, smaller
  children?: ReactNode;                // optional status line under the tabs (cadence, counts)
}) {
  const segs = pathwayFor(pathname, label);
  const tabs = tabsFor(pathname, viewer);
  const group = groupFor(pathname);
  const current = group ? leafFor(pathname, group) : null;
  const content = info !== undefined ? info : infoKey ? (PAGE_INFO[infoKey] ?? null) : pageInfoFor(pathname);

  return (
    <header className="pagetop" data-compact={compact ? '' : undefined}>
      <div className="pagetop-path">
        <nav aria-label="Pathway" className="pagetop-crumbs">
          {segs.map((s, i) => (
            <span key={`${s.label}-${i}`} className="pagetop-seg">
              {i > 0 && <span className="pagetop-sepglyph" aria-hidden="true">›</span>}
              {s.href ? <Link href={s.href}>{s.label}</Link> : <span aria-current="page">{s.label}</span>}
            </span>
          ))}
        </nav>
        {content && <PageInfo content={content} />}
      </div>
      {(title !== null || action) && (
        <div className="pagetop-title">
          {title === undefined ? <h1>{label}</h1> : title}
          {action && <div className="pagetop-action">{action}</div>}
        </div>
      )}
      {tabs.length > 0 && (
        <nav className="pagetop-tabs" role="tablist" aria-label="Section pages">
          {tabs.map((t) => {
            const active = current ? current.href === t.href : pathname === t.href;
            const n = t.badge && counts ? counts[t.badge] ?? 0 : 0;
            return (
              <Link key={t.href} href={t.href} className="pagetop-tab" data-active={active ? '' : undefined} role="tab" aria-selected={active}>
                {t.label}
                {n > 0 && <span className="pagetop-tab-badge">{n}</span>}
              </Link>
            );
          })}
        </nav>
      )}
      {children && <div className="pagetop-status">{children}</div>}
    </header>
  );
}
