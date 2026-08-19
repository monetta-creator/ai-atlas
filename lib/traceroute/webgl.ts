// Browser capability probe and the bridge from CSS design tokens to three.js colours.
//
// The scene takes its entire palette from the stylesheet rather than hard-coding hex, so the
// light and dark themes work with no second definition and the 3D can never drift from the
// rest of the site.

import * as THREE from 'three';
import type { MaterialKey } from './types';

let webglSupport: boolean | null = null;

/** Probing allocates a canvas and the answer cannot change within a page life, so cache it. */
export function hasWebGL(): boolean {
  if (webglSupport === null) {
    try {
      const c = document.createElement('canvas');
      webglSupport = !!(
        window.WebGLRenderingContext &&
        (c.getContext('webgl2') || c.getContext('webgl'))
      );
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    : false;
}

/**
 * Tokens are authored as hex in one theme and rgb()/rgba() in the other (--dim and
 * --faint-ink flip), and THREE.Color cannot parse the alpha form. Normalise both.
 */
function cssColor(raw: string, fallback: string): THREE.Color {
  const value = raw.trim() || fallback;
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if ([r, g, b].every((n) => Number.isFinite(n))) return new THREE.Color(r / 255, g / 255, b / 255);
    return new THREE.Color(fallback);
  }
  try {
    return new THREE.Color(value);
  } catch {
    return new THREE.Color(fallback);
  }
}

export interface Palette {
  bg: THREE.Color;
  surface: THREE.Color;
  ink: THREE.Color;
  accent: THREE.Color;
  heat: THREE.Color[];
  supports: THREE.Color;
  dark: boolean;
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cssColor(cs.getPropertyValue(name), fallback);
  return {
    bg: v('--bg', '#f5f7fb'),
    surface: v('--surface', '#ffffff'),
    ink: v('--ink', '#0f172a'),
    accent: v('--accent', '#2d5bff'),
    heat: [
      v('--heat-0', '#5286c4'),
      v('--heat-1', '#4fae9f'),
      v('--heat-2', '#c2a24f'),
      v('--heat-3', '#d8893a'),
      v('--heat-4', '#c8512f'),
    ],
    supports: v('--supports', '#3f9b6e'),
    dark: document.documentElement.getAttribute('data-theme') === 'dark',
  };
}

/**
 * Material roles resolve to a fill mixed toward the surface colour, so every solid reads as
 * a shaded plane rather than a saturated toy. The outline carries the identity; the fill is
 * just the shade. That is what keeps this an architectural drawing instead of clip art.
 */
export function fillFor(key: MaterialKey, pal: Palette): THREE.Color {
  const mix = (c: THREE.Color, t: number) => c.clone().lerp(pal.surface, t);
  switch (key) {
    case 'silicon': return mix(pal.heat[0], 0.55);
    case 'copper': return mix(pal.heat[3], 0.5);
    case 'accent': return mix(pal.accent, 0.45);
    case 'glass': return mix(pal.heat[1], 0.66);
    case 'pcb': return mix(pal.supports, 0.6);
    case 'substrate': return mix(pal.heat[2], 0.62);
    case 'metal': return mix(pal.ink, 0.78);
    case 'enclosure': return mix(pal.ink, 0.85);
    case 'concrete': return mix(pal.ink, 0.9);
    case 'ghost': return mix(pal.ink, 0.95);
  }
}

export function outlineFor(key: MaterialKey, pal: Palette): THREE.Color {
  switch (key) {
    case 'accent': return pal.accent.clone();
    case 'copper': return pal.heat[3].clone();
    case 'silicon': return pal.heat[0].clone();
    default: return pal.ink.clone();
  }
}
