import Link from 'next/link';
import type { ReactNode } from 'react';
import EntityLogo from '@/components/EntityLogo';
import { layoutFigure, MAP_NOTE, FIG_W, type SavantFigure, type Prim, type Tone } from '@/lib/savant/figures-core';

// The web painter for Savant's figures: one <figure> per spec. Entity cards
// are DOM (favicon via EntityLogo, name, note, bullets); every other kind is
// the layout core's primitive list painted as inline SVG. Tones map to the
// design tokens so a figure follows the theme. Server component; only the
// favicon fallback (EntityLogo) is a client island.

const TONE: Record<Tone, string> = {
  ink: 'var(--ink)', cobalt: 'var(--accent)', cobaltSoft: 'color-mix(in oklab, var(--accent) 45%, transparent)',
  dim: 'var(--dim)', faint: 'var(--faint-ink)', line: 'var(--line-strong, rgba(15,23,42,0.18))', paper: 'var(--surface)', none: 'none',
};
const FONT = { body: 'var(--font-body)', mono: 'var(--font-mono)', head: 'var(--font-headline)' };

function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

function Go({ href, children, className }: { href: string | null; children: ReactNode; className?: string }) {
  if (!href) return <>{children}</>;
  if (isInternal(href)) return <Link href={href} className={className}>{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

function SvgLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return <a href={href} target={isInternal(href) ? undefined : '_blank'} rel={isInternal(href) ? undefined : 'noopener noreferrer'}>{children}</a>;
}

function paint(p: Prim, i: number): ReactNode {
  switch (p.t) {
    case 'rect':
      return (
        <SvgLink key={i} href={p.href}>
          <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r ?? 0} style={{ fill: TONE[p.fill], stroke: p.stroke ? TONE[p.stroke] : 'none', strokeWidth: 1 }} />
        </SvgLink>
      );
    case 'circle':
      return (
        <SvgLink key={i} href={p.href}>
          <circle cx={p.cx} cy={p.cy} r={p.r} style={{ fill: TONE[p.fill], stroke: p.stroke ? TONE[p.stroke] : 'none', strokeWidth: 1.5 }} />
        </SvgLink>
      );
    case 'line':
      return <line key={i} x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} strokeDasharray={p.dash ? '3 3' : undefined} style={{ stroke: TONE[p.stroke], strokeWidth: p.width ?? 1 }} />;
    case 'path':
      return <path key={i} d={p.d} style={{ stroke: TONE[p.stroke], fill: p.fill ? TONE[p.fill] : 'none', strokeWidth: p.width ?? 1 }} />;
    case 'text':
      return (
        <SvgLink key={i} href={p.href}>
          <text
            x={p.x} y={p.y} textAnchor={p.anchor ?? 'start'}
            style={{ fill: TONE[p.fill], fontSize: p.size, fontFamily: FONT[p.font ?? 'body'], fontWeight: p.bold ? 700 : 400, letterSpacing: p.font === 'mono' ? '0.08em' : undefined }}
          >
            {p.text}
          </text>
        </SvgLink>
      );
    default:
      return null;
  }
}

export default function Figure({ figure, index }: { figure: SavantFigure; index: number }) {
  const layout = layoutFigure(figure);
  return (
    <figure className="sv-figure" data-kind={figure.kind} id={figure.id}>
      <p className="sv-fig-kicker">Figure {index}</p>
      <p className="sv-fig-title">{figure.title}</p>
      {figure.kind === 'entities' ? (
        <div className="sv-fig-cards" data-cols={figure.columns}>
          {figure.entities.map((e) => (
            <div key={`${e.label}-${e.href ?? ''}`} className="sv-fig-card">
              <div className="sv-fig-card-head">
                <EntityLogo name={e.label} domain={e.domain} url={e.href && !isInternal(e.href) ? e.href : null} size={26} />
                <Go href={e.href} className="sv-fig-card-name">{e.label}</Go>
              </div>
              {e.note && <p className="sv-fig-card-note">{e.note}</p>}
              {e.bullets.length > 0 && <ul className="sv-fig-card-bullets">{e.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
            </div>
          ))}
        </div>
      ) : layout ? (
        <svg className="sv-fig-svg" viewBox={`0 0 ${FIG_W} ${layout.height}`} role="img" aria-label={figure.title}>
          {layout.prims.map(paint)}
        </svg>
      ) : null}
      <figcaption className="sv-fig-caption">
        {figure.caption}
        {figure.kind === 'map' && <span className="sv-fig-note"> {MAP_NOTE}</span>}
      </figcaption>
    </figure>
  );
}
