import Link from 'next/link';
import type { SavedSheet, ToolingPack } from '@/lib/types';
import { gateToolingNarrative } from '@/lib/tooling/reports';
import { SHEET_KIND_LABEL, SHEET_SECTION_TITLES, TOOLING_MATURITY_LABEL, TOOLING_EVENT_LABEL } from '@/lib/format';

// The four tooling report kinds' read view (the RoundupReadView idiom):
// header, the internal-context block for a build-vs-buy brief (admin/portal
// only, even on a published brief, since publishing a brief still must not
// leak the requesting team's background to a guest), the gated narrative,
// a product table, then a per-kind extra (entrants also lists tracked-product
// moves; features also lists the feature matrix). Server component: the pack
// never reaches a client component.
export default function ToolingReadView({
  saved, pack, viewer,
}: {
  saved: SavedSheet;
  pack: ToolingPack;
  viewer: { admin: boolean; portal: boolean };
}) {
  const titles = SHEET_SECTION_TITLES[pack.kind];
  const n = gateToolingNarrative(saved.narrative, pack);
  const showInternal = viewer.admin || viewer.portal;

  const subject =
    pack.kind === 'tooling_landscape' ? pack.category_name :
    pack.kind === 'tooling_brief' ? pack.capability :
    pack.kind === 'tooling_entrants' ? `Week ending ${pack.to}` :
    `${pack.category_name} · features`;

  return (
    <article>
      <header className="pagehead" style={{ paddingBottom: 24 }}>
        <div className="section-label">
          {SHEET_KIND_LABEL[pack.kind]}{saved.is_published ? '' : ' · draft'}
        </div>
        <h1 style={{ marginBottom: 12 }}>{saved.title}</h1>
        <p className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', margin: 0 }}>
          {subject} · Generated {saved.generated_at.slice(0, 10)}
        </p>
        <p style={{ marginTop: 14 }}>
          <a href={`/reports/sheet/${saved.id}/pdf`} className="btn btn--primary btn--sm">Download the PDF</a>
        </p>
      </header>

      {pack.kind === 'tooling_brief' && showInternal && pack.internal.ourContext && (
        <div className="plate" style={{ margin: '14px 0' }}>
          <div className="lbl" style={{ color: 'var(--accent)', marginBottom: 4 }}>
            Internal context (not shown to guests)
          </div>
          <p className="text-sm" style={{ color: 'var(--dim)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {pack.internal.ourContext}
          </p>
        </div>
      )}

      {n.reading && (
        <section style={{ marginTop: 20 }}>
          <div className="section-label">{titles.reading}</div>
          <div className="report-prose" dangerouslySetInnerHTML={{ __html: n.reading }} />
        </section>
      )}
      {n.connections && (
        <section style={{ marginTop: 20 }}>
          <div className="section-label">{titles.connections}</div>
          <div className="report-prose" dangerouslySetInnerHTML={{ __html: n.connections }} />
        </section>
      )}
      {n.watch && (
        <section style={{ marginTop: 20 }}>
          <div className="section-label">{titles.watch}</div>
          <div className="report-prose" dangerouslySetInnerHTML={{ __html: n.watch }} />
        </section>
      )}
      {n.bottomLine && (
        <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 16, margin: '20px 0' }}>
          <div className="report-prose" dangerouslySetInnerHTML={{ __html: n.bottomLine }} />
        </div>
      )}

      {pack.kind === 'tooling_features' && pack.features.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-label">Feature matrix · {pack.features.length}</div>
          <div className="flex flex-col gap-1">
            {pack.features.map((f) => (
              <div key={f.tag} className="flex items-baseline gap-2 text-sm flex-wrap"
                style={{ borderBottom: '1px solid var(--line)', padding: '5px 0' }}>
                <span style={{ color: 'var(--ink)', minWidth: 180 }}>
                  {f.tag}{f.novel ? ' · novel' : ''}
                </span>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', flex: 1, minWidth: 220 }}>
                  {f.products.join(', ')}
                </span>
                <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                  {f.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {pack.products.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-label">Products · {pack.products.length}</div>
          <div className="flex flex-col gap-1">
            {pack.products.map((p) => (
              <div key={p.id} className="flex flex-col gap-1" style={{ borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
                <div className="flex items-baseline gap-2 text-sm flex-wrap">
                  <Link href={p.href} className="hover:underline" style={{ color: 'var(--ink)', fontWeight: 600, flex: 1, minWidth: 180 }}>
                    {p.name}
                  </Link>
                  {p.vendor && <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{p.vendor}</span>}
                  <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)' }}>
                    {TOOLING_MATURITY_LABEL[p.maturity]}
                  </span>
                </div>
                {p.one_liner && <div className="text-xs" style={{ color: 'var(--dim)' }}>{p.one_liner}</div>}
                <div className="text-xs" style={{ color: 'var(--faint-ink)' }}>
                  {[
                    p.deployment.length ? p.deployment.join(', ') : null,
                    p.pricing_model,
                    p.features.length ? p.features.slice(0, 4).join(', ') : null,
                  ].filter(Boolean).join(' · ') || '–'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {pack.kind === 'tooling_entrants' && pack.events.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-label">Moves on tracked products · {pack.events.length}</div>
          <div className="flex flex-col gap-1">
            {pack.events.map((e, i) => (
              <div key={i} className="flex items-baseline gap-2 text-sm flex-wrap"
                style={{ borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
                <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', minWidth: 74 }}>
                  {e.date}
                </span>
                <span style={{ color: 'var(--ink)' }}>{e.product_name}</span>
                <span className="text-xs" style={{ color: 'var(--faint-ink)' }}>{TOOLING_EVENT_LABEL[e.kind]}</span>
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener" className="hover:underline" style={{ color: 'var(--accent)', flex: 1, minWidth: 160 }}>
                    {e.title}
                  </a>
                ) : (
                  <span style={{ flex: 1, minWidth: 160 }}>{e.title}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 28, lineHeight: 1.6 }}>
        The data half of this report is computed from the AI Tooling Monitor catalog; the narrative
        half is model-drafted over that frozen pack and passed through a citation gate, so every link
        resolves to a tracked product or event.
      </p>
    </article>
  );
}
