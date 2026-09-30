import Link from 'next/link';
import PackDownloads from './PackDownloads';

// The Briefcase band on the Data Portal hub: its own object above the
// catalog, not another dataset card. A keyholder gets the reader
// organization's three downloads in place; a guest sees what it is and the
// way in, and never a company name (the registry is private).
export default function BriefcaseBand({
  unlocked, self, companies,
}: {
  unlocked: boolean;
  self: { slug: string; name: string } | null;
  companies: number;
}) {
  return (
    <section className="bc-band" aria-labelledby="bc-band-title">
      <div className="bc-band-copy">
        <p className="bc-kicker">Briefcase</p>
        <h2 id="bc-band-title" className="bc-band-title">Company context, packed for a model</h2>
        <p className="bc-band-line">
          Everything public the Atlas holds about a tracked company, as markdown a model can read and rows a
          search index can load. Cited line by line.
        </p>
      </div>
      <div className="bc-band-side">
        {unlocked && self ? (
          <>
            <p className="bc-band-for">{self.name}</p>
            <PackDownloads slug={self.slug} />
            <Link className="bc-band-all" href="/datasets/briefcase">
              All {companies} companies
            </Link>
          </>
        ) : (
          <>
            <p className="bc-band-for">Read with an access key</p>
            <div className="bc-band-actions">
              <Link className="btn btn--primary btn--sm" href="/datasets/briefcase">Open the Briefcase</Link>
              <Link className="btn btn--ghost btn--sm" href="/datasets/request">Request access</Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
