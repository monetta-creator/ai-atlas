// The three downloads of one company's context pack. Plain anchors to the
// key-gated datasets route: a file download, never client navigation.
const BASE = '/api/datasets/context-pack';

export function packHrefs(slug: string): { base: string; brief: string; sections: string } {
  const c = encodeURIComponent(slug);
  return {
    base: `${BASE}?format=md&company=${c}&size=base`,
    brief: `${BASE}?format=md&company=${c}&size=brief`,
    sections: `${BASE}?format=json&company=${c}&download=1`,
  };
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export default function PackDownloads({
  slug, sizes, showBrief = true,
}: {
  slug: string;
  sizes?: { base: number; brief: number; sections: number; rows: number };
  showBrief?: boolean;
}) {
  const href = packHrefs(slug);
  return (
    <div className="bc-downloads">
      <a className="bc-dl bc-dl--base" href={href.base}>
        <span className="bc-dl-name">Base <i>.md</i></span>
        <span className="bc-dl-meta">{sizes ? `${k(sizes.base)} tokens` : 'about 10k tokens'}</span>
      </a>
      {showBrief && (
        <a className="bc-dl" href={href.brief}>
          <span className="bc-dl-name">Brief <i>.md</i></span>
          <span className="bc-dl-meta">{sizes ? `${k(sizes.brief)} tokens` : 'about 50k tokens'}</span>
        </a>
      )}
      <a className="bc-dl" href={href.sections}>
        <span className="bc-dl-name">Sections <i>.json</i></span>
        <span className="bc-dl-meta">{sizes ? `${sizes.rows} rows` : 'rows for search'}</span>
      </a>
    </div>
  );
}
