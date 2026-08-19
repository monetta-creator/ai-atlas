'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Timeline } from '@/lib/traceroute/compile';
import { ARCH_PART_BY_ID, type ArchPartId } from '@/lib/traceroute/architecture';
import { lookBlend } from '@/lib/traceroute/camera';
import { prefersReducedMotion, readPalette } from '@/lib/traceroute/webgl';
import {
  buildSilicon,
  disposeSilicon,
  driveCamera,
  paintInference,
  pickPart,
  recolourSilicon,
  resizeSilicon,
  type SiliconScene,
} from '@/lib/traceroute/scene-silicon';

// The canvas host for the silicon scene.
//
// Two rules this component exists to enforce:
//
//   1. The render loop reads player state from a REF, never from React state. Per-frame
//      progress never enters a setState, so React re-renders once per step change rather
//      than sixty times a second next to a live WebGL context.
//   2. All scene mutation happens in module-scope functions in lib/traceroute/scene-silicon.
//      Nothing here touches a material directly.

export default function Stage({
  timeline,
  index,
  elapsedRef,
  onPickPart,
}: {
  timeline: Timeline;
  /** Current step. React state, so it changes at most a few times a second. */
  index: number;
  /** Milliseconds into that step. Read inside the render loop only. */
  elapsedRef: React.RefObject<number>;
  onPickPart?: (id: ArchPartId) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SiliconScene | null>(null);
  const releasedAtRef = useRef<number | null>(0);
  const [hover, setHover] = useState<ArchPartId | null>(null);
  const [interactive, setInteractive] = useState(false);

  // What the loop should draw. Written from an effect, never during render, and read only
  // inside the animation callback.
  const frameRef = useRef<{ timeline: Timeline; index: number }>({ timeline, index });
  useEffect(() => {
    frameRef.current = { timeline, index };
  }, [timeline, index]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const pal0 = readPalette();
    const s = buildSilicon(mount, pal0);
    sceneRef.current = s;
    let pal = pal0;
    const reduce = prefersReducedMotion();

    let last = performance.now();
    s.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(now - last, 250);
      last = now;

      const { timeline: tl, index: i } = frameRef.current;
      const step = tl.steps[i];
      if (step) {
        const p = Math.max(0, Math.min(1, (elapsedRef.current ?? 0) / step.durationMs));
        paintInference(s, step, p, pal);
      }
      // Reduced motion: the camera snaps to each pose rather than travelling to it.
      const blend = reduce ? 1 : lookBlend(releasedAtRef.current === null ? null : now - releasedAtRef.current);
      driveCamera(s, reduce ? 1000 : dt, blend);
      s.renderer.render(s.scene, s.camera);
    });

    const ro = new ResizeObserver(() => resizeSilicon(s));
    ro.observe(mount);

    const themeObs = new MutationObserver(() => {
      pal = readPalette();
      recolourSilicon(s, pal);
    });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const onDown = () => {
      releasedAtRef.current = null;
    };
    const onUp = () => {
      releasedAtRef.current = performance.now();
    };
    mount.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);

    return () => {
      ro.disconnect();
      themeObs.disconnect();
      mount.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      disposeSilicon(s);
      sceneRef.current = null;
    };
  }, [elapsedRef]);

  // Zoom stays disabled until the reader deliberately clicks in, so the canvas never steals
  // page scroll from someone who is just passing through.
  const activate = useCallback(() => {
    const s = sceneRef.current;
    if (!s || interactive) return;
    s.controls.enableZoom = true;
    s.controls.enablePan = true;
    setInteractive(true);
  }, [interactive]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const s = sceneRef.current;
    if (!s) return;
    setHover(pickPart(s, e.clientX, e.clientY));
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      activate();
      const s = sceneRef.current;
      if (!s || !onPickPart) return;
      const id = pickPart(s, e.clientX, e.clientY);
      if (id) onPickPart(id);
    },
    [activate, onPickPart]
  );

  const part = hover ? ARCH_PART_BY_ID.get(hover) ?? null : null;

  return (
    <div className="tr-stage3d">
      <div
        ref={mountRef}
        className="tr-canvas"
        role="img"
        aria-label="Three-dimensional schematic of a transformer stack. The step by step walkthrough below carries the same information as text."
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={onClick}
      />
      <div className="tr-canvas-cap" data-live={part ? '' : undefined}>
        {part ? (
          <>
            <b>{part.label}</b>
            <span>{part.blurb}</span>
          </>
        ) : (
          <span className="tr-dia-hint">
            {interactive ? 'drag to orbit · scroll to zoom' : 'drag to orbit · click to enable zoom'}
          </span>
        )}
      </div>
    </div>
  );
}
