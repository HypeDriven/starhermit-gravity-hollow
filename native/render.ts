// The miniature plaza on starhermit:scene, as the browser build's
// src/render.js drew it with three.js: the paved ground (a procedural canvas
// texture; on the detailed looks per-slab tones, mortar, grit and moss with a
// matching bump map), the rim walls with their accent light strip, the
// obstacles (the central fountain with its lip, spout and shimmering water;
// planters as hedges of leafy mounds; masonry arcade blocks with cap slabs),
// one InstancedMesh per prop kind (crumbs, chunks, boulders, gems, embers;
// edible props brighten and pulse, gems bob and spin, embers flicker), the
// voids (a glossy dark body squashed by speed, an ownership rim in white or
// the rival's palette colour, the inner glow, a contact shadow and an
// accretion swirl on the detailed looks), pooled spark bursts per rules
// event, boost trails, drifting light motes, the tutorial's visit markers,
// the authored camera (a critically damped spring that keeps the player in
// the inner part of the view) and its event shake.
//
// From three.js: light intensities are three.js's ÷ π (the engine's
// convention for three r155+ physical lights); Lambert "twins" on Low are
// built as Lambert materials directly; the post chain is renderer.ao / bloom
// / grade / antialias (the browser build's GTAOPass, UnrealBloomPass
// threshold 2.0, GradeShader in display space, FXAA / SMAA / MSAA);
// RoomEnvironment(renderer) for the image-based lighting; the directional
// shadow is fitted by `distance`. Adaptive resolution, the frame-rate meter
// and the pixel-ratio cap are the runtime's.
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, DodecahedronGeometry, DoubleSide, DynamicDrawUsage, Fog, Group, HemisphereLight, IcosahedronGeometry,
  InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NormalBlending,
  OctahedronGeometry, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Points, PointsMaterial, RepeatWrapping, RingGeometry, RoomEnvironment,
  SphereGeometry, SRGBColorSpace, TetrahedronGeometry, TorusGeometry, Vector3, renderer, scene,
  type Material, type Object3D, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { Content, type Obstacle, type RulesEvent, type State, type Theme } from "./game.ts";
import { particleBudget, type Look } from "./quality.ts";
import type { Palette } from "./platform.ts";

const THEMES = Content.THEMES;
type VoidS = State["voids"][number];
export interface StageLike { theme: string; arenaHalf: number; obstacles: Obstacle[]; propTarget?: number }
type StateLike = State;

const PI = Math.PI;
// Framing constants (src/render.js CAM).
const CAM = { fov: 38, tiltDeg: 52, distPerHalf: 1.55, minDist: 46, follow: 0.22, springK: 42, springC: 12, shakeAmp: 0.35, shakeDecay: 6 };
const SHADOW_DIST = 160;

renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
const camera = new PerspectiveCamera(CAM.fov, 1, 1, 400);

let look: Look | null = null;
let palette: Palette = "default";
let reducedMotion = false;
let stage: StageLike | null = null;
let theme: Theme = THEMES.verdant!;
let state: StateLike | null = null;

const root = new Group();
scene.add(root);

let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

const detailed = (): boolean => !!look && look.detailed;
const physical = (): boolean => detailed() && look!.budget.material === "physical";
const seg = (n: number): number => Math.max(6, Math.round(n * (look?.budget.segments ?? 1)));
const bloomOn = (): boolean => !!look && look.bloom;

interface MatParams {
  color: number; roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number; envMapIntensity?: number;
  map?: Texture | null; bumpMap?: Texture | null; bumpScale?: number; flatShading?: boolean;
}
/** A lit material in the look's class (src/render.js applyMaterialClass: Lambert twins on Low). */
function lit(p: MatParams): MeshStandardMaterial | MeshLambertMaterial {
  if (look?.budget.material === "lambert") {
    return new MeshLambertMaterial({
      color: p.color, map: p.map ?? null, emissive: p.emissive ?? 0x000000, emissiveIntensity: p.emissiveIntensity ?? 1, flatShading: !!p.flatShading,
    });
  }
  return new MeshStandardMaterial({
    color: p.color, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0, emissive: p.emissive ?? 0x000000,
    emissiveIntensity: p.emissiveIntensity ?? 1, envMapIntensity: p.envMapIntensity ?? 1, map: p.map ?? null,
    ...(p.bumpMap ? { bumpMap: p.bumpMap, bumpScale: p.bumpScale ?? 1 } : {}), flatShading: !!p.flatShading,
  });
}
/** Glowing materials: [normal, with bloom] emissive intensity (src/render.js userData.glow). */
const glowing: { m: MeshStandardMaterial | MeshLambertMaterial | MeshPhysicalMaterial; glow: [number, number] }[] = [];
const glowColors: { m: MeshBasicMaterial; glow: [number, number] }[] = [];
function applyGlow(): void {
  const hot = bloomOn() ? 1 : 0;
  for (const g of glowing) g.m.emissiveIntensity = g.glow[hot];
  for (const g of glowColors) g.m.color.setScalar(g.glow[hot]);
}

// -- lights (three.js intensities ÷ π) ---------------------------------------------------
const hemi = new HemisphereLight(0xffffff, 0x000000, 2 / PI);
const amb = new AmbientLight(0xffffff, 0.5 / PI);
const key = new DirectionalLight(0xffffff, 2.6 / PI);
key.position.set(30, 55, 18);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.03;
scene.add(hemi, amb, key, key.target);
function applyLights(): void {
  const t = theme;
  const d = detailed();
  hemi.color.setHex(t.fill); hemi.groundColor.setHex(t.ground);
  hemi.intensity = (d ? 2.0 : 2.1) / PI;
  amb.color.setHex(t.fill); amb.intensity = (d ? 0.45 : 0.5) / PI;
  key.color.setHex(t.key); key.intensity = (d ? 2.9 : 2.6) / PI;
  const shadows = !!look && look.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  key.castShadow = shadows;
  if (shadows) key.shadow.mapSize = look!.shadows;
  key.shadow.distance = SHADOW_DIST;
}

// -- procedural textures (cosmetic; never touch the rules' streams) ----------------------
const hex = (c: Color): string => "#" + c.getHex().toString(16).padStart(6, "0");
/** src/render.js groundTexture: a 10×10 wobbly tile grid with a faint checker, drawn in 512-px units at `n`. */
function groundTexture(t: Theme, half: number, n: number): Texture {
  const S = 512;
  const cv = new OffscreenCanvas(n, n);
  const ctx = cv.getContext("2d");
  ctx.scale(n / S, n / S);
  ctx.fillStyle = hex(new Color(t.ground));
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = hex(new Color(t.groundLine));
  ctx.lineWidth = 2;
  const cells = 10, step = S / cells;
  let s = t.id.length * 7919;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    for (let j = 0; j <= cells; j++) ctx.lineTo(j * step, i * step + (rnd() - 0.5) * 3);
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j <= cells; j++) ctx.lineTo(i * step + (rnd() - 0.5) * 3, j * step);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * step, j * step, step, step);
  const tex = new CanvasTexture(cv);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(Math.max(1, half / 22), Math.max(1, half / 22));
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
function roundRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
/** src/render.js groundTextureDetailed: running-bond slabs, mortar, grit and moss, with a bump map; 1024-px units at `n`. */
function groundTextureDetailed(t: Theme, half: number, n: number): { map: Texture; bump: Texture } {
  const S = 1024, cells = 8, step = S / cells;
  const mk = (): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] => {
    const c = new OffscreenCanvas(n, n);
    const x = c.getContext("2d");
    x.scale(n / S, n / S);
    return [c, x];
  };
  const [cv, ctx] = mk();
  const [bv, btx] = mk();
  const base = new Color(t.ground), line = new Color(t.groundLine), moss = new Color(t.fill);
  let s = t.id.length * 7919 + 17;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  ctx.fillStyle = hex(base.clone().lerp(line, 0.3).multiplyScalar(0.55));
  ctx.fillRect(0, 0, S, S);
  btx.fillStyle = "#202020";
  btx.fillRect(0, 0, S, S);
  const gap = 5;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const off = (j % 2) * step / 2;
      for (const dx of [0, -S]) {
        const x = i * step + off + dx, y = j * step;
        if (x + step < 0 || x > S) continue;
        const tone = 0.9 + rnd() * 0.14;
        const c = base.clone().multiplyScalar(tone).lerp(moss, rnd() * 0.04);
        const jx = (rnd() - 0.5) * 2, jy = (rnd() - 0.5) * 2;
        ctx.fillStyle = hex(c);
        roundRect(ctx, x + gap + jx, y + gap + jy, step - gap * 2, step - gap * 2, 7);
        ctx.fill();
        const b = 150 + ((rnd() * 60) | 0);
        btx.fillStyle = `rgb(${b},${b},${b})`;
        roundRect(btx, x + gap + jx, y + gap + jy, step - gap * 2, step - gap * 2, 7);
        btx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + gap + 6, y + step - gap - 4);
        ctx.lineTo(x + gap + 4, y + gap + 4);
        ctx.lineTo(x + step - gap - 6, y + gap + 4);
        ctx.stroke();
      }
    }
  }
  for (let k = 0; k < 9000; k++) {
    const x = rnd() * S, y = rnd() * S, r = rnd() * 1.6 + 0.3;
    const light = rnd() < 0.5;
    ctx.fillStyle = light ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.09)";
    ctx.fillRect(x, y, r, r);
    btx.fillStyle = light ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
    btx.fillRect(x, y, r, r);
  }
  ctx.fillStyle = hex(moss.clone().multiplyScalar(0.55));
  for (let k = 0; k < 700; k++) {
    const onRow = rnd() < 0.5;
    const a = Math.round(rnd() * cells) * step;
    const b = rnd() * S;
    const x = onRow ? b : a + ((Math.floor(b / step) % 2) * step / 2);
    const y = onRow ? a : b;
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.beginPath();
    ctx.arc(x % S, y % S, 1.5 + rnd() * 4, 0, PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const map = new CanvasTexture(cv), bump = new CanvasTexture(bv);
  const rep = Math.max(1, half / 18);
  for (const tx of [map, bump]) { tx.wrapS = tx.wrapT = RepeatWrapping; tx.repeat.set(rep, rep); tx.anisotropy = 4; }
  map.colorSpace = SRGBColorSpace;
  return { map, bump };
}
/** Soft round sprite (radial falloff) for particles, motes and contact shadows. */
function softDot(inner = 0, alpha = 1): Texture {
  const S = 64;
  const cv = new OffscreenCanvas(S, S);
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.5 * inner, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.45})`);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
/** Spiral dust streaks for the accretion swirl (on a RingGeometry's UVs). */
function swirlTexture(): Texture {
  const S = 128;
  const cv = new OffscreenCanvas(S, S);
  const ctx = cv.getContext("2d");
  ctx.translate(S / 2, S / 2);
  ctx.lineCap = "round";
  for (let arm = 0; arm < 5; arm++) {
    for (let i = 0; i < 26; i++) {
      const f = i / 26;
      const a = arm * (PI * 2 / 5) + f * 2.4;
      const r = S * (0.28 + 0.2 * f);
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - f)).toFixed(3)})`;
      ctx.lineWidth = 2.6 * (1 - f) + 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, a, a + 0.12);
      ctx.stroke();
    }
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
let dotTex: Texture | null = null, blobTex: Texture | null = null, swirlTex: Texture | null = null;
const dot = (): Texture => (dotTex ??= softDot());
const blob = (): Texture => (blobTex ??= softDot(0, 0.75));
const swirl = (): Texture => (swirlTex ??= swirlTexture());
const shared = (t: Texture | null | undefined): boolean => !!t && (t === dotTex || t === blobTex || t === swirlTex);

/** Deterministic per-void colour, palette-aware (shape and label reinforce colour). */
const PALETTE_SETS: Record<Palette, number[]> = {
  default: [0xff6b6b, 0x4ecdc4, 0xffd166, 0xa78bfa, 0xf9844a, 0x90be6d, 0x43aa8b],
  deuteranopia: [0x0173b2, 0xde8f05, 0x029e73, 0xd55e00, 0xcc78bc, 0x56b4e9, 0xf0e442],
  protanopia: [0x0173b2, 0xde8f05, 0x029e73, 0xca9161, 0xcc78bc, 0x56b4e9, 0xf0e442],
  tritanopia: [0x0072b2, 0xe69f00, 0x009e73, 0xd55e00, 0xcc79a7, 0x56b4e9, 0xf0e442],
};
export function voidColor(id: number): number { return id === 0 ? 0xffffff : (PALETTE_SETS[palette] ?? PALETTE_SETS.default)[id % 7]!; }

// -- the stage ---------------------------------------------------------------------------
interface VoidView { group: Group; body: Mesh; ring: Mesh<MeshBasicMaterial>; glow: Mesh; swirl: Mesh | null; blob: Mesh | null; trailAcc: number }
let propMeshes: Record<string, InstancedMesh> = {};
const voidViews = new Map<number, VoidView>();
let markers: { mesh: Mesh; x: number; y: number }[] = [];
let animated: ((time: number) => void)[] = [];
let motes: Points | null = null;
let particles: { points: Points; pool: Particle[]; max: number } | null = null;
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; age: number; r: number; g: number; b: number }

function disposeTree(o: Object3D): void {
  o.traverse((ch) => {
    const m = ch as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: Material | Material[] }).material;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) {
      const s = x as MeshStandardMaterial;
      if (s.map && !shared(s.map)) s.map.dispose();
      if (s.bumpMap) s.bumpMap.dispose();
      x.dispose();
    }
  });
}
function clearStage(): void {
  while (root.children.length) { const ch = root.children[root.children.length - 1]!; root.remove(ch); disposeTree(ch); }
  propMeshes = {};
  voidViews.clear();
  markers = [];
  animated = [];
  motes = null;
  particles = null;
  glowing.length = 0;
  glowColors.length = 0;
}

/** Builds the stage's plaza (src/render.js loadStage); `snapshot` places the props and voids at once. */
export function loadStage(next: StageLike, snapshot: StateLike | null): void {
  stage = next;
  state = snapshot;
  rebuild();
  frameCamera(next.arenaHalf, true);
}
function rebuild(): void {
  clearStage();
  if (!stage || !look) return;
  theme = THEMES[stage.theme] ?? THEMES.verdant!;
  scene.background = new Color(theme.sky);
  scene.fog = new Fog(theme.fog, 90, 260);
  scene.environment = detailed() ? envMap() : null;
  applyLights();
  buildGround(stage);
  buildObstacles(stage);
  buildPropMeshes(stage);
  buildParticles();
  buildAtmosphere(stage);
  applyGlow();
  if (state) syncProps(state);
}

function buildGround(st: StageLike): void {
  const half = st.arenaHalf;
  const d = detailed();
  let mat: Material;
  if (d) {
    const { map, bump } = groundTextureDetailed(theme, half, look!.budget.ground);
    mat = lit({ color: 0xffffff, map, bumpMap: bump, bumpScale: 1.4, roughness: 0.88, metalness: 0, envMapIntensity: 0.08 });
  } else mat = lit({ color: 0xffffff, map: groundTexture(theme, half, Math.min(512, look!.budget.ground)), roughness: 0.95, metalness: 0 });
  const ground = new Mesh(new PlaneGeometry(half * 2 + 8, half * 2 + 8), mat);
  ground.rotation.x = -PI / 2;
  ground.receiveShadow = true;
  root.add(ground);
  const rimMat = lit({ color: theme.obstacle, roughness: 0.8, envMapIntensity: 0.5 });
  const rimGeo = new BoxGeometry(half * 2 + 8, 1.6, 1.2);
  const stripMat = d ? lit({ color: theme.obstacleTop, emissive: theme.accent, emissiveIntensity: 0.22, roughness: 0.4 }) : null;
  const stripGeo = d ? new BoxGeometry(half * 2 + 8, 0.12, 0.22) : null;
  const sides: [number, number, number, number, number][] = [[0, -half - 4.6, 0, 0, 1], [0, half + 4.6, 0, 0, -1], [-half - 4.6, 0, PI / 2, 1, 0], [half + 4.6, 0, PI / 2, -1, 0]];
  for (const [x, y, rot, sx, sy] of sides) {
    const rim = new Mesh(rimGeo, rimMat);
    rim.position.set(x, 0.8, y);
    rim.rotation.y = rot;
    rim.castShadow = rim.receiveShadow = true;
    root.add(rim);
    if (stripMat && stripGeo) {
      const strip = new Mesh(stripGeo, stripMat);
      strip.position.set(x + sx * 0.5, 1.62, y + sy * 0.5);
      strip.rotation.y = rot;
      root.add(strip);
    }
  }
}

function buildObstacles(st: StageLike): void {
  const d = detailed();
  const t = theme;
  const std = (o: MatParams): MeshStandardMaterial | MeshLambertMaterial => lit({ roughness: 0.85, envMapIntensity: 0.6, ...o });
  for (const o of st.obstacles) {
    let mesh: Mesh;
    if (o.kind === "fountain") {
      mesh = new Mesh(new CylinderGeometry(o.hw, o.hw * 1.1, 1.6, seg(d ? 48 : 24)), std({ color: t.obstacleTop, roughness: 0.5, metalness: 0.15 }));
      const waterMat = physical()
        ? new MeshPhysicalMaterial({ color: t.accent, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, emissive: t.accent, emissiveIntensity: 0.3, envMapIntensity: 1.3 })
        : lit({ color: t.accent, roughness: 0.15, metalness: 0.4, emissive: t.accent, emissiveIntensity: 0.25 });
      const water = new Mesh(new CylinderGeometry(o.hw * 0.78, o.hw * 0.78, 0.3, seg(d ? 48 : 24)), waterMat);
      water.position.set(o.x, 1.05, o.y);
      root.add(water);
      if (d) {
        const lip = new Mesh(new TorusGeometry(o.hw * 0.92, 0.22, seg(10), seg(48)), std({ color: t.obstacleTop, roughness: 0.45 }));
        lip.rotation.x = PI / 2;
        lip.position.set(o.x, 1.42, o.y);
        lip.castShadow = true;
        root.add(lip);
        const col = new Mesh(new CylinderGeometry(0.35, 0.55, 2.4, seg(16)), std({ color: t.obstacleTop, roughness: 0.4 }));
        col.position.set(o.x, 2.1, o.y);
        col.castShadow = true;
        root.add(col);
        const bowl = new Mesh(new CylinderGeometry(1.05, 0.4, 0.45, seg(20)), std({ color: t.obstacleTop, roughness: 0.4 }));
        bowl.position.set(o.x, 3.3, o.y);
        bowl.castShadow = true;
        root.add(bowl);
        // Water shimmer: emissive breathing (atmosphere on, motion allowed).
        animated.push((time) => { waterMat.emissiveIntensity = 0.28 + 0.1 * Math.sin(time * 1.7) + 0.05 * Math.sin(time * 4.3); });
      }
    } else if (o.kind === "planter" && d) {
      mesh = new Mesh(new BoxGeometry(o.hw * 2, 1.2, o.hh * 2), std({ color: t.obstacle, roughness: 0.9 }));
      // Hedge: a cluster of leafy mounds rather than one blob.
      const leaf = std({ color: t.fill, roughness: 1, flatShading: true, envMapIntensity: 0.3 });
      const rMin = Math.min(o.hw, o.hh);
      const along = o.hw >= o.hh ? "x" : "z";
      const len = Math.max(o.hw, o.hh);
      const n = Math.max(1, Math.round(len / (rMin * 0.9)));
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : (i / (n - 1) - 0.5) * (len * 2 - rMin * 1.6);
        const bush = new Mesh(new IcosahedronGeometry(rMin * (0.8 + 0.12 * ((i * 7) % 3)), 1), leaf);
        bush.position.set(o.x + (along === "x" ? u : 0), 1.55, o.y + (along === "z" ? u : 0));
        bush.scale.y = 0.85;
        bush.castShadow = bush.receiveShadow = true;
        root.add(bush);
      }
    } else {
      mesh = new Mesh(new BoxGeometry(o.hw * 2, 2.2, o.hh * 2), std({ color: t.obstacle }));
      if (d && o.kind !== "planter") {
        // A cap slab with a slight overhang reads as masonry.
        const cap = new Mesh(new BoxGeometry(o.hw * 2 + 0.3, 0.25, o.hh * 2 + 0.3), std({ color: t.obstacleTop, roughness: 0.6 }));
        cap.position.set(o.x, 2.33, o.y);
        cap.castShadow = cap.receiveShadow = true;
        root.add(cap);
      }
    }
    mesh.position.set(o.x, o.kind === "arcade" ? 1.1 : 0.6, o.y);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
}

function buildPropMeshes(st: StageLike): void {
  const max = (st.propTarget ?? 90) + 40;
  const d = detailed();
  const defs: Record<string, { geo: BufferGeometry; rough: number }> = {
    crumb: { geo: new IcosahedronGeometry(0.55, 0), rough: 0.6 },
    chunk: { geo: new IcosahedronGeometry(0.95, 0), rough: 0.55 },
    boulder: { geo: new DodecahedronGeometry(1.5, 0), rough: 0.7 },
    gem: { geo: new OctahedronGeometry(1.05, 0), rough: 0.2 },
    ember: { geo: new TetrahedronGeometry(1.0, 0), rough: 0.4 },
  };
  for (const [kind, def] of Object.entries(defs)) {
    const color = theme.propColors[kind] ?? 0xffffff;
    let mat: MeshStandardMaterial | MeshLambertMaterial | MeshPhysicalMaterial;
    if (!d) {
      mat = lit({
        color, roughness: def.rough, metalness: kind === "gem" ? 0.6 : 0.05,
        emissive: kind === "ember" || kind === "gem" ? color : 0x000000,
        emissiveIntensity: kind === "ember" ? 0.7 : kind === "gem" ? 0.35 : 0,
      });
    } else if (kind === "gem" && physical()) {
      // Cut-glass gem: clear-coated, env reflections, an emissive core that blooms.
      mat = new MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, emissive: color, emissiveIntensity: 0.45, envMapIntensity: 1.1, flatShading: true });
      glowing.push({ m: mat, glow: [0.45, 0.8] });
    } else if (kind === "ember") {
      // Hot core: emissive above 1 so bloom picks embers out as the hazard.
      mat = lit({ color, roughness: 0.35, emissive: color, emissiveIntensity: 1.5, flatShading: true, envMapIntensity: 0.4 });
      glowing.push({ m: mat, glow: [1.5, 3.5] });
    } else if (physical()) {
      mat = new MeshPhysicalMaterial({ color, roughness: def.rough, metalness: 0.02, clearcoat: 0.2, clearcoatRoughness: 0.5, flatShading: true, envMapIntensity: 0.4 });
    } else {
      mat = lit({
        color, roughness: kind === "gem" ? 0.12 : def.rough, metalness: kind === "gem" ? 0.25 : 0.02,
        emissive: kind === "gem" ? color : 0x000000, emissiveIntensity: kind === "gem" ? 0.45 : 0, flatShading: true,
        envMapIntensity: kind === "gem" ? 1.1 : 0.4,
      });
      if (kind === "gem") glowing.push({ m: mat, glow: [0.45, 0.8] });
    }
    const im = new InstancedMesh(def.geo, mat, max);
    im.count = 0;
    im.castShadow = kind !== "crumb";
    im.receiveShadow = d;
    im.instanceMatrix.setUsage(DynamicDrawUsage);
    im.frustumCulled = false;
    root.add(im);
    propMeshes[kind] = im;
  }
}

function buildParticles(): void {
  const max = Math.max(64, particleBudget(look!));
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(max * 3), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(max * 3), 3));
  geo.setDrawRange(0, 0);
  const soft = detailed();
  const mat = new PointsMaterial({
    size: soft ? 0.8 : 0.55, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
    map: soft ? dot() : null, blending: soft ? AdditiveBlending : NormalBlending,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  root.add(points);
  particles = { points, pool: [], max };
}

/** Drifting motes of light over the plaza (atmosphere): one Points draw. */
function buildAtmosphere(st: StageLike): void {
  const half = st.arenaHalf + 4;
  const n = look!.budget.motes;
  const pos = new Float32Array(n * 3);
  const seeds: { x: number; z: number; y: number; ph: number; sp: number }[] = [];
  let s = 1 + theme.id.length * 131;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const m = { x: (rnd() * 2 - 1) * half, z: (rnd() * 2 - 1) * half, y: 0.6 + rnd() * 7, ph: rnd() * 6.28, sp: 0.25 + rnd() * 0.5 };
    seeds.push(m);
    pos[i * 3] = m.x; pos[i * 3 + 1] = m.y; pos[i * 3 + 2] = m.z;
  }
  const geo = new BufferGeometry();
  const attr = new BufferAttribute(pos, 3);
  geo.setAttribute("position", attr);
  const mat = new PointsMaterial({ size: 0.45, color: theme.accent, map: dot(), transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending });
  const pts = new Points(geo, mat);
  pts.frustumCulled = false;
  root.add(pts);
  motes = pts;
  pts.visible = look!.atmosphere;
  animated.push((time) => {
    for (let i = 0; i < n; i++) {
      const m = seeds[i]!;
      pos[i * 3] = m.x + Math.sin(time * 0.3 * m.sp + m.ph) * 1.6;
      pos[i * 3 + 1] = 0.6 + ((m.y + time * m.sp * 0.6) % 7.4);
      pos[i * 3 + 2] = m.z + Math.cos(time * 0.25 * m.sp + m.ph) * 1.6;
    }
    attr.needsUpdate = true;
    mat.opacity = 0.45 + 0.1 * Math.sin(time * 0.8);
  });
}

// -- voids -------------------------------------------------------------------------------
function makeVoidView(v: VoidS): VoidView {
  const group = new Group();
  const isMe = v.id === 0;
  const d = detailed();
  // Clear-coated hollow on High/Ultra; standard on Balanced; Lambert on Low.
  const bodyMat = look!.budget.material === "physical"
    ? new MeshPhysicalMaterial({ color: 0x0a0a12, roughness: d ? 0.18 : 0.25, metalness: 0.1, clearcoat: d ? 1 : 0.8, clearcoatRoughness: d ? 0.12 : 0.3, envMapIntensity: 0.3 })
    : lit({ color: 0x0a0a12, roughness: 0.22, metalness: 0.1, envMapIntensity: 0.3 });
  const body = new Mesh(new SphereGeometry(1, seg(d ? 40 : 28), seg(d ? 28 : 20)), bodyMat);
  body.scale.y = 0.72;
  body.castShadow = true;
  group.add(body);
  // The rim: shape and colour reinforce ownership (not bloom alone).
  const ringColor = voidColor(v.id);
  const ringMat = new MeshBasicMaterial({ color: ringColor, transparent: true, opacity: isMe ? 0.95 : 0.7, side: DoubleSide });
  // The player's ring renders un-tone-mapped so it stays pure white and gets a bloom halo.
  if (isMe && d) { ringMat.toneMapped = false; glowColors.push({ m: ringMat, glow: [1, 2.4] }); }
  const ring = new Mesh(new RingGeometry(1.05, 1.22, seg(48)), ringMat);
  ring.rotation.x = -PI / 2;
  ring.position.y = 0.06;
  group.add(ring);
  const glow = new Mesh(new CircleGeometry(0.72, 28),
    new MeshBasicMaterial({ color: isMe ? new Color(0x2a2a44) : new Color(ringColor).multiplyScalar(0.25), transparent: true, opacity: 0.9 }));
  glow.rotation.x = -PI / 2;
  glow.position.y = 0.05;
  group.add(glow);
  let sw: Mesh | null = null, bl: Mesh | null = null;
  if (d) {
    // Contact shadow: a soft dark pool that grounds the hollow even without shadow maps.
    bl = new Mesh(new CircleGeometry(1.7, 32), new MeshBasicMaterial({ map: blob(), color: 0x000000, transparent: true, depthWrite: false }));
    bl.rotation.x = -PI / 2;
    bl.position.y = 0.03;
    bl.renderOrder = -1;
    group.add(bl);
    // Accretion swirl: a faint spiral of pulled-in dust circling the rim.
    sw = new Mesh(new RingGeometry(1.15, 2.0, seg(48), 1),
      new MeshBasicMaterial({ map: swirl(), color: ringColor, transparent: true, opacity: isMe ? 0.32 : 0.26, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
    sw.rotation.x = -PI / 2;
    sw.position.y = 0.09;
    sw.visible = look!.atmosphere;
    group.add(sw);
  }
  root.add(group);
  applyGlow();
  return { group, body, ring, glow, swirl: sw, blob: bl, trailAcc: 0 };
}

const m4 = new Matrix4();
const tmpC = new Color();
let time = 0;
let atmoTime = 0;
const moving = (): boolean => !reducedMotion;

/** Instance transforms and edibility tints of the props (src/render.js syncSnapshot). */
function syncProps(st: StateLike): void {
  const me = st.voids[0]!;
  const counts: Record<string, number> = {};
  for (const k in propMeshes) counts[k] = 0;
  for (const p of st.props) {
    const im = propMeshes[p.k];
    if (!im || counts[p.k]! >= im.instanceMatrix.count) continue;
    const i = counts[p.k]!;
    counts[p.k] = i + 1;
    const bob = p.k === "gem" ? Math.sin(time * 2.4 + p.id) * 0.18 + 0.9 : p.k === "ember" ? 0.55 + Math.sin(time * 6 + p.id) * 0.06 : 0.5;
    const spin = p.k === "gem" || p.k === "ember" ? time * 1.5 + p.id : p.id;
    m4.makeRotationY(spin);
    m4.setPosition(p.x, bob, p.y);
    im.setMatrixAt(i, m4);
    // Legal-target preview: edible props brighten; hazards stay menacing.
    const edible = p.k !== "ember" && p.m <= me.mass * 0.5;
    const pulse = 0.85 + 0.15 * Math.sin(time * 3 + p.id);
    im.setColorAt(i, tmpC.setScalar(edible ? pulse : 0.42));
  }
  for (const k in propMeshes) {
    const im = propMeshes[k]!;
    im.count = counts[k]!;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

/** Rules events → spark bursts and camera shake (event-tiered). */
export function playEvents(events: RulesEvent[], st: StateLike): void {
  for (const e of events) {
    if (e.t === "eat" || e.t === "eat_gem") {
      const v = st.voids[e.id!];
      if (v) emit(v.x, 0.6, v.y, e.t === "eat_gem" ? 0xffe066 : 0xcfe8b0, e.t === "eat_gem" ? 14 : 6, 1.6, 1.4);
    } else if (e.t === "eat_void") {
      const v = st.voids[e.id!];
      if (v) { emit(v.x, 1, v.y, 0xffffff, 30, 3, 2); kickShake(1.0); }
    } else if (e.t === "burn") {
      const v = st.voids[e.id!];
      if (v) { emit(v.x, 0.8, v.y, 0xff7a3c, 12, 2.2, 1.2); kickShake(0.5); }
    } else if (e.t === "goal") {
      const v = st.voids[0]!;
      emit(v.x, 1, v.y, 0xa0f2a0, 26, 2.6, 2.2);
    } else if (e.t === "end") kickShake(0.8);
  }
}

// -- particles ---------------------------------------------------------------------------
// Cosmetic randomness (Math.random) never touches the rules' seeded streams.
function emit(x: number, y: number, z: number, color: number, count: number, speed: number, life: number): void {
  const P = particles;
  if (!P || !look || particleBudget(look) === 0 || !moving()) return;
  const c = new Color(color);
  for (let i = 0; i < count; i++) {
    if (P.pool.length >= P.max) P.pool.shift();
    const a = Math.random() * PI * 2;
    P.pool.push({
      x, y, z, vx: Math.cos(a) * speed * (0.4 + Math.random()), vy: 1.5 + Math.random() * speed, vz: Math.sin(a) * speed * (0.4 + Math.random()),
      life: life * (0.6 + Math.random() * 0.6), age: 0, r: c.r, g: c.g, b: c.b,
    });
  }
}
function updateParticles(dt: number): void {
  const P = particles;
  if (!P) return;
  const posA = P.points.geometry.getAttribute("position") as BufferAttribute, colA = P.points.geometry.getAttribute("color") as BufferAttribute;
  const pos = posA.array as Float32Array, col = colA.array as Float32Array;
  let n = 0;
  for (let i = P.pool.length - 1; i >= 0; i--) {
    const p = P.pool[i]!;
    p.age += dt;
    if (p.age >= p.life) { P.pool.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vy -= 4 * dt;
    const fade = 1 - p.age / p.life;
    pos[n * 3] = p.x; pos[n * 3 + 1] = p.y; pos[n * 3 + 2] = p.z;
    col[n * 3] = p.r * fade; col[n * 3 + 1] = p.g * fade; col[n * 3 + 2] = p.b * fade;
    n++;
  }
  P.points.geometry.setDrawRange(0, n);
  posA.needsUpdate = true;
  colA.needsUpdate = true;
}

// -- markers (the tutorial's visit rings) --------------------------------------------------
export function setMarkers(list: { x: number; y: number }[]): void {
  if (list.length === markers.length && list.every((m, i) => m.x === markers[i]!.x && m.y === markers[i]!.y)) return;
  for (const m of markers) { root.remove(m.mesh); disposeTree(m.mesh); }
  markers = [];
  for (const { x, y } of list) {
    const mesh = new Mesh(new RingGeometry(1.6, 2.1, 40), new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: DoubleSide }));
    mesh.rotation.x = -PI / 2;
    mesh.position.set(x, 0.08, y);
    root.add(mesh);
    markers.push({ mesh, x, y });
  }
}

// -- camera --------------------------------------------------------------------------------
const camTarget = new Vector3();
const camVel = new Vector3();
let camHalf = 40;
let camDist = 60;
let shake = 0;
let viewW = 1, viewH = 1;

/** src/render.js frameCamera: the distance for the arena; `snap` recentres on the player. */
export function frameCamera(half: number, snap = false): void {
  camHalf = half;
  camDist = Math.max(CAM.minDist, half * CAM.distPerHalf);
  if (snap) {
    const me = state?.voids?.[0];
    if (me && me.alive) camTarget.set(me.x, 0, me.y); else camTarget.set(0, 0, 0);
    camVel.set(0, 0, 0);
    positionCamera();
  }
}
/** Ground-plane half extents visible from the camera (world units). */
function visibleHalfExtents(): { halfW: number; halfH: number } {
  const tanV = Math.tan((CAM.fov / 2) * PI / 180);
  const tilt = CAM.tiltDeg * PI / 180;
  return { halfW: camDist * tanV * (camera.aspect || 1), halfH: camDist * tanV / Math.sin(tilt) };
}
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
function followPlayer(st: StateLike, dtIn: number): void {
  const me = st.voids[0]!;
  // Follow strength grows as the view covers less of the arena (narrow portrait windows).
  const { halfW, halfH } = visibleHalfExtents();
  const cover = Math.min(halfW, halfH) / camHalf;
  const follow = clamp(1 - cover * (1 - CAM.follow), CAM.follow, 1);
  let fx = me.alive ? me.x * follow : 0;
  let fy = me.alive ? me.y * follow : 0;
  if (me.alive) {
    // Hard margin: keep the player inside the inner part of the view.
    const mx = halfW * 0.5, my = halfH * 0.45;
    fx = clamp(fx, me.x - mx, me.x + mx);
    fy = clamp(fy, me.y - my, me.y + my);
  }
  // A critically damped spring toward the follow point.
  const dt = Math.min(0.05, dtIn || 1 / 60);
  camVel.x += ((fx - camTarget.x) * CAM.springK - camVel.x * CAM.springC) * dt;
  camVel.z += ((fy - camTarget.z) * CAM.springK - camVel.z * CAM.springC) * dt;
  camTarget.x += camVel.x * dt;
  camTarget.z += camVel.z * dt;
}
function positionCamera(): void {
  const tilt = CAM.tiltDeg * PI / 180;
  let sx = 0, sz = 0;
  if (shake > 0.001 && !reducedMotion) {
    sx = (Math.random() - 0.5) * CAM.shakeAmp * shake;
    sz = (Math.random() - 0.5) * CAM.shakeAmp * shake;
  }
  camera.position.set(camTarget.x + sx, Math.sin(tilt) * camDist, camTarget.z + Math.cos(tilt) * camDist + sz);
  camera.lookAt(camTarget.x + sx, 0, camTarget.z + sz);
}
function kickShake(amount: number): void { if (!reducedMotion) shake = Math.min(1.5, shake + amount); }

const pv = new Vector3();
/** Window pixel of a plaza point (x, y on the ground, z up), and whether it is in front of the camera. */
export function projectToScreen(x: number, y: number, z = 0): { x: number; y: number; visible: boolean } {
  pv.set(x, z, y).project(camera);
  return { x: (pv.x + 1) / 2 * viewW, y: (1 - pv.y) / 2 * viewH, visible: pv.z < 1 };
}

// -- look and options ----------------------------------------------------------------------
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const before = look;
  look = next;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 1.6, distanceExponent: 1.5, thickness: 2.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only emissive embers and gems, the player's ring and highlights bloom.
  renderer.bloom = next.bloom ? { strength: 0.5, radius: 0.4, threshold: 2.0, resolution: next.budget.bloomRes } : null;
  // src/render.js GradeShader (after tone mapping): a gentle S-curve, a touch more saturation,
  // cool shadows / warm highlights, the 0.28 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.1, saturation: 1.1,
    shadows: [0.95, 0.99, 1.05], highlights: [1.04, 1.0, 0.95], split: [0.15, 0.75],
    vignette: { amount: 0.28, inner: 0.38, outer: 0.9, scale: [1.1, 1] },
  } : null;
  renderer.antialias = next.antialias;
  const b = before?.budget;
  const assets = !b || before!.detailed !== next.detailed || before!.particles !== next.particles || b.material !== next.budget.material
    || b.ground !== next.budget.ground || b.segments !== next.budget.segments || b.motes !== next.budget.motes || b.sparks !== next.budget.sparks;
  if (assets) rebuild();
  else {
    applyLights();
    applyGlow();
    if (motes) motes.visible = next.atmosphere;
    for (const v of voidViews.values()) if (v.swirl) v.swirl.visible = next.atmosphere;
  }
}
export function setPalette(p: Palette): void {
  if (p === palette) return;
  palette = p;
  // Rival rims take the new palette: rebuild the void views.
  for (const v of voidViews.values()) { root.remove(v.group); disposeTree(v.group); }
  voidViews.clear();
  glowColors.length = 0;
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
/** Whether the plaza draws. */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

// -- the frame -----------------------------------------------------------------------------
/** Each rendered frame: the props, the voids, the ambient motion, the sparks and the camera. */
export function update(st: StateLike | null, events: RulesEvent[], dtIn: number, W: number, H: number): void {
  const dt = Math.min(0.25, Math.max(0, dtIn));
  if (W !== viewW || H !== viewH) {
    viewW = Math.max(1, W); viewH = Math.max(1, H);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
  }
  time += dt;
  if (look && look.atmosphere && moving()) {
    atmoTime += dt;
    for (const a of animated) a(atmoTime);
  }
  if (st) state = st;
  const cur = state;
  if (cur && stage) {
    syncProps(cur);
    for (const v of cur.voids) {
      let view = voidViews.get(v.id);
      if (!view) { view = makeVoidView(v); voidViews.set(v.id, view); }
      const r = v.r;
      view.group.position.set(v.x, r * 0.6, v.y);
      view.group.visible = v.alive;
      const sp = Math.hypot(v.vx, v.vy);
      const squash = 1 + Math.min(0.25, sp * 0.008);
      view.body.scale.set(r * squash, r * 0.72, r / squash);
      if (sp > 0.5) view.body.rotation.y = Math.atan2(v.vx, v.vy);
      view.ring.scale.setScalar(r);
      view.glow.scale.setScalar(r);
      if (view.blob) { view.blob.scale.setScalar(r); view.blob.position.y = 0.03 - r * 0.6; }
      if (view.swirl) {
        view.swirl.scale.setScalar(r);
        if (moving()) view.swirl.rotation.z = -time * (v.input.boost ? 2.4 : 0.9) - v.id;
      }
      const protecting = v.protectTicks > 0 && v.alive;
      view.ring.material.opacity = (v.id === 0 ? 0.95 : 0.7) * (protecting ? 0.5 + 0.5 * Math.sin(time * 10) : 1);
      // Boost trail.
      if (v.input.boost && v.alive && look && particleBudget(look) > 0 && moving()) {
        view.trailAcc++;
        if (view.trailAcc % 3 === 0) emit(v.x, 0.4, v.y, 0x9fd8ff, 1, 0.5, 1.2);
      }
    }
    for (const [id, view] of voidViews) if (!cur.voids[id]) { root.remove(view.group); disposeTree(view.group); voidViews.delete(id); }
    playEvents(events, cur);
    for (const m of markers) {
      m.mesh.rotation.z = time * 0.8;
      m.mesh.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
    }
    followPlayer(cur, dt);
  }
  updateParticles(dt);
  if (shake > 0.001) shake *= Math.exp(-CAM.shakeDecay * dt);
  positionCamera();
}
