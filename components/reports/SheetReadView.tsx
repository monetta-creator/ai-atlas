import Link from 'next/link';
import type { SavedSheet } from '@/lib/types';
import { gateSheetNarrative } from '@/lib/tearsheet/generate';
import {
  SIGNIFICANCE_LABEL, SHEET_KIND_LABEL, SHEET_SECTION_TITLES, directionColor, directionLabel,
} from '@/lib/format';

// The public read view of a generated report (the ThesisReportView idiom):
// header, coverage note, the subject panel, the gated narrative (re-gated here
// at the render boundary, belt and braces), then the signal record. The PDF
// carries the full evidence ledger; this view links into the Atlas instead.
export default function SheetReadView({ saved }: { saved: SavedSheet }) {
  const pack = saved.pack;
  const titles = SHEET_SECTION_TITLES[pack.kind];
  const n = gateSheetNarrative(saved.narrative, pack);
  const scope = saved.scope_from || saved.scope_to
    ? `Scope: ${saved.scope_from ?? 'start'} to ${saved.scope_to ?? 'now'}`
    : 'Scope: the full corpus';

  const corpusNote = pack.stats.corpusNote;

  return (
    <article>
      <header className="pagehead" style={{ paddingBottom: 24 }}>
        <div className="section-label">
          {SHEET_KIND_LABEL[pack.kind]}{saved.is_published ? '' : ' · draft'}
        </div>
        <h1 style={{ marginBottom: 12 }}>{saved.title}</h1>
        <p className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)', margin: 0 }}>
          {scope} · Generated {saved.generated_at.slice(0, 10)}
        </p>
        <p style={{ marginTop: 14 }}>
          <a href={`/reports/sheet/${saved.id}/pdf`} className="btn btn--primary btn--sm">Download the PDF</a>
        </p>
      </header>

      <p className="text-sm" style={{ color: 'var(--dim)', lineHeight: 1.6 }}>{corpusNote}</p>

      {(pack.kind === 'claim' || pack.kind === 'bridge') && (
        <div className="plate" style={{ margin: '14px 0' }}>
          <div className="lbl" style={{ color: 'var(--accent)', marginBottom: 4 }}>
            {pack.kind === 'bridge' ? `Bridge-claim ${pack.node.code}` : `Claim ${pack.node.code}`}
          </div>
          <p style={{ fontWeight: 600, fontSize: 16, margin: 0 }}>
            <Link href={pack.node.href} className="hover:underline" style={{ color: 'var(--ink)' }}>
              {pack.node.statement}
            </Link>
          </p>
          {pack.node.test && (
            <>
              <div className="lbl" style={{ color: 'var(--accent)', margin: '10px 0 4px' }}>Would falsify it</div>
              <p className="text-sm" style={{ color: 'var(--dim)', margin: 0 }}>{pack.node.test}</p>
            </>
          )}
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

      {pack.signals.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <div className="section-label">Signal record · {pack.signals.length}</div>
          <div className="flex flex-col gap-1">
            {pack.signals.map((sig) => (
              <div key={sig.id} className="flex items-baseline gap-2 text-sm flex-wrap"
                style={{ borderBottom: '1px solid var(--line)', padding: '7px 0' }}>
                <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint-ink)', minWidth: 74 }}>
                  {sig.published_at ?? 'undated'}
                </span>
                <span className="text-xs" style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', minWidth: 28 }}>
                  {sig.tag}
                </span>
                <Link href={`/signals/${sig.id}`} className="hover:underline" style={{ color: 'var(--ink)', flex: 1, minWidth: 220 }}>
                  {sig.title}
                </Link>
                <span className="text-xs" style={{ color: 'var(--faint-ink)', fontFamily: 'var(--font-mono)' }}>
                  {SIGNIFICANCE_LABEL[sig.significance]}
                  {sig.direction && (
                    <>
                      {' · '}
                      <span className={directionColor(sig.direction)}>{directionLabel(sig.direction)}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs" style={{ color: 'var(--faint-ink)', marginTop: 28, lineHeight: 1.6 }}>
        The data half of this report is computed from the Atlas database; the narrative half is
        model-drafted over that frozen pack and passed through a citation gate, so every link
        resolves to a tracked record. The PDF carries the full evidence ledger.
      </p>
    </article>
  );
}
