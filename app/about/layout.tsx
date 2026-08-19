import type { ReactNode } from 'react';
import { isAdmin } from '@/lib/auth';
import Header from '@/components/Header';
import AboutNav from '@/components/AboutNav';

// One shell for the whole About section: the single Header, the tabbed sub-nav,
// and the page container. The six page files render content only. They must NOT
// render <Header> or .wrap themselves. force-dynamic lives here because isAdmin()
// reads cookies.
export const dynamic = 'force-dynamic';

export default async function AboutLayout({ children }: { children: ReactNode }) {
  const admin = await isAdmin();
  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        <AboutNav />
        {children}
      </section>
    </>
  );
}
