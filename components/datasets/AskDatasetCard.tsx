'use client';

import Link from 'next/link';

export interface DatasetSuggestionMeta {
  slug: string;
  title: string;
  description: string;
}

// The chat-to-data bridge: when the portal Ask answer ends with a verified
// [dataset <slug>] suggestion, this card offers the download directly under the
// answer. Slugs are verified against the registry list by the caller (AskAtlas),
// the same discipline lib/ask/verify.ts applies to record citations.
export default function AskDatasetCard({
  slugs, datasets,
}: {
  slugs: string[];
  datasets: DatasetSuggestionMeta[];
}) {
  const metas = slugs
    .map((s) => datasets.find((d) => d.slug === s))
    .filter((d): d is DatasetSuggestionMeta => !!d);
  if (!metas.length) return null;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {metas.map((d) => (
        <div key={d.slug} className="plate" style={{ padding: '14px 18px' }}>
          <div className="section-label">Suggested dataset</div>
          <div style={{ margin: '8px 0 4px', fontWeight: 640 }}>{d.title}</div>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dim)', marginBottom: 12 }}>
            {d.description}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <a className="btn btn--primary btn--sm" href={`/api/datasets/${d.slug}`}>
              Download CSV
            </a>
            <a className="btn btn--ghost btn--sm" href={`/api/datasets/${d.slug}?format=json`}>
              JSON
            </a>
            <Link
              href={`/datasets/${d.slug}`}
              prefetch={false}
              style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}
            >
              About this dataset
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
