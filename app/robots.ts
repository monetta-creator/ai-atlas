import type { MetadataRoute } from 'next';
import { ALL_GROUPS } from '@/lib/nav';

// robots.txt (2026-09-27): the reader surfaces are open to crawlers; every
// admin page (every `access: 'admin'` leaf in the nav tree, so a new admin
// page is covered without an edit here), the API, the login page and the
// unlisted showcase deck are not. Disallowing is advice to polite crawlers,
// not access control: every admin page gates itself (adminGate).
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_BASE_URL ?? '').replace(/\/$/, '');
  const adminPaths = new Set<string>();
  for (const g of ALL_GROUPS) {
    if (g.access === 'admin') adminPaths.add(g.href);
    for (const l of g.children) if (l.access === 'admin') adminPaths.add(l.href);
  }
  // Robots rules are PREFIX matches, so an admin page's bare path would also
  // hide a public sibling that merely starts with it (/data would block
  // /datasets). Each admin path is listed exactly ($) and as a folder (/).
  const exact = [...adminPaths].sort().flatMap((p) => [`${p}$`, `${p}/`]);
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/login', '/showcase', ...exact],
    },
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
