import type { ReactNode } from 'react';
import { isAdmin } from '@/lib/auth';
import Header from '@/components/Header';

// One shell for the whole About section: the single Header and the page
// container. The section's own tabs now come from PageTop (each page renders
// its own, since the pathname and label differ per page). The six page files
// render content only, starting with their own PageTop. They must NOT render
// <Header> or .wrap themselves. force-dynamic lives here because isAdmin()
// reads cookies.
export const dynamic = 'force-dynamic';

export default async function AboutLayout({ children }: { children: ReactNode }) {
  const admin = await isAdmin();
  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        {children}
      </section>
    </>
  );
}
