import Link from 'next/link';
import type { Metadata } from 'next';
import { getPortalIdentity } from '@/lib/portal/identity';
import { getSelfRecord } from '@/lib/data/self-record';
import { dateLabel, SELF_RECORD_SOURCE_LABEL } from '@/lib/format';
import { descriptionFor } from '@/lib/page-info';
import PageTop from '@/components/PageTop';
import { SAVANT_STRAPLINE } from '@/lib/savant/types';

// The public record behind Savant's cited profile (mig 0076): every filing,
// press release, news item, paper, patent and regulatory document the
// one-time backfill found for the reader organization, since ChatGPT.
// Key-gated exactly like the rest of Savant (it names the reader
// organization); a guest gets the same keyholders-only plate the other
// Savant pages use, never the company's name or record list.
export const dynamic = 'force-dynamic';
const EXPORT_URL = '/api/datasets/company-record';
export const metadata: Metadata = { title: 'Company record · Savant · The AI Atlas', description: descriptionFor('/savant/record') };

function LockPlate() {
  return (
    <div className="sv-wrap">
      <div className="sv-masthead">
        <div>
          <p className="sv-wordmark">THE AI ATLAS</p>
          <p className="sv-signature">Savant</p>
        </div>
      </div>
      <p className="sv-strapline">{SAVANT_STRAPLINE}</p>
      <div className="sv-rule" />
      <div className="plate sv-lockplate">
        <p className="sv-lock-head">Read with an access key</p>
        <p className="sv-lock-body">
          The company record names the reader organization directly, so it needs an access key or the admin
          password. Request one, or see what else the Report Portal has published without a key.
        </p>
        <div className="sv-lock-actions">
          <Link href="/datasets/request" className="btn btn--primary btn--sm">Request an access key</Link>
          <Link href="/reports" className="btn btn--quiet btn--sm">Report Portal</Link>
        </div>
      </div>
    </div>
  );
}

export default async function SavantRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; ai?: string }>;
}) {
  const identity = await getPortalIdentity();
  const allowed = identity.tier === 'admin' || identity.active;
  const viewer = { admin: identity.tier === 'admin', portal: identity.active };

  if (!allowed) {
    return (
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <PageTop pathname="/savant/record" label="Company record" viewer={viewer} />
        <LockPlate />
      </section>
    );
  }

  const { source, ai } = await searchParams;
  const aiOnly = ai === '1';
  const data = await getSelfRecord({ source, ai: aiOnly });

  if (!data) {
    return (
      <section className="wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
        <PageTop pathname="/savant/record" label="Company record" viewer={viewer} />
        <p style={{ color: 'var(--faint-ink)', marginTop: 24 }}>No public record has been built yet.</p>
      </section>
    );
  }

  const baseHref = (next: { source?: string | null; ai?: boolean | null }): string => {
    const params = new URLSearchParams();
    const nextSource = next.source === undefined ? source : next.source;
    const nextAi = next.ai === undefined ? aiOnly : next.ai;
    if (nextSource) params.set('source', nextSource);
    if (nextAi) params.set('ai', '1');
    const qs = params.toString();
    return qs ? `/savant/record?${qs}` : '/savant/record';
  };

  return (
    <section className="wrap sr-wrap" style={{ maxWidth: 900, paddingBottom: 100 }}>
      <PageTop
        pathname="/savant/record"
        label="Company record"
        viewer={viewer}
        title={<h1>{data.company.name}: the public record</h1>}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {/* File downloads from the key-gated datasets route: plain anchors, never client navigation. */}
            <a className="btn btn--sm" href={`${EXPORT_URL}?format=csv&download=1`}>CSV</a>
            <a className="btn btn--sm" href={`${EXPORT_URL}?format=json&download=1`}>JSON</a>
            <Link className="btn btn--quiet btn--sm" href="/datasets/company-record">Dataset</Link>
            <Link className="btn btn--quiet btn--sm" href="/datasets/briefcase">Context packs</Link>
          </div>
        }
      />

      {data.profile.length > 0 && (
        <div className="sv-section sr-profile">
          <h2 className="sv-h2">The cited profile</h2>
          <p className="sr-note">What Savant reads about the reader organization, sentence by sentence, each with the public record it cites.</p>
          <ol className="sr-sentences">
            {data.profile.map((p, i) => (
              <li key={i}>
                {p.text}
                {p.hrefs.length > 0 && (
                  <span className="sr-sources">
                    {p.hrefs.map((h, j) => (
                      <a key={h} href={h} target="_blank" rel="noopener noreferrer">[{j + 1}]</a>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.timelineByYear.length > 0 && (
        <div className="sv-section sr-timeline">
          <h2 className="sv-h2">The AI timeline</h2>
          {data.timelineByYear.map((y) => (
            <div key={y.year} className="sr-year">
              <div className="sr-year-label">{y.year}</div>
              <div className="sr-year-events">
                {y.events.map((e) => (
                  <div key={e.id} className="sr-event">
                    <div className="sr-event-date">{dateLabel(e.date)}</div>
                    <div className="sr-event-body">
                      <div className="sr-event-headline">{e.headline}</div>
                      {e.body && <p className="sr-event-text">{e.body}</p>}
                      {e.hrefs.length > 0 && (
                        <span className="sr-sources">
                          {e.hrefs.map((h, j) => (
                            <a key={h} href={h} target="_blank" rel="noopener noreferrer">[{j + 1}]</a>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="sv-section sr-records">
        <h2 className="sv-h2">The record · {data.totalRecords}</h2>
        <div className="sr-filters">
          <Link href={baseHref({ source: null })} data-active={!source}>All sources</Link>
          {data.countsBySource.map((c) => (
            <Link key={c.source} href={baseHref({ source: c.source })} data-active={source === c.source}>
              {SELF_RECORD_SOURCE_LABEL[c.source] ?? c.source} ({c.n})
            </Link>
          ))}
          <span className="sr-filter-sep" />
          <Link href={baseHref({ ai: !aiOnly })} data-active={aiOnly}>AI-related only</Link>
        </div>
        {data.records.length === 0 ? (
          <p className="sv-empty">No records match this filter.</p>
        ) : (
          <table className="sv-table sr-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>Title</th>
                <th>AI</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id}>
                  <td>{r.publishedDate ? dateLabel(r.publishedDate) : '–'}</td>
                  <td><span className="sr-chip">{SELF_RECORD_SOURCE_LABEL[r.source] ?? r.source}</span></td>
                  <td><a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a></td>
                  <td>{r.aiRelated ? <span className="sr-ai-badge">AI</span> : null}</td>
                  <td className="sr-summary">{r.summary ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
