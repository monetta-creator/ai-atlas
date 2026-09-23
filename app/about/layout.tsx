import type { ReactNode } from 'react';

// One shell for the whole About section: the page container (the chrome is
// in the root layout). The section's own tabs now come from PageTop (each page renders
// its own, since the pathname and label differ per page). The six page files
// render content only, starting with their own PageTop. They must NOT render
// <Header> or .wrap themselves.
export const dynamic = 'force-dynamic';

export default function AboutLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <section className="wrap" style={{ maxWidth: 820, paddingBottom: 100 }}>
        {children}
      </section>
    </>
  );
}
