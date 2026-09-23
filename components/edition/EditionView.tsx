import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SavedEdition } from '@/lib/edition/types';
import { allowlistForEdition } from '@/lib/edition/pure';
import { fmtChange } from '@/lib/edition/markets';
import { enforceCitations } from '@/lib/citations';
import { dateLabel } from '@/lib/format';

// The daily edition's read view (2026-09-23): masthead, a numbers strip, a
// two-column body (the front + Matt Levine-style column, ending in Things
// Happen), then the section shelf (Companies / Research / Tools / Blind
// spots / Sources). Renders one SavedEdition; used by /blotter (latest) and
// /blotter/[day] (archive). Guest-safe by construction: every field it reads
// comes off the pack or the gated narrative, never an admin column. The
// `admin` prop only toggles the model-name line in the footer.
//
// The column is the one piece of free-form model prose here, so it is
// re-gated at render, belt and braces, exactly like SheetReadView: the same
// allowlistForEdition the pack builder gates against at generation time,
// run again through enforceCitations (which sanitizes AND strips any link
// outside that allowlist), rendering only the gated result.

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

// Links either into the app (next/link) or out to a source (new tab), by shape.
function GoTo({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (isInternal(href)) return <Link href={href} className={className}>{children}</Link>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

// A 22-point sparkline of daily closes; server-rendered SVG, no library.
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 56; const h = 16;
  const min = Math.min(...values); const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
  return (
    <svg className="ed-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function TierChip({ tier }: { tier: number | null }) {
  if (tier == null) return null;
  return <span className="ed-tier" data-tier={tier}>{`T${tier}`}</span>;
}

export default function EditionView({ edition, admin }: { edition: SavedEdition; admin: boolean }) {
  const { pack, narrative } = edition;
  const allow = allowlistForEdition(pack);
  const { html: columnHtml } = enforceCitations(narrative.column.html, allow);

  const numberItems: { n: number; l: string }[] = [
    { n: pack.numbers.itemsRead, l: 'Items read' },
    { n: pack.numbers.outlets, l: 'Outlets' },
    { n: pack.numbers.signalsPublished, l: 'Signals published' },
    { n: pack.numbers.papersKept, l: 'Papers analyzed' },
    ...(pack.numbers.newTools > 0 ? [{ n: pack.numbers.newTools, l: 'New tools' }] : []),
    { n: pack.numbers.clusters, l: 'Stories' },
  ];

  return (
    <div className="ed-wrap">
      <div className="ed-masthead">
        <span className="ed-wordmark">THE AI ATLAS · DAILY EDITION</span>
        <span className="ed-dateline">{dateLabel(pack.day)} · No. {pack.issueNumber}</span>
      </div>
      <div className="ed-rule" />

      <div className="ed-numbers">
        {numberItems.map((it) => (
          <div key={it.l} className="ed-numbers-cell">
            <span className="ed-numbers-n">{it.n}</span>
            <span className="ed-numbers-l">{it.l}</span>
          </div>
        ))}
      </div>

      {pack.markets && pack.markets.rows.length > 0 && (
        <div className="ed-markets" aria-label="Market strip">
          {pack.markets.rows.map((m) => (
            <span key={m.symbol} className="ed-market" data-dir={m.changePct > 0 ? 'up' : m.changePct < 0 ? 'down' : 'flat'}>
              <span className="ed-market-label">{m.label}</span>
              <Spark values={m.spark} />
              <span className="ed-market-price">{m.price.toFixed(m.price >= 100 ? 0 : 2)}</span>
              <span className="ed-market-chg">{fmtChange(m.changePct)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="ed-body">
        <div className="ed-front">
          {narrative.front.map((item, i) => (
            <div key={item.clusterId} className="ed-item">
              <span className="ed-item-n">{i + 1}</span>
              <div className="ed-item-body">
                <h3 className="ed-item-hed">{item.headline}</h3>
                <p className="ed-item-why">{item.why}</p>
                {item.numbers && <p className="ed-item-numbers">{item.numbers}</p>}
                <p className="ed-coverage">{item.coverage}</p>
                <GoTo href={item.goDeeperHref} className="ed-godeeper">
                  {item.goDeeperLabel} →
                </GoTo>
              </div>
            </div>
          ))}
        </div>

        <div className="ed-column">
          <p className="ed-kicker">The column</p>
          <h2 className="ed-column-title">{narrative.column.title}</h2>
          {columnHtml && <div className="ed-column-prose" dangerouslySetInnerHTML={{ __html: columnHtml }} />}
        </div>
      </div>

      {pack.thingsHappen.length > 0 && (
        <section className="ed-things">
          <p className="ed-section-head">Things happen · {pack.thingsHappen.length}</p>
          <div className="ed-cardgrid">
            {pack.thingsHappen.map((t) => (
              <GoTo key={t.url} href={t.href ?? t.url} className="ed-card">
                <span className="ed-card-hed">{t.headline}</span>
                <span className="ed-card-foot">
                  <span className="ed-card-domain">{t.domain}</span>
                  <TierChip tier={t.tier} />
                  <span className="ed-card-arrow" aria-hidden="true">↗</span>
                </span>
              </GoTo>
            ))}
          </div>
        </section>
      )}

      {(pack.hn?.length ?? 0) > 0 && (
        <section className="ed-hn">
          <p className="ed-section-head">What builders are reading · Hacker News front page</p>
          <div className="ed-cardgrid">
            {pack.hn!.map((h) => (
              <div key={h.hnUrl} className="ed-card ed-card--hn">
                <GoTo href={h.url ?? h.hnUrl} className="ed-card-hed">{h.title}</GoTo>
                <span className="ed-card-foot">
                  <span className="ed-card-domain">{h.points} points</span>
                  <a href={h.hnUrl} target="_blank" rel="noopener noreferrer" className="ed-card-comments">{h.comments} comments ↗</a>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {pack.sources.length > 0 && (
        <section className="ed-sources">
          <div className="ed-sources-head">
            <span className="ed-sources-big">{pack.numbers.outlets}</span>
            <span className="ed-sources-label">outlets read today<br />across {pack.numbers.itemsRead} items</span>
          </div>
          <div className="ed-sources-chips">
            {pack.sources.map((src) => (
              <span key={src.domain} className="ed-source-chip">
                <TierChip tier={src.tier} />
                <span className="ed-source-domain">{src.domain}</span>
                <span className="ed-source-count">{src.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="ed-sections">
        {pack.papers.length > 0 && (
          <div>
            <p className="ed-section-head">Research</p>
            {pack.papers.map((p) => (
              <div key={p.id} className="ed-paper">
                <Link href={p.href} className="ed-paper-title">{p.title}</Link>
                {p.whoCares && <p className="ed-paper-cares">{p.whoCares}</p>}
              </div>
            ))}
          </div>
        )}

        {pack.tools.length > 0 && (
          <div>
            <p className="ed-section-head">Tools</p>
            {pack.tools.map((t) => (
              <div key={t.slug} className="ed-tool">
                <Link href={t.href} className="ed-tool-name">{t.name}</Link>
                {t.vendor && <span className="ed-tool-vendor"> · {t.vendor}</span>}
                {t.oneLiner && <p className="ed-tool-line">{t.oneLiner}</p>}
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="ed-section-head">Blind spots</p>
          {pack.blindSpots.length > 0 ? (
            pack.blindSpots.map((b, i) => (
              <p key={i} className="ed-blind">
                {b.url ? <GoTo href={b.url}>{b.headline}</GoTo> : b.headline}
              </p>
            ))
          ) : (
            <p className="ed-blind-empty">Nothing the desk knows it missed today.</p>
          )}
        </div>
      </div>

      <p className="ed-footer">
        Generated {dateLabel(pack.generatedAt)} from {pack.numbers.itemsRead} items the engines stored; every
        link resolves to a stored record or its source.
        {pack.markets && ` Market prices as of ${new Date(pack.markets.asOf).toISOString().slice(11, 16)} UTC, unofficial feed.`}
        {admin && ` Model: ${narrative.model ?? 'not recorded'}.`}
      </p>
    </div>
  );
}
