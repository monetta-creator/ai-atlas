import type { MetadataRoute } from 'next';
import { ALL_GROUPS } from '@/lib/nav';
import { GUIDES } from '@/lib/education/registry';

// sitemap.xml (2026-09-27): every public page in the nav tree (hubs and
// public leaves, never a portal-only or admin one), plus each education
// guide. Derived from the tree, so a new public page is listed without an
// edit here. Detail pages (a signal, a claim, an issue) are reachable from
// these and are left to discovery.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const paths = new Set<string>(['/']);
  for (const g of ALL_GROUPS) {
    if (g.access !== 'public') continue;
    paths.add(g.href);
    for (const l of g.children) if (l.access === 'public' && !l.hidden) paths.add(l.href);
  }
  for (const guide of GUIDES) paths.add(`/education/${guide.slug}`);
  const now = new Date();
  return [...paths].sort().map((p) => ({
    url: `${base}${p}`,
    lastModified: now,
    changeFrequency: p === '/' || p.startsWith('/blotter') || p.startsWith('/signals') ? 'daily' : 'weekly',
    priority: p === '/' ? 1 : p.split('/').length <= 2 ? 0.8 : 0.5,
  }));
}
