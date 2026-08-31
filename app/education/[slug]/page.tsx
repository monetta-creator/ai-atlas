import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Header from '@/components/Header';
import { isAdmin } from '@/lib/auth';
import { getGuide } from '@/lib/education/registry';
import GuideAgenticHarnesses from '@/components/education/agentic-harnesses';

// A single Education guide. force-dynamic (reads the admin cookie for the
// Header, same as every other public reader page). The guide body is a
// standalone component per slug (built alongside app/styles/education.css
// in a parallel task); this page only looks up the metadata and dispatches
// to the right body.
export const dynamic = 'force-dynamic';

const GUIDE_BODIES: Record<string, ReactNode> = {
  'agentic-harnesses': <GuideAgenticHarnesses />,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  return { title: guide ? `${guide.title} · The AI Atlas` : 'Education · The AI Atlas' };
}

export default async function EducationGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();

  const admin = await isAdmin();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap edu" style={{ maxWidth: 980, paddingBottom: 100 }}>
        <header className="pagehead">
          <div className="qcode">{guide.kicker}</div>
          <h1>{guide.title}</h1>
          <div className="flex items-center gap-3" style={{ marginTop: 18 }}>
            <Link href="/education" className="btn btn--ghost btn--sm">← All guides</Link>
            {guide.hasDeck && (
              <Link href={`/education/${guide.slug}/deck`} className="btn btn--primary btn--sm">
                View as 16:9 deck
              </Link>
            )}
          </div>
        </header>

        {GUIDE_BODIES[guide.slug] ?? null}
      </section>
    </>
  );
}
