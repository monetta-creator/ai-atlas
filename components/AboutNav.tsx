'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Sub-nav for the About section. Reuses the header's .navlinks styling (and its
// .active rule); .about-nav adds the rhythm + bottom hairline so it reads as a
// secondary nav. Identical for guest and admin, since these pages are public.
// Architecture is deliberately unlisted (the page still renders at its URL);
// the reading guide was deleted 2026-08-15 (its route redirects here).
const TABS = [
  { href: '/about', label: 'Overview' },
  { href: '/about/guardrails', label: 'Guardrails' },
  { href: '/about/glossary', label: 'Glossary' },
  { href: '/about/limitations', label: 'Limitations' },
];

export default function AboutNav() {
  const pathname = usePathname();
  return (
    <nav className="about-nav navlinks" aria-label="About sections">
      {TABS.map((t) => {
        // Overview matches exactly so it isn't lit on every sub-page.
        const active = t.href === '/about' ? pathname === '/about' : pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={active ? 'active' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
