'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { isChromeless } from '@/lib/nav';

// The site chrome (rail + header bar, the server-rendered <Header>) is rendered
// ONCE in the root layout, so it persists across client navigation instead of
// remounting on every click. This gate hides it on the chromeless routes
// (lib/nav.ts isChromeless): login, showcase, the deck stages, print digests.
export default function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  if (isChromeless(pathname)) return null;
  return <>{children}</>;
}
