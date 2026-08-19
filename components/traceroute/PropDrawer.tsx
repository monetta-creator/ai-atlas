'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { PROP_BY_ID } from '@/lib/traceroute/props';
import { ARCH_PART_BY_ID, type ArchPartId } from '@/lib/traceroute/architecture';
import { STOP_BY_ID } from '@/lib/traceroute/stops';
import type { PropId } from '@/lib/traceroute/types';
import { RISK_DOT_VAR, RISK_LABEL, type RiskLevel } from '@/lib/supply-chain/map';

// Click-into detail for anything in either scene.
//
// One component serves both, via a discriminated target: a physical prop carries a place and
// the supply-chain nodes that make it, an architecture part carries a parameter count. Modelled
// on components/SupplyChainDrawer.tsx (escape to close, focus on open, renders null when shut)
// but without that component's admin editors and supply-chain crumb, neither of which belongs
// on a public explainer.

export interface DrawerNode {
  slug: string;
  name: string;
  risk: RiskLevel;
  isChokepoint: boolean;
  signalCount: number;
  actors: string[];
  blurb: string | null;
}

export type DrawerTarget =
  | { kind: 'prop'; id: PropId }
  | { kind: 'arch'; id: ArchPartId }
  | null;

function fmtParams(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : `${Math.round(n / 1e6)} million`;
}

export default function PropDrawer({
  target,
  nodes,
  onClose,
}: {
  target: DrawerTarget;
  nodes: Map<string, DrawerNode>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!target) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  if (!target) return null;

  const prop = target.kind === 'prop' ? PROP_BY_ID.get(target.id) ?? null : null;
  const part = target.kind === 'arch' ? ARCH_PART_BY_ID.get(target.id) ?? null : null;
  if (!prop && !part) return null;

  const label = prop?.label ?? part?.label ?? '';
  const blurb = prop?.blurb ?? part?.blurb ?? '';
  const anchor = prop?.anchor ?? part?.anchor;
  const stop = prop ? STOP_BY_ID.get(prop.stop) ?? null : null;
  const sources = stop ? stop.scNodes.map((s) => nodes.get(s)).filter((n): n is DrawerNode => !!n) : [];

  return (
    <>
      <div className="tr-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="tr-drawer" role="dialog" aria-modal="true" aria-label={label}>
        <div className="tr-drawer-top">
          <span className="tr-drawer-crumb">
            {prop ? stop?.title ?? 'Place' : 'Architecture'}
            {prop ? ` · ${stop?.scaleLabel ?? ''}` : part?.role ? ` · ${part.role}` : ''}
          </span>
          <button ref={closeRef} type="button" className="tr-drawer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h3 className="tr-drawer-title">{label}</h3>
        <p className="tr-drawer-blurb">{blurb}</p>

        {part?.params != null && (
          <p className="tr-drawer-stat">
            <b>{fmtParams(part.params)}</b> parameters held here
          </p>
        )}
        {prop?.energy && <p className="tr-drawer-stat">On the power path</p>}
        {prop?.repeat && (
          <p className="tr-drawer-stat">
            Repeated <b>{prop.repeat.count.reduce((a, b) => a * Math.max(b, 1), 1)}</b> times at this place
          </p>
        )}

        {anchor?.conceptSlug && (
          <Link className="btn btn--ghost btn--sm" href={`/concepts/${anchor.conceptSlug}`}>
            Read: {anchor.conceptSlug.replace(/-/g, ' ')}
          </Link>
        )}

        {sources.length > 0 && (
          <div className="tr-drawer-section">
            <div className="section-label">Who makes this tier</div>
            <ul className="tr-drawer-sources">
              {sources.map((n) => (
                <li key={n.slug} data-chokepoint={n.isChokepoint ? '' : undefined}>
                  <span className="tr-chip-dot" style={{ background: RISK_DOT_VAR[n.risk] }} aria-hidden="true" />
                  <span>
                    <b>{n.name}</b>
                    <span className="tr-drawer-meta">
                      {RISK_LABEL[n.risk]} risk
                      {n.isChokepoint && ' · chokepoint'}
                      {n.signalCount > 0 && ` · ${n.signalCount} signal${n.signalCount === 1 ? '' : 's'}`}
                    </span>
                    {n.actors.length > 0 && (
                      <span className="tr-drawer-actors">{n.actors.slice(0, 4).join(' · ')}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </>
  );
}
