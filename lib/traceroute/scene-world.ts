// The world scene: one physical place at a time, built from lib/traceroute/props.ts.
//
// Same discipline as scene-silicon: every function is module scope because it mutates a
// WebGL scene, and every solid is a primitive described in data with a wireframe outline on
// top. Nothing is modelled by hand and no asset is fetched.
//
// Each stop is its own LOCAL world where roughly one unit is the place's characteristic
// size, so the camera stays in a well-conditioned numeric range whether the subject is a
// laptop or a datacenter. Absolute scale is carried by Stop.scaleLabel as text, never as
// coordinates, which is what lets eleven orders of magnitude live in one codebase.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { buildGroundShadow, buildOutlineGeometry, buildPropGeometry } from './geometry';
import { PROPS_BY_STOP, type Prop } from './props';
import { STOP_BY_ID } from './stops';
import type { PropId, StopId } from './types';
import { fillFor, outlineFor, type Palette } from './webgl';

interface PropArt {
  /** InstancedMesh when the prop repeats, plain Mesh otherwise. */
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | THREE.InstancedMesh;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  prop: Prop;
  /** Instance offsets, so explode can re-lay the lattice without rebuilding it. */
  offsets: THREE.Vector3[];
}

export interface WorldScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  props: Map<PropId, PropArt>;
  disposables: { dispose(): void }[];
  mount: HTMLElement;
  stop: StopId;
}

interface WorldPaint {
  hover: PropId | null;
  /** 0 assembled, 1 fully exploded. */
  explode: number;
  /** Light only the power path. */
  energy: boolean;
}

function instanceOffsets(p: Prop): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const [cx, cy, cz] = p.repeat?.count ?? [1, 1, 1];
  const [px, py, pz] = p.repeat?.pitch ?? [0, 0, 0];
  // Cap the lattice: a hall is dozens of racks and a dozen reads as "many" just as well,
  // at a fraction of the geometry.
  const nx = Math.min(cx, 12), ny = Math.min(cy, 12), nz = Math.min(cz, 8);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let k = 0; k < nz; k++) out.push(new THREE.Vector3(i * px, j * py, k * pz));
  return out;
}

export function buildWorld(mount: HTMLElement, stopId: StopId, pal: Palette): WorldScene {
  const stop = STOP_BY_ID.get(stopId)!;
  const width = mount.clientWidth || 800;
  const height = mount.clientHeight || 420;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(stop.pose.fov, width / height, 0.1, 600);
  camera.position.set(...stop.pose.pos);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.target.set(...stop.pose.target);
  controls.enableZoom = false; // until the reader clicks in; the page must keep its scroll
  controls.enablePan = false;
  // The stop's own look bounds, so a reader who orbits cannot end up facing nothing.
  controls.minPolarAngle = Math.max(0.12, Math.PI / 2 - stop.look.pitch[1] * 2 - 0.9);
  controls.maxPolarAngle = Math.PI / 2 + 0.22;
  const rest = camera.position.distanceTo(controls.target);
  controls.minDistance = rest * stop.look.dolly[0];
  controls.maxDistance = rest * stop.look.dolly[1];
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(1, 2.2, 1.4).multiplyScalar(rest);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(-1.4, 0.7, -1).multiplyScalar(rest);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(-0.4, -0.6, 1.6).multiplyScalar(rest);
  scene.add(rim);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const props = new Map<PropId, PropArt>();
  for (const p of PROPS_BY_STOP.get(stopId) ?? []) {
    const offsetsPre = instanceOffsets(p);
    const geo = track(buildPropGeometry(p, offsetsPre.length === 1));
    const mat = track(
      new THREE.MeshLambertMaterial({
        color: fillFor(p.material, pal),
        transparent: true,
        opacity: p.passive ? 0.28 : 1,
      })
    );
    const offsets = offsetsPre;
    const repeated = offsets.length > 1;

    const mesh = repeated
      ? new THREE.InstancedMesh(geo, mat, offsets.length)
      : new THREE.Mesh(geo, mat);
    mesh.userData.propId = p.id;
    if (mesh instanceof THREE.InstancedMesh) {
      const m = new THREE.Matrix4();
      offsets.forEach((o, i) => {
        m.makeTranslation(p.at[0] + o.x, p.at[1] + o.y, p.at[2] + o.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      mesh.position.set(p.at[0], p.at[1], p.at[2]);
      if (p.rot) mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    }
    scene.add(mesh);

    // One outline on the first instance only: outlining a whole lattice turns into noise.
    const edgeGeo = track(buildOutlineGeometry(geo));
    const edgeMat = track(
      new THREE.LineBasicMaterial({
        color: outlineFor(p.material, pal),
        transparent: true,
        opacity: p.passive ? 0.18 : 0.5,
      })
    );
    const outline = new THREE.LineSegments(edgeGeo, edgeMat);
    outline.position.set(p.at[0], p.at[1], p.at[2]);
    if (p.rot) outline.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    scene.add(outline);

    props.set(p.id, { mesh, outline, prop: p, offsets });
  }

  // Sit everything on a soft contact shadow, placed just under the lowest prop.
  {
    const all = PROPS_BY_STOP.get(stopId) ?? [];
    let lowest = 0;
    let reach = 1;
    for (const p of all) {
      lowest = Math.min(lowest, p.at[1] - p.size[1] / 2);
      reach = Math.max(reach, Math.abs(p.at[0]) + p.size[0], Math.abs(p.at[2]) + p.size[2]);
    }
    const shadow = buildGroundShadow(reach, pal.ink);
    shadow.position.y = lowest - 0.02;
    scene.add(shadow);
    disposables.push(shadow.geometry, shadow.material as THREE.Material);
  }

  return { renderer, scene, camera, controls, props, disposables, mount, stop: stopId };
}

const M = new THREE.Matrix4();

export function paintWorld(s: WorldScene, state: WorldPaint, pal: Palette) {
  const { hover, explode, energy } = state;

  for (const [id, art] of s.props) {
    const p = art.prop;
    const lit = hover === id;
    const relevant = energy ? !!p.energy : true;
    const dimmed = (hover != null && !lit) || (energy && !p.energy);

    const ex = p.explodeTo ?? [0, 0, 0];
    const px = p.at[0] + ex[0] * explode;
    const py = p.at[1] + ex[1] * explode;
    const pz = p.at[2] + ex[2] * explode;

    // Hoisted so the instanceof narrowing survives into the callback below.
    const mesh = art.mesh;
    if (mesh instanceof THREE.InstancedMesh) {
      art.offsets.forEach((o, i) => {
        M.makeTranslation(px + o.x, py + o.y, pz + o.z);
        mesh.setMatrixAt(i, M);
      });
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      mesh.position.set(px, py, pz);
    }
    art.outline.position.set(px, py, pz);

    const mat = art.mesh.material as THREE.MeshLambertMaterial;
    mat.opacity = p.passive ? (dimmed ? 0.1 : 0.26) : dimmed ? 0.14 : 1;
    mat.color.copy(fillFor(p.material, pal));
    if (lit) mat.color.lerp(pal.accent, 0.3);
    else if (energy && relevant && p.energy) mat.color.lerp(pal.heat[3], 0.35);

    art.outline.material.opacity = dimmed ? 0.1 : lit ? 1 : p.passive ? 0.18 : 0.5;
    art.outline.material.color.copy(
      lit ? pal.accent : energy && p.energy ? pal.heat[3] : outlineFor(p.material, pal)
    );
  }
}

export function recolourWorld(s: WorldScene, pal: Palette) {
  for (const art of s.props.values()) {
    (art.mesh.material as THREE.MeshLambertMaterial).color.copy(fillFor(art.prop.material, pal));
    art.outline.material.color.copy(outlineFor(art.prop.material, pal));
  }
}

export function resizeWorld(s: WorldScene) {
  const w = s.mount.clientWidth;
  const h = s.mount.clientHeight;
  if (!w || !h) return;
  s.camera.aspect = w / h;
  s.camera.updateProjectionMatrix();
  s.renderer.setSize(w, h);
}

export function disposeWorld(s: WorldScene) {
  s.renderer.setAnimationLoop(null);
  s.controls.dispose();
  for (const art of s.props.values()) {
    if (art.mesh instanceof THREE.InstancedMesh) art.mesh.dispose();
  }
  for (const d of s.disposables) d.dispose();
  s.renderer.dispose();
  if (s.renderer.domElement.parentNode === s.mount) s.mount.removeChild(s.renderer.domElement);
}

const RAY = new THREE.Raycaster();
const NDC = new THREE.Vector2();

export function pickProp(s: WorldScene, clientX: number, clientY: number): PropId | null {
  const rect = s.mount.getBoundingClientRect();
  NDC.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  RAY.setFromCamera(NDC, s.camera);
  const meshes = [...s.props.values()].filter((a) => !a.prop.passive).map((a) => a.mesh);
  const hit = RAY.intersectObjects(meshes, false)[0];
  return hit ? ((hit.object.userData.propId as PropId) ?? null) : null;
}
