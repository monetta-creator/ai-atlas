'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PROP_BY_ID } from '@/lib/traceroute/props';
import { STOP_BY_ID } from '@/lib/traceroute/stops';
import type { PropId, StopId } from '@/lib/traceroute/types';
import { prefersReducedMotion, readPalette } from '@/lib/traceroute/webgl';
import {
  buildWorld,
  disposeWorld,
  paintWorld,
  pickProp,
  recolourWorld,
  resizeWorld,
  type WorldScene,
} from '@/lib/traceroute/scene-world';

// One canvas per movement, showing one place at a time.
//
// The scene is rebuilt when the place changes, which is cheap (a few dozen primitives) and
// keeps each stop in its own local coordinate range. Paint state lives in a ref and is
// applied from the render loop, so dragging the explode slider never re-renders React.

export default function WorldStage({
  stops,
  onOpen,
}: {
  stops: StopId[];
  onOpen?: (id: PropId) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const paintRef = useRef({ hover: null as PropId | null, explode: 0, energy: false });

  const [stop, setStop] = useState<StopId>(stops[0]);
  const [hover, setHover] = useState<PropId | null>(null);
  const [explode, setExplode] = useState(0);
  const [energy, setEnergy] = useState(false);
  const [interactive, setInteractive] = useState(false);

  // Mirror control state into the ref the loop reads. Written from an effect, never during
  // render, which is what react-hooks/refs requires.
  useEffect(() => {
    paintRef.current = { hover, explode, energy };
  }, [hover, explode, energy]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let pal = readPalette();
    const s = buildWorld(mount, stop, pal);
    sceneRef.current = s;
    setInteractive(false);

    s.renderer.setAnimationLoop(() => {
      paintWorld(s, paintRef.current, pal);
      s.controls.update();
      s.renderer.render(s.scene, s.camera);
    });

    const ro = new ResizeObserver(() => resizeWorld(s));
    ro.observe(mount);
    const themeObs = new MutationObserver(() => {
      pal = readPalette();
      recolourWorld(s, pal);
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      disposeWorld(s);
      sceneRef.current = null;
    };
  }, [stop]);

  const activate = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.controls.enableZoom = true;
    s.controls.enablePan = true;
    setInteractive(true);
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const s = sceneRef.current;
    if (s) setHover(pickProp(s, e.clientX, e.clientY));
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      activate();
      const s = sceneRef.current;
      if (!s || !onOpen) return;
      const id = pickProp(s, e.clientX, e.clientY);
      if (id) onOpen(id);
    },
    [activate, onOpen]
  );

  const info = STOP_BY_ID.get(stop);
  const part = hover ? PROP_BY_ID.get(hover) ?? null : null;
  const hasEnergy = info?.energy ?? false;
  const reduced = typeof window !== 'undefined' && prefersReducedMotion();

  return (
    <div className="tr-world">
      <div className="tr-world-bar">
        {stops.length > 1 && (
          <div className="tr-world-tabs" role="tablist" aria-label="Places">
            {stops.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="tr-world-tab"
                aria-selected={stop === id}
                onClick={() => setStop(id)}
              >
                {STOP_BY_ID.get(id)?.title ?? id}
              </button>
            ))}
          </div>
        )}
        <div className="tr-world-tools">
          {hasEnergy && (
            <button
              type="button"
              className="tr-rate"
              aria-pressed={energy}
              onClick={() => setEnergy((v) => !v)}
            >
              Power path
            </button>
          )}
          <label className="tr-explode">
            <span className="lbl">Explode</span>
            <input
              type="range"
              min={0}
              max={100}
              value={explode * 100}
              onChange={(e) => setExplode(Number(e.target.value) / 100)}
              aria-label="Separate the parts"
            />
          </label>
        </div>
      </div>

      <div
        ref={mountRef}
        className="tr-canvas"
        role="img"
        aria-label={`${info?.title ?? stop}, ${info?.scaleLabel ?? ''}. The schematic below the fold lists the same parts as text.`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      />

      <div className="tr-canvas-cap" data-live={part ? '' : undefined}>
        {part ? (
          <>
            <b>{part.label}</b>
            <span>{part.blurb}</span>
            {part.anchor?.conceptSlug && (
              <Link className="tr-link" href={`/concepts/${part.anchor.conceptSlug}`}>
                {part.anchor.conceptSlug.replace(/-/g, ' ')}
              </Link>
            )}
          </>
        ) : (
          <span className="tr-dia-hint">
            {info?.scaleLabel}
            {reduced ? '' : interactive ? ' · drag to orbit · scroll to zoom' : ' · drag to orbit · click to enable zoom'}
          </span>
        )}
      </div>
    </div>
  );
}
