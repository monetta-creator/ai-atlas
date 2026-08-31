import Link from 'next/link';
import Header from '@/components/Header';
import Editable from '@/components/Editable';
import { getEditContext } from '@/lib/content';
import { isAdmin } from '@/lib/auth';
import { GUIDES } from '@/lib/education/registry';

// The Education hub: a public shelf of standalone guides, distinct from the
// Signal Board feed and the Argument Map. Follows app/about/page.tsx's shape
// (Header + .pagehead + a .qgrid of cards) rather than reinventing markup.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Education · The AI Atlas' };

export default async function EducationPage() {
  const admin = await isAdmin();
  const { editing, txt } = await getEditContext();

  return (
    <>
      <Header admin={admin} />
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <header className="pagehead">
          <Editable
            as="h1"
            k="education.hub.title"
            value={txt('education.hub.title', 'Education')}
            editing={editing}
          />
          <Editable
            as="p"
            className="lede"
            multiline
            k="education.hub.lede"
            value={txt(
              'education.hub.lede',
              'Guides worth keeping: things learned along the way, written up properly and given a permanent home. Not a feed, a shelf.'
            )}
            editing={editing}
          />
        </header>

        <div className="qgrid" style={{ paddingBottom: 8 }}>
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/education/${g.slug}`} className="qcard">
              <div className="qcode">
                {g.kicker}
                <span className="lens">· {g.addedOn}</span>
              </div>
              <h3>{g.title}</h3>
              <p className="blurb">{g.summary}</p>
              <div className="qstats">
                {g.topics.join(' · ')}
                {g.hasDeck && <span> · 16:9 deck</span>}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
