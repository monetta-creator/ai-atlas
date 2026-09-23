import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SavedEdition } from '@/lib/edition/types';
import { allowlistForEdition } from '@/lib/edition/pack';
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
    { n: pack.numbers.papersKept, l: 'Papers kept' },
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

          {pack.thingsHappen.length > 0 && (
            <div className="ed-things">
              <p className="ed-section-head">Things happen</p>
              <ul className="ed-things-list">
                {pack.thingsHappen.map((t) => (
                  <li key={t.url}>
                    <GoTo href={t.href ?? t.url}>{t.headline}</GoTo>
                    <span className="ed-things-meta">
                      {t.domain}
                      {t.tier != null && ' · '}
                      <TierChip tier={t.tier} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="ed-sections">
        {pack.companies.length > 0 && (
          <div>
            <p className="ed-section-head">Companies</p>
            {pack.companies.map((co) => (
              <div key={co.companySlug} className="ed-company">
                <p className="ed-company-name">{co.companyName}</p>
                {co.facts.slice(0, 4).map((f, i) => (
                  <p key={i} className="ed-fact">
                    {f.fact}{f.valueText ? `: ${f.valueText}` : ''}
                    {f.url && <GoTo href={f.url}>source</GoTo>}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}

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

        {pack.sources.length > 0 && (
          <div>
            <p className="ed-section-head">Sources</p>
            <ul className="ed-sources-list">
              {pack.sources.map((s) => (
                <li key={s.domain}>
                  <span className="ed-sources-domain">
                    <TierChip tier={s.tier} />
                    {s.domain}
                  </span>
                  <span className="ed-sources-count">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="ed-footer">
        Generated {dateLabel(pack.generatedAt)} from {pack.numbers.itemsRead} items the engines stored; every
        link resolves to a stored record or its source.
        {admin && ` Model: ${narrative.model ?? 'not recorded'}.`}
      </p>
    </div>
  );
}
