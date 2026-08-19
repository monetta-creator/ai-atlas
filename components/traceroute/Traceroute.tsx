'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MOVEMENTS, type MovementId } from '@/lib/traceroute/movements';
import { STOP_BY_ID } from '@/lib/traceroute/stops';
import { PROPS_BY_STOP } from '@/lib/traceroute/props';
import { ARCH_PARTS, MODEL_SPEC } from '@/lib/traceroute/architecture';
import { RISK_DOT_VAR, type RiskLevel } from '@/lib/supply-chain/map';
import dynamic from 'next/dynamic';
import PartsDiagram from './PartsDiagram';
import { hasWebGL } from '@/lib/traceroute/webgl';
import PropDrawer, { type DrawerTarget } from './PropDrawer';

// three.js only loads for browsers that can use it. The SVG elevations below are the
// permanent fallback and are not a lesser version of the information, only of the view.
const WorldStage = dynamic(() => import('./WorldStage'), { ssr: false });
import StopRail from './StopRail';
import InferencePlayer from './InferencePlayer';

// The canvas-free journey.
//
// Four movements, each titled with a claim rather than a label. The ten camera stops still
// exist in the data, but the reader never meets a heading called "The hall": they meet a
// rack, a busway, and a cold plate as OBJECTS inside a movement, which is how the places
// teach without being announced.
//
// Built before any 3D, deliberately, because an explanation that does not work as text will
// not work as geometry. It stays as the permanent narrow-screen, no-WebGL, reduced-motion,
// and pre-hydration rendering.

/** The slice of ScNodeView the page sends over the wire. */
export interface ScNodeLite {
  slug: string;
  name: string;
  risk: RiskLevel;
  isChokepoint: boolean;
  signalCount: number;
  actors: string[];
  blurb: string | null;
}

function fmtParams(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${Math.round(n / 1e6)}M` : String(n);
}

function Architecture() {
  const groups = useMemo(() => {
    const order: { role: string; label: string }[] = [
      { role: 'weights', label: 'Where the parameters are' },
      { role: 'activation', label: 'What flows through' },
      { role: 'cache', label: 'What it remembers' },
    ];
    return order
      .map((g) => ({ ...g, parts: ARCH_PARTS.filter((p) => p.role === g.role) }))
      .filter((g) => g.parts.length > 0);
  }, []);

  return (
    <div className="tr-arch">
      <ul className="tr-spec">
        <li><b>{MODEL_SPEC.dims.nLayers}</b> blocks</li>
        <li><b>{MODEL_SPEC.dims.dModel.toLocaleString('en-US')}</b> numbers per token</li>
        <li><b>{MODEL_SPEC.dims.nHeads}</b> attention heads</li>
        <li><b>{fmtParams(MODEL_SPEC.totalParams)}</b> parameters</li>
      </ul>
      <p className="tr-disclaimer">{MODEL_SPEC.disclaimer}</p>
      {groups.map((g) => (
        <details key={g.role} className="tr-fold">
          <summary>{g.label}</summary>
          <ul className="tr-props tr-props--tight">
            {g.parts.map((p) => (
              <li key={p.id} className="tr-prop">
                <div className="tr-prop-head">
                  <span className="tr-prop-label">{p.label}</span>
                  {p.params != null && <span className="tr-tag">{fmtParams(p.params)} params</span>}
                </div>
                <p className="tr-prop-blurb">{p.blurb}</p>
                {p.anchor?.conceptSlug && (
                  <Link className="tr-link" href={`/concepts/${p.anchor.conceptSlug}`}>
                    {p.anchor.conceptSlug.replace(/-/g, ' ')}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export default function Traceroute({ scNodes }: { scNodes: ScNodeLite[] }) {
  const [active, setActive] = useState<MovementId>('here');
  const sectionRefs = useRef(new Map<MovementId, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const bySlug = useMemo(() => new Map(scNodes.map((n) => [n.slug, n])), [scNodes]);

  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const openProp = useCallback((id: string) => setDrawer({ kind: 'prop', id }), []);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  // Resolved after mount so the server and the first client render agree on the SVG.
  const [canvas, setCanvas] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCanvas(hasWebGL()));
    return () => cancelAnimationFrame(id);
  }, []);

  // Everything a movement contains, gathered from its camera stops.
  const contents = useMemo(
    () =>
      MOVEMENTS.map((m) => {
        const slugs = new Set<string>();
        for (const id of m.stops) {
          for (const s of STOP_BY_ID.get(id)?.scNodes ?? []) slugs.add(s);
        }
        const sources = [...slugs].map((s) => bySlug.get(s)).filter((n): n is ScNodeLite => !!n);
        return { movement: m, sources };
      }),
    [bySlug]
  );

  const attach = useCallback(
    (id: MovementId) => (el: HTMLElement | null) => {
      const map = sectionRefs.current;
      const prev = map.get(id);
      if (prev && observerRef.current) observerRef.current.unobserve(prev);
      if (!el) {
        map.delete(id);
        return;
      }
      map.set(id, el);
      if (!observerRef.current) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            const visible = entries
              .filter((e) => e.isIntersecting)
              .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            const found = visible?.target.getAttribute('data-movement') as MovementId | undefined;
            if (found) setActive(found);
          },
          { rootMargin: '-25% 0px -60% 0px', threshold: [0, 0.2, 0.5, 1] }
        );
      }
      observerRef.current.observe(el);
    },
    []
  );

  const jump = useCallback((id: MovementId) => {
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="tr">
      <StopRail active={active} onJump={jump} />

      <div className="tr-flow">
        {contents.map(({ movement, sources }, i) => (
          <section
            key={movement.id}
            ref={attach(movement.id)}
            data-movement={movement.id}
            id={`m-${movement.id}`}
            className="tr-stop"
          >
            <h2 className="tr-title">{movement.title}</h2>
            <p className="tr-blurb">{movement.lede}</p>

            {(() => {
              const withProps = movement.stops.filter(
                (id) => (PROPS_BY_STOP.get(id) ?? []).length > 0
              );
              if (withProps.length === 0) return null;
              return canvas ? (
                <WorldStage stops={withProps} onOpen={openProp} />
              ) : (
                <div className="tr-dias">
                  {withProps.map((id) => (
                    <PartsDiagram key={id} stop={id} />
                  ))}
                </div>
              );
            })()}

            {movement.id === 'running' && (
              <>
                <Architecture />
                <InferencePlayer />
              </>
            )}

            {sources.length > 0 && (
              <p className="tr-sourceline">
                Made by{' '}
                {sources.map((n, k) => (
                  <span key={n.slug}>
                    {k > 0 && ', '}
                    <span className="tr-src" data-chokepoint={n.isChokepoint ? '' : undefined}>
                      <span
                        className="tr-chip-dot"
                        style={{ background: RISK_DOT_VAR[n.risk] }}
                        aria-hidden="true"
                      />
                      {n.name}
                    </span>
                  </span>
                ))}
                .
              </p>
            )}

            {i < contents.length - 1 && <div className="tr-sep" aria-hidden="true" />}
          </section>
        ))}
      </div>

      <PropDrawer target={drawer} nodes={bySlug} onClose={closeDrawer} />
    </div>
  );
}
