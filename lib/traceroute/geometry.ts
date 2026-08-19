// Geometry factory: turns a Prop description into an actual shape.
//
// Until now every prop was a BoxGeometry, including the ones declared as cylinders, which is
// why the service line and the coolant manifold looked like planks. This module honours
// `kind` and adds a small vocabulary of `detail` features so the hero objects read as what
// they are: a heatsink has fins, a rack has units, a memory stack has layers.
//
// Everything a prop needs is merged into ONE BufferGeometry, so a detailed object still
// costs one mesh, one material, and one outline. Detail is skipped for repeated props: a
// lattice reads as mass, and forty finned radiators would be noise as well as slow.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Prop } from './props';

/** Sub-features a prop can carry. Cheap, additive, and all built from primitives. */
export type PropDetail = 'fins' | 'slots' | 'layers' | 'fan' | 'screen' | 'ports';

function translated(geo: THREE.BufferGeometry, x: number, y: number, z: number) {
  geo.translate(x, y, z);
  return geo;
}

/** A chamfer proportional to the object, so small parts do not turn into pills. */
export function roundedBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const r = Math.min(w, h, d) * 0.12;
  if (r < 0.02) return new THREE.BoxGeometry(w, h, d);
  return new RoundedBoxGeometry(w, h, d, 2, r);
}

function baseGeometry(p: Prop): THREE.BufferGeometry {
  const [w, h, d] = p.size;
  switch (p.kind) {
    case 'cylinder': {
      // size is [radius, length, radius]; the run is along Y before any prop rotation.
      const g = new THREE.CylinderGeometry(w, w, h, 16, 1);
      return g;
    }
    case 'disc':
      return new THREE.CylinderGeometry(w / 2, w / 2, h, 40, 1);
    case 'slab':
      return roundedBox(w, h, d);
    case 'grid':
    case 'extrude':
    case 'box':
    default:
      return roundedBox(w, h, d);
  }
}

function finGeometries(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  const out: THREE.BufferGeometry[] = [];
  const n = Math.max(6, Math.min(22, Math.round(w / (Math.min(w, d) * 0.09))));
  const fw = (w * 0.86) / (n * 2);
  const fh = h * 0.85;
  for (let i = 0; i < n; i++) {
    const x = -w * 0.43 + (i / (n - 1)) * w * 0.86;
    out.push(translated(new THREE.BoxGeometry(fw, fh, d * 0.9), x, h / 2 + fh / 2, 0));
  }
  return out;
}

/** Rack units, or the horizontal seams on a server face. */
function slotGeometries(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  const out: THREE.BufferGeometry[] = [];
  const n = Math.max(3, Math.min(20, Math.round(h / (Math.min(w, h) * 0.16))));
  const sh = (h * 0.7) / (n * 2);
  for (let i = 0; i < n; i++) {
    const y = -h * 0.4 + (i / (n - 1)) * h * 0.8;
    out.push(translated(new THREE.BoxGeometry(w * 0.82, sh, d * 0.06), 0, y, d / 2));
  }
  return out;
}

/** Stacked dies, or the layer count of a board. */
function layerGeometries(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  const out: THREE.BufferGeometry[] = [];
  const n = 5;
  const lh = h / (n * 2.6);
  for (let i = 0; i < n; i++) {
    const y = -h / 2 + ((i + 0.6) / n) * h;
    out.push(translated(new THREE.BoxGeometry(w * 1.04, lh, d * 1.04), 0, y, 0));
  }
  return out;
}

function fanGeometry(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  const r = Math.min(w, d) * 0.3;
  const ring = new THREE.TorusGeometry(r, r * 0.14, 8, 24);
  ring.rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(r * 0.28, r * 0.28, h * 0.12, 12);
  return [
    translated(ring, w * 0.24, h / 2 + h * 0.04, 0),
    translated(hub, w * 0.24, h / 2 + h * 0.06, 0),
  ];
}

/** An inset panel, so a display reads as a bezel plus a screen. */
function screenGeometry(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  return [translated(new THREE.BoxGeometry(w * 0.9, h * 0.86, d * 0.5), 0, 0, d * 0.4)];
}

function portGeometries(p: Prop): THREE.BufferGeometry[] {
  const [w, h, d] = p.size;
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    out.push(
      translated(
        new THREE.BoxGeometry(w * 0.16, h * 0.3, d * 0.12),
        -w * 0.25 + i * w * 0.25,
        0,
        d / 2
      )
    );
  }
  return out;
}

const DETAIL_BUILDERS: Record<PropDetail, (p: Prop) => THREE.BufferGeometry[]> = {
  fins: finGeometries,
  slots: slotGeometries,
  layers: layerGeometries,
  fan: fanGeometry,
  screen: screenGeometry,
  ports: portGeometries,
};

/**
 * One merged geometry per prop, centred on the origin. The caller positions it.
 *
 * `withDetail` is false for repeated props so a lattice stays cheap and legible.
 */
export function buildPropGeometry(p: Prop, withDetail: boolean): THREE.BufferGeometry {
  const base = baseGeometry(p);
  if (!withDetail || !p.detail) return base;

  const extras = DETAIL_BUILDERS[p.detail](p);
  if (extras.length === 0) return base;

  // mergeGeometries refuses to mix indexed and non-indexed inputs, and RoundedBoxGeometry is
  // non-indexed while BoxGeometry, CylinderGeometry, and TorusGeometry are indexed. Without
  // this every merge fails and the detail is silently dropped, which is exactly what happened
  // the first time: twenty objects rendered as bare boxes and nothing reported it.
  const flat = [base, ...extras].map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat, false);

  for (let i = 0; i < flat.length; i++) {
    if (flat[i] !== [base, ...extras][i]) flat[i].dispose(); // dispose the converted copies
  }
  for (const g of extras) g.dispose();

  if (!merged) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`traceroute/geometry: merge failed for "${p.id}" (detail: ${p.detail})`);
    }
    return base;
  }
  base.dispose();
  return merged;
}

/**
 * Outline geometry. The threshold matters: at 1 degree a rounded box and a bank of fins
 * become a scribble, so only genuine corners are drawn.
 */
export function buildOutlineGeometry(geo: THREE.BufferGeometry): THREE.EdgesGeometry {
  return new THREE.EdgesGeometry(geo, 24);
}

/**
 * A fake contact shadow: one plane with a radial alpha ramp, drawn under the subject.
 * Objects without one look like they are floating, and a real shadow map costs far more
 * than this is worth for a flat-shaded diagram.
 */
export function buildGroundShadow(radius: number, ink: THREE.Color): THREE.Mesh {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const rgb = `${Math.round(ink.r * 255)},${Math.round(ink.g * 255)},${Math.round(ink.b * 255)}`;
  g.addColorStop(0, `rgba(${rgb},0.34)`);
  g.addColorStop(0.55, `rgba(${rgb},0.12)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.4, radius * 2.4), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = -1;
  return mesh;
}
