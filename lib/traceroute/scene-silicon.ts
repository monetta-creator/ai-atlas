// The silicon scene: the transformer stack, and the inference loop played across it.
//
// Every function here mutates an external system (a WebGL scene), which is exactly why they
// all live at module scope instead of inside a component. The React Compiler lint rules
// treat in-component mutation of a captured object as an error, and they are right to: the
// scene is not React state and must never be rebuilt by a render.
//
// Geometry comes entirely from lib/traceroute/architecture.ts. Nothing is modelled by hand,
// so retuning the diagram is a data edit.
//
// Visual register: flat Lambert fills with a wireframe outline on every solid. The outline
// is the drawing and the fill is the shade. No bloom, no gloss, no post-processing, no
// shadow maps. That restraint is what keeps a perspective camera from reading as a game.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ARCH_PARTS, BLOCK_LATTICE, type ArchPartId, type ArchRole } from './architecture';
import { OVERVIEW, chase, lerpPose } from './camera';
import { PHASES, type PoseKey } from './phases';
import { INFERENCE_POSES } from './camera';
import type { Step } from './compile';
import { buildGroundShadow, buildOutlineGeometry, roundedBox } from './geometry';
import { fillFor, outlineFor, type Palette } from './webgl';
import type { MaterialKey, Pose } from './types';

const ROLE_MATERIAL: Record<ArchRole, MaterialKey> = {
  io: 'metal',
  stream: 'accent',
  weights: 'silicon',
  activation: 'glass',
  cache: 'copper',
};

interface PartArt {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  material: MaterialKey;
}

interface FlowArt {
  line: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  /** Kept so a marker can be sampled along it. */
  curve: THREE.QuadraticBezierCurve3;
  from: ArchPartId;
  to: ArchPartId;
}

export interface SiliconScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  parts: Map<ArchPartId, PartArt>;
  flows: FlowArt[];
  lattice: THREE.InstancedMesh | null;
  latticeOutline: THREE.LineSegments | null;
  /** A small pool of pips that travel the active connectors. */
  markers: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[];
  /** Where the camera is being asked to go. Chased, never snapped. */
  wanted: Pose;
  disposables: { dispose(): void }[];
  mount: HTMLElement;
}

function centreOf(id: ArchPartId): THREE.Vector3 {
  const p = ARCH_PARTS.find((x) => x.id === id);
  return p ? new THREE.Vector3(p.at[0], p.at[1], p.at[2]) : new THREE.Vector3();
}

/** Every connector any phase can pulse, built once. */
function allFlowPairs(): { from: ArchPartId; to: ArchPartId }[] {
  const seen = new Set<string>();
  const out: { from: ArchPartId; to: ArchPartId }[] = [];
  for (const spec of Object.values(PHASES)) {
    for (const f of spec.flow) {
      if (f.from === f.to) continue; // self-loops are weight annotations, not paths
      const key = `${f.from}->${f.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: f.from, to: f.to });
    }
  }
  return out;
}

export function buildSilicon(mount: HTMLElement, pal: Palette): SiliconScene {
  const width = mount.clientWidth || 900;
  const height = mount.clientHeight || 560;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(OVERVIEW.fov, width / height, 0.1, 400);
  camera.position.set(...OVERVIEW.pos);
  camera.lookAt(...OVERVIEW.target);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.target.set(...OVERVIEW.target);
  // Wheel zoom stays off until the reader clicks into the stage. A full-bleed canvas that
  // eats page scroll is the fastest way to make a page feel broken.
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 46;
  controls.minPolarAngle = 0.2;
  controls.maxPolarAngle = Math.PI / 2 + 0.15;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(14, 26, 18);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.55);
  fill.position.set(-18, 8, -12);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(-4, -8, 20);
  scene.add(rim);

  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- parts
  const parts = new Map<ArchPartId, PartArt>();
  for (const p of ARCH_PARTS) {
    const material = ROLE_MATERIAL[p.role];
    const geo = track(roundedBox(p.size[0], p.size[1], p.size[2]));
    const mat = track(
      new THREE.MeshLambertMaterial({ color: fillFor(material, pal), transparent: true, opacity: 1 })
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.partId = p.id;

    const edgeGeo = track(buildOutlineGeometry(geo));
    const outlineMat = track(
      new THREE.LineBasicMaterial({ color: outlineFor(material, pal), transparent: true, opacity: 0.55 })
    );
    const outline = new THREE.LineSegments(edgeGeo, outlineMat);

    const group = new THREE.Group();
    group.position.set(p.at[0], p.at[1], p.at[2]);
    group.add(mesh, outline);
    scene.add(group);
    parts.set(p.id, { group, mesh, outline, material });
  }

  // ---- blocks 2..N as a receding lattice. Honest (they are identical) and one draw call.
  let lattice: THREE.InstancedMesh | null = null;
  let latticeOutline: THREE.LineSegments | null = null;
  {
    const n = Math.min(BLOCK_LATTICE.count, 18);
    const geo = track(new THREE.BoxGeometry(5.2, 0.16, 5.2));
    const mat = track(
      new THREE.MeshLambertMaterial({
        color: fillFor('silicon', pal),
        transparent: true,
        opacity: 0.42,
      })
    );
    lattice = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    const span = BLOCK_LATTICE.to - BLOCK_LATTICE.from;
    for (let i = 0; i < n; i++) {
      m.makeTranslation(0, BLOCK_LATTICE.from + (i / (n - 1)) * span, 0);
      lattice.setMatrixAt(i, m);
    }
    lattice.instanceMatrix.needsUpdate = true;
    scene.add(lattice);

    const edgeGeo = track(new THREE.EdgesGeometry(geo));
    const edgeMat = track(
      new THREE.LineBasicMaterial({ color: outlineFor('silicon', pal), transparent: true, opacity: 0.2 })
    );
    latticeOutline = new THREE.LineSegments(edgeGeo, edgeMat);
    latticeOutline.position.set(0, BLOCK_LATTICE.from + span / 2, 0);
    latticeOutline.scale.set(1, span / 0.16, 1);
    scene.add(latticeOutline);
  }

  // ---- connectors. A travelling dash is the cheapest legible "data is moving" cue that
  // stays on register; particles and glow are exactly the cinematic vocabulary to avoid.
  const flows: FlowArt[] = [];
  for (const pair of allFlowPairs()) {
    const a = centreOf(pair.from);
    const b = centreOf(pair.to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.z += 1.6; // bow the connector out so it reads as a path, not an edge of a box
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = track(new THREE.BufferGeometry().setFromPoints(curve.getPoints(28)));
    const mat = track(
      new THREE.LineDashedMaterial({
        color: pal.ink,
        transparent: true,
        opacity: 0.12,
        dashSize: 0.34,
        gapSize: 0.26,
      })
    );
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    scene.add(line);
    flows.push({ line, curve, from: pair.from, to: pair.to });
  }

  // Movement is shown by a pip travelling the connector rather than by an animated dash.
  // Core LineDashedMaterial has no dash offset, and a single deliberate marker is a clearer
  // diagram convention than a particle effect would be anyway. Position is a pure function
  // of step progress, so scrubbing and playing land on the same frame.
  const markers: SiliconScene['markers'] = [];
  {
    const geo = track(new THREE.SphereGeometry(0.22, 12, 8));
    for (let i = 0; i < 4; i++) {
      const mat = track(new THREE.MeshBasicMaterial({ color: pal.accent, transparent: true }));
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      markers.push(m);
    }
  }

  {
    const shadow = buildGroundShadow(13, pal.ink);
    shadow.position.y = -2.4;
    scene.add(shadow);
    disposables.push(shadow.geometry, shadow.material as THREE.Material);
  }

  return {
    renderer, scene, camera, controls, parts, flows,
    lattice, latticeOutline, markers,
    wanted: OVERVIEW,
    disposables, mount,
  };
}

/** Apply one compiled step. Called every frame; must stay allocation-light. */
export function paintInference(s: SiliconScene, step: Step, progress: number, pal: Palette) {
  const focus = new Set<string>(step.focus);

  for (const [id, art] of s.parts) {
    const lit = focus.has(id);
    art.mesh.material.opacity = lit ? 1 : 0.16;
    art.outline.material.opacity = lit ? 1 : 0.12;
    if (lit) {
      art.mesh.material.color.copy(fillFor(art.material, pal)).lerp(pal.accent, 0.22);
      art.outline.material.color.copy(pal.accent);
    } else {
      art.mesh.material.color.copy(fillFor(art.material, pal));
      art.outline.material.color.copy(outlineFor(art.material, pal));
    }
  }

  // The stack sweep is the one moment the lattice is the subject.
  const sweeping = step.phase === 'blocks-repeat';
  if (s.lattice) {
    (s.lattice.material as THREE.MeshLambertMaterial).opacity = sweeping ? 0.85 : 0.34;
    (s.lattice.material as THREE.MeshLambertMaterial).color
      .copy(fillFor('silicon', pal))
      .lerp(pal.accent, sweeping ? 0.45 * (0.4 + 0.6 * progress) : 0);
  }

  const active = new Set(step.flow.map((f) => `${f.from}->${f.to}`));
  let marker = 0;
  for (const f of s.flows) {
    const on = active.has(`${f.from}->${f.to}`);
    f.line.material.opacity = on ? 0.95 : 0.06;
    f.line.material.color.copy(on ? pal.accent : pal.ink);
    if (on && marker < s.markers.length) {
      const m = s.markers[marker++];
      m.visible = true;
      m.position.copy(f.curve.getPoint(progress));
      m.material.color.copy(pal.accent);
    }
  }
  for (let i = marker; i < s.markers.length; i++) s.markers[i].visible = false;

  s.wanted = INFERENCE_POSES[step.poseKey as PoseKey] ?? OVERVIEW;
}

/** Move the camera toward the step's pose, weighted so reader input always wins. */
export function driveCamera(s: SiliconScene, dtMs: number, blend: number) {
  if (blend <= 0.001) {
    s.controls.update();
    return;
  }
  const k = chase(dtMs) * blend;
  const current: Pose = {
    pos: [s.camera.position.x, s.camera.position.y, s.camera.position.z],
    target: [s.controls.target.x, s.controls.target.y, s.controls.target.z],
    fov: s.camera.fov,
  };
  const next = lerpPose(current, s.wanted, k);
  s.camera.position.set(...next.pos);
  s.controls.target.set(...next.target);
  if (Math.abs(s.camera.fov - next.fov) > 0.01) {
    s.camera.fov = next.fov;
    s.camera.updateProjectionMatrix();
  }
  s.controls.update();
}

export function recolourSilicon(s: SiliconScene, pal: Palette) {
  for (const art of s.parts.values()) {
    art.mesh.material.color.copy(fillFor(art.material, pal));
    art.outline.material.color.copy(outlineFor(art.material, pal));
  }
  for (const f of s.flows) f.line.material.color.copy(pal.ink);
  if (s.lattice) (s.lattice.material as THREE.MeshLambertMaterial).color.copy(fillFor('silicon', pal));
}

export function resizeSilicon(s: SiliconScene) {
  const w = s.mount.clientWidth;
  const h = s.mount.clientHeight;
  if (!w || !h) return;
  s.camera.aspect = w / h;
  s.camera.updateProjectionMatrix();
  s.renderer.setSize(w, h);
}

export function disposeSilicon(s: SiliconScene) {
  s.renderer.setAnimationLoop(null);
  s.controls.dispose();
  for (const d of s.disposables) d.dispose();
  s.lattice?.dispose();
  s.renderer.dispose();
  if (s.renderer.domElement.parentNode === s.mount) s.mount.removeChild(s.renderer.domElement);
}

/** Raycast for hover and click. Returns the part under the pointer, if any. */
const RAY = new THREE.Raycaster();
const NDC = new THREE.Vector2();
export function pickPart(s: SiliconScene, clientX: number, clientY: number): ArchPartId | null {
  const rect = s.mount.getBoundingClientRect();
  NDC.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  RAY.setFromCamera(NDC, s.camera);
  const meshes = [...s.parts.values()].map((a) => a.mesh);
  const hit = RAY.intersectObjects(meshes, false)[0];
  return hit ? ((hit.object.userData.partId as ArchPartId) ?? null) : null;
}
