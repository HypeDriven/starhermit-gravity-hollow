// Gravity Hollow — Three.js presentation layer. Consumes immutable rules
// snapshots + interpolation alpha; never mutates rules state. Semantic entity
// views, authored camera, pooled VFX, graphics settings (gfx.js), an optional
// post-processing chain, adaptive resolution, and explicit disposal.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEMES } from './content.js';
import { detectPreset, resolve, describe, SHADOW_MAP, PARTICLE_BUDGET } from './gfx.js';

// Colour grade + vignette, applied after tone mapping (display-space in and out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      // gentle S-curve contrast, a touch more saturation, cool shadows / warm highlights
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.75, l));
      s = s * 0.98 + 0.012; // keep the darkest pavement legible
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Bloom works on linear HDR before tone mapping: the threshold sits above the
// brightest lit (non-emissive) surfaces, so only glow sources bloom.
const BLOOM_THRESHOLD = 2.0;

const isMobile = () => (typeof navigator !== 'undefined') &&
  (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 2 && matchMedia('(pointer: coarse)').matches));

// Framing constants (no magic offsets scattered through the code).
const CAM = {
  fov: 38, tiltDeg: 52, distPerHalf: 1.55, minDist: 46,
  follow: 0.22,          // how strongly the camera trails the player
  springK: 42, springC: 12, // critically damped-ish follow spring
  shakeAmp: 0.35, shakeDecay: 6,
};

export class Renderer {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    // Canvas MSAA is fixed at context creation: it follows the anti-aliasing
    // setting in force at start-up (post-chain AA modes apply live).
    const boot = resolve(settings.graphics, 'balanced');
    this.three = new THREE.WebGLRenderer({ canvas, antialias: boot.antialias !== 'off', powerPreference: 'high-performance' });
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.18;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gpu = gpuName(this.three);
    this.detected = detectPreset(this.gpu, { mobile: isMobile() });
    this.scene = new THREE.Scene();
    // image-based lighting: a neutral studio room gives PBR materials reflections
    try {
      const pmrem = new THREE.PMREMGenerator(this.three);
      this.envMap = pmrem.fromScene(new RoomEnvironment(this.three), 0.04).texture;
      pmrem.dispose();
    } catch { this.envMap = null; }
    this.size = [0, 0];
    this.pixelRatio = 0;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this.q = resolve(settings.graphics, this.detected);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 400);
    this.camTarget = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.shake = 0;
    this.clock = new THREE.Clock();
    this.disposed = false;
    this.stage = null;
    this.theme = THEMES.verdant;
    this.propMeshes = {};       // kind -> InstancedMesh
    this.voidViews = new Map(); // voidId -> view
    this.markers = [];
    this.particles = null;
    this.time = 0;
    this._tmpM = new THREE.Matrix4();
    this._tmpV = new THREE.Vector3();
    this._tmpC = new THREE.Color();
    this.prevSnapshot = null;
    this.currSnapshot = null;
    this.lostContext = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lostContext = true; this.onContextLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => { this.lostContext = false; this.postKey = null; this.rebuild(); this.onContextRestored?.(); });
    this.setGraphics(settings.graphics);
  }

  get detailed() { return this.q.detail === 'detailed'; }
  get moving() { return !this.settings.reducedMotion; }

  // ------------------------------------------------------------- stage

  loadStage(stage, snapshot) {
    this.clearScene();
    this.stage = stage;
    this.theme = THEMES[stage.theme] ?? THEMES.verdant;
    const t = this.theme;
    const detailed = this.detailed;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, 90, 260);
    this.scene.environment = detailed ? this.envMap : null;

    // lighting: one dominant key, soft environment fill, contact grounding
    const hemi = new THREE.HemisphereLight(t.fill, t.ground, detailed ? 2.0 : 2.1);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(t.fill, detailed ? 0.45 : 0.5);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(t.key, detailed ? 2.9 : 2.6);
    key.position.set(30, 55, 18);
    key.castShadow = SHADOW_MAP[this.q.shadows] > 0;
    const size = SHADOW_MAP[this.q.shadows] || 1024;
    key.shadow.mapSize.set(size, size);
    // frustum fitted tightly to the plaza + rim so every texel lands on play space
    const ext = stage.arenaHalf + 6;
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 20, far: 120 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.camera.updateProjectionMatrix();
    this.scene.add(key);
    this.keyLight = key;

    this.animated = []; // { update(t, dt) } — ambient motion, frozen under reduced motion
    this.buildGround(stage);
    this.buildObstacles(stage);
    this.buildPropMeshes(stage);
    this.buildParticles();
    this.buildAtmosphere(stage);
    this.voidViews.clear();
    if (snapshot) this.syncSnapshot(snapshot, snapshot, 0, []);
    this.applyGlow();
    this.frameCamera(stage.arenaHalf, true);
  }

  buildGround(stage) {
    const half = stage.arenaHalf;
    const detailed = this.detailed;
    const mat = detailed
      ? (() => {
        const { map, bump } = groundTextureDetailed(this.theme, half);
        return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.4, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.08 });
      })()
      : new THREE.MeshStandardMaterial({ map: groundTexture(this.theme, half), roughness: 0.95, metalness: 0.0 });
    const geo = new THREE.PlaneGeometry(half * 2 + 8, half * 2 + 8);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    // plaza rim
    const rimMat = new THREE.MeshStandardMaterial({ color: this.theme.obstacle, roughness: 0.8, envMapIntensity: 0.5 });
    const rimGeo = new THREE.BoxGeometry(half * 2 + 8, 1.6, 1.2);
    const stripMat = detailed ? new THREE.MeshStandardMaterial({
      color: this.theme.obstacleTop, emissive: this.theme.accent, emissiveIntensity: 0.22, roughness: 0.4 }) : null;
    const stripGeo = detailed ? new THREE.BoxGeometry(half * 2 + 8, 0.12, 0.22) : null;
    for (const [x, y, rot, sx, sy] of [[0, -half - 4.6, 0, 0, 1], [0, half + 4.6, 0, 0, -1], [-half - 4.6, 0, Math.PI / 2, 1, 0], [half + 4.6, 0, Math.PI / 2, -1, 0]]) {
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(x, 0.8, y);
      rim.rotation.y = rot;
      rim.castShadow = rim.receiveShadow = true;
      this.scene.add(rim);
      if (stripMat) {
        // a soft accent light strip on the inner lip marks the playable edge
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(x + sx * 0.5, 1.62, y + sy * 0.5);
        strip.rotation.y = rot;
        this.scene.add(strip);
      }
    }
  }

  buildObstacles(stage) {
    const detailed = this.detailed;
    const t = this.theme;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.6, ...o });
    for (const o of stage.obstacles) {
      let mesh;
      if (o.kind === 'fountain') {
        const g = new THREE.CylinderGeometry(o.hw, o.hw * 1.1, 1.6, detailed ? 48 : 24);
        mesh = new THREE.Mesh(g, std({ color: t.obstacleTop, roughness: 0.5, metalness: 0.15 }));
        const waterMat = detailed
          ? new THREE.MeshPhysicalMaterial({ color: t.accent, roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05,
            emissive: t.accent, emissiveIntensity: 0.3, envMapIntensity: 1.3 })
          : new THREE.MeshStandardMaterial({ color: t.accent, roughness: 0.15, metalness: 0.4, emissive: t.accent, emissiveIntensity: 0.25 });
        const water = new THREE.Mesh(new THREE.CylinderGeometry(o.hw * 0.78, o.hw * 0.78, 0.3, detailed ? 48 : 24), waterMat);
        water.position.set(o.x, 1.05, o.y);
        this.scene.add(water);
        if (detailed) {
          // stone lip + central spout column
          const lip = new THREE.Mesh(new THREE.TorusGeometry(o.hw * 0.92, 0.22, 10, 48), std({ color: t.obstacleTop, roughness: 0.45 }));
          lip.rotation.x = Math.PI / 2;
          lip.position.set(o.x, 1.42, o.y);
          lip.castShadow = true;
          this.scene.add(lip);
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 2.4, 16), std({ color: t.obstacleTop, roughness: 0.4 }));
          col.position.set(o.x, 2.1, o.y);
          col.castShadow = true;
          this.scene.add(col);
          const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.4, 0.45, 20), std({ color: t.obstacleTop, roughness: 0.4 }));
          bowl.position.set(o.x, 3.3, o.y);
          bowl.castShadow = true;
          this.scene.add(bowl);
          // water shimmer: emissive breathing, only with atmosphere on and motion allowed
          this.animated.push({ atmo: true, update: (time) => { waterMat.emissiveIntensity = 0.28 + 0.1 * Math.sin(time * 1.7) + 0.05 * Math.sin(time * 4.3); } });
        }
      } else if (o.kind === 'planter' && detailed) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 1.2, o.hh * 2), std({ color: t.obstacle, roughness: 0.9 }));
        // hedge: a cluster of leafy mounds rather than one blob
        const leaf = std({ color: t.fill, roughness: 1, flatShading: true, envMapIntensity: 0.3 });
        const rMin = Math.min(o.hw, o.hh);
        const along = o.hw >= o.hh ? 'x' : 'z';
        const len = Math.max(o.hw, o.hh);
        const n = Math.max(1, Math.round(len / (rMin * 0.9)));
        for (let i = 0; i < n; i++) {
          const u = n === 1 ? 0 : (i / (n - 1) - 0.5) * (len * 2 - rMin * 1.6);
          const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(rMin * (0.8 + 0.12 * ((i * 7) % 3)), 1), leaf);
          bush.position.set(o.x + (along === 'x' ? u : 0), 1.55, o.y + (along === 'z' ? u : 0));
          bush.scale.y = 0.85;
          bush.castShadow = bush.receiveShadow = true;
          this.scene.add(bush);
        }
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 2.2, o.hh * 2), std({ color: t.obstacle }));
        if (detailed && o.kind !== 'planter') {
          // cap slab with a slight overhang reads as masonry
          const cap = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2 + 0.3, 0.25, o.hh * 2 + 0.3), std({ color: t.obstacleTop, roughness: 0.6 }));
          cap.position.set(o.x, 2.33, o.y);
          cap.castShadow = cap.receiveShadow = true;
          this.scene.add(cap);
        }
      }
      mesh.position.set(o.x, o.kind === 'arcade' ? 1.1 : 0.6, o.y);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildPropMeshes(stage) {
    const max = (stage.propTarget ?? 90) + 40;
    const detailed = this.detailed;
    const defs = {
      crumb:   { geo: new THREE.IcosahedronGeometry(0.55, 0), rough: 0.6 },
      chunk:   { geo: new THREE.IcosahedronGeometry(0.95, 0), rough: 0.55 },
      boulder: { geo: new THREE.DodecahedronGeometry(1.5, 0), rough: 0.7 },
      gem:     { geo: new THREE.OctahedronGeometry(1.05, 0), rough: 0.2 },
      ember:   { geo: new THREE.TetrahedronGeometry(1.0, 0), rough: 0.4 },
    };
    for (const [kind, d] of Object.entries(defs)) {
      const color = this.theme.propColors[kind] ?? 0xffffff;
      let mat;
      if (!detailed) {
        mat = new THREE.MeshStandardMaterial({
          color, roughness: d.rough, metalness: kind === 'gem' ? 0.6 : 0.05,
          emissive: kind === 'ember' ? color : (kind === 'gem' ? color : 0x000000),
          emissiveIntensity: kind === 'ember' ? 0.7 : kind === 'gem' ? 0.35 : 0,
        });
      } else if (kind === 'gem') {
        // cut-glass gem: clear-coated, env reflections, emissive core that blooms
        mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04,
          emissive: color, emissiveIntensity: 0.45, envMapIntensity: 1.1, flatShading: true });
        mat.userData.glow = [0.45, 0.8];
      } else if (kind === 'ember') {
        // hot core: emissive above 1 so bloom picks embers out as the hazard
        mat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, emissive: color, emissiveIntensity: 1.5, flatShading: true, envMapIntensity: 0.4 });
        mat.userData.glow = [1.5, 3.5];
      } else {
        mat = new THREE.MeshPhysicalMaterial({ color, roughness: d.rough, metalness: 0.02, clearcoat: 0.2, clearcoatRoughness: 0.5,
          flatShading: true, envMapIntensity: 0.4 });
      }
      const im = new THREE.InstancedMesh(d.geo, mat, max);
      im.count = 0;
      im.userData.max = max;
      im.castShadow = kind !== 'crumb';
      im.receiveShadow = detailed;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name = `props:${kind}`;
      this.scene.add(im);
      this.propMeshes[kind] = im;
    }
  }

  buildParticles() {
    const max = Math.max(64, PARTICLE_BUDGET[this.q.particles]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const soft = this.detailed;
    const mat = new THREE.PointsMaterial({
      size: soft ? 0.8 : 0.55, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false,
      map: soft ? softDot() : null, blending: soft ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.particles = { points: new THREE.Points(geo, mat), pool: [], max };
    this.particles.points.frustumCulled = false;
    this.particles.points.raycast = () => {}; // cosmetic particles never intercept raycasts
    this.scene.add(this.particles.points);
  }

  // Drifting motes of light over the plaza (atmosphere). One Points draw.
  buildAtmosphere(stage) {
    const half = stage.arenaHalf + 4;
    const n = 180;
    const pos = new Float32Array(n * 3);
    const seed = [];
    let s = 1 + this.theme.id.length * 131;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      seed.push({ x: (rnd() * 2 - 1) * half, z: (rnd() * 2 - 1) * half, y: 0.6 + rnd() * 7, ph: rnd() * 6.28, sp: 0.25 + rnd() * 0.5 });
      pos[i * 3] = seed[i].x; pos[i * 3 + 1] = seed[i].y; pos[i * 3 + 2] = seed[i].z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.45, color: this.theme.accent, map: softDot(), transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.raycast = () => {};
    pts.name = 'atmosphere:motes';
    this.scene.add(pts);
    this.motes = pts;
    this.animated.push({ atmo: true, update: (time) => {
      for (let i = 0; i < n; i++) {
        const m = seed[i];
        pos[i * 3] = m.x + Math.sin(time * 0.3 * m.sp + m.ph) * 1.6;
        pos[i * 3 + 1] = 0.6 + ((m.y + time * m.sp * 0.6) % 7.4);
        pos[i * 3 + 2] = m.z + Math.cos(time * 0.25 * m.sp + m.ph) * 1.6;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.45 + 0.1 * Math.sin(time * 0.8);
    } });
    this.applyAtmosphere();
  }

  // With bloom on, glow sources (embers, gems, the player's ring) run hotter than
  // lit surfaces so the HDR threshold picks out only them.
  applyGlow() {
    const hot = this.q.bloom === 'on' && !this.postFailed ? 1 : 0;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      if (m.userData.glow) m.emissiveIntensity = m.userData.glow[hot];
      if (m.userData.glowColor) m.color.setScalar(m.userData.glowColor[hot]);
    });
  }

  applyAtmosphere() {
    const on = this.q.atmosphere === 'on';
    if (this.motes) this.motes.visible = on;
    for (const v of this.voidViews.values()) if (v.swirl) v.swirl.visible = on;
  }

  // ------------------------------------------------------------- voids

  makeVoidView(v) {
    const group = new THREE.Group();
    const isMe = v.id === 0;
    const detailed = this.detailed;
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a12, roughness: detailed ? 0.18 : 0.25, metalness: 0.1,
      clearcoat: detailed ? 1 : 0.8, clearcoatRoughness: detailed ? 0.12 : 0.3, envMapIntensity: 0.3,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, detailed ? 40 : 28, detailed ? 28 : 20), bodyMat);
    body.scale.y = 0.72;
    body.castShadow = true;
    group.add(body);
    // rim: shape + color reinforce ownership (not bloom alone)
    const ringColor = isMe ? 0xffffff : hashColor(v.id, this.settings.palette);
    const ringMat = new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: isMe ? 0.95 : 0.7, side: THREE.DoubleSide });
    // the player's ring renders un-tone-mapped so it stays pure white and gets a bloom halo
    if (isMe && detailed) { ringMat.toneMapped = false; ringMat.userData.glowColor = [1, 2.4]; }
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 48), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
    // inner glow disc (the "hollow")
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.72, 28),
      new THREE.MeshBasicMaterial({ color: isMe ? 0x2a2a44 : new THREE.Color(ringColor).multiplyScalar(0.25), transparent: true, opacity: 0.9 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    group.add(glow);
    let swirl = null, blob = null;
    if (detailed) {
      // contact shadow: soft dark pool that grounds the hollow even without shadow maps
      blob = new THREE.Mesh(new THREE.CircleGeometry(1.7, 32),
        new THREE.MeshBasicMaterial({ map: softDot(0, 0.75), color: 0x000000, transparent: true, depthWrite: false }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.03;
      blob.renderOrder = -1;
      group.add(blob);
      // accretion swirl: a faint spiral of pulled-in dust circling the rim
      swirl = new THREE.Mesh(new THREE.RingGeometry(1.15, 2.0, 48, 1),
        new THREE.MeshBasicMaterial({ map: swirlTexture(), color: ringColor, transparent: true, opacity: isMe ? 0.32 : 0.26,
          depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      swirl.rotation.x = -Math.PI / 2;
      swirl.position.y = 0.09;
      swirl.visible = this.q.atmosphere === 'on';
      group.add(swirl);
    }
    this.scene.add(group);
    if (ringMat.userData.glowColor) ringMat.color.setScalar(ringMat.userData.glowColor[this.q.bloom === 'on' && !this.postFailed ? 1 : 0]);
    return { group, body, ring, glow, swirl, blob, trailAcc: 0 };
  }

  // ---------------------------------------------------------- snapshot

  // prev/curr are rules states; alpha in [0,1] interpolates between them.
  syncSnapshot(prev, curr, alpha, events) {
    if (!this.stage) return;
    this.currSnapshot = curr;
    const t = this.time;

    // props: write instance transforms (edibility tint via instance color).
    // Props are static in the sim, so no interpolation is needed for them.
    const me = curr.voids[0];
    const counts = {};
    for (const kind in this.propMeshes) counts[kind] = 0;
    for (const p of curr.props) {
      const im = this.propMeshes[p.k];
      if (!im || counts[p.k] >= im.userData.max) continue;
      const i = counts[p.k]++;
      const bob = p.k === 'gem' ? Math.sin(t * 2.4 + p.id) * 0.18 + 0.9 : (p.k === 'ember' ? 0.55 + Math.sin(t * 6 + p.id) * 0.06 : 0.5);
      const spin = p.k === 'gem' || p.k === 'ember' ? t * 1.5 + p.id : p.id;
      this._tmpM.makeRotationY(spin);
      this._tmpM.setPosition(p.x, bob, p.y);
      im.setMatrixAt(i, this._tmpM);
      // legal-target preview: edible props brighten; hazards stay menacing
      const edible = p.k !== 'ember' && p.m <= me.mass * 0.5;
      const pulse = 0.85 + 0.15 * Math.sin(t * 3 + p.id);
      im.setColorAt(i, this._tmpC.setScalar(edible ? pulse : 0.42));
    }
    for (const kind in this.propMeshes) {
      const im = this.propMeshes[kind];
      im.count = counts[kind];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }

    // voids
    for (const v of curr.voids) {
      let view = this.voidViews.get(v.id);
      if (!view) { view = this.makeVoidView(v); this.voidViews.set(v.id, view); }
      const pv = prev.voids[v.id] ?? v;
      const x = pv.x + (v.x - pv.x) * alpha;
      const y = pv.y + (v.y - pv.y) * alpha;
      const r = v.r;
      view.group.position.set(x, r * 0.6, y);
      view.group.visible = v.alive;
      const squash = 1 + Math.min(0.25, Math.hypot(v.vx, v.vy) * 0.008);
      view.body.scale.set(r * squash, r * 0.72, r / squash);
      if (Math.hypot(v.vx, v.vy) > 0.5) view.body.rotation.y = Math.atan2(v.vx, v.vy);
      view.ring.scale.setScalar(r);
      view.glow.scale.setScalar(r);
      if (view.blob) { view.blob.scale.setScalar(r); view.blob.position.y = 0.03 - r * 0.6; }
      if (view.swirl) {
        view.swirl.scale.setScalar(r);
        if (this.moving) view.swirl.rotation.z = -t * (v.input.boost ? 2.4 : 0.9) - v.id;
      }
      const protecting = v.protectTicks > 0 && v.alive;
      view.ring.material.opacity = (v.id === 0 ? 0.95 : 0.7) * (protecting ? (0.5 + 0.5 * Math.sin(t * 10)) : 1);
      // boost trail
      if (v.input.boost && v.alive && PARTICLE_BUDGET[this.q.particles] > 0 && this.moving) {
        view.trailAcc++;
        if (view.trailAcc % 3 === 0) this.emit(x, 0.4, y, 0x9fd8ff, 1, 0.5, 1.2);
      }
    }

    // events → VFX + camera shake (event-tiered)
    for (const e of events ?? []) {
      if (e.t === 'eat' || e.t === 'eat_gem') {
        const v = curr.voids[e.id];
        if (v) this.emit(v.x, 0.6, v.y, e.t === 'eat_gem' ? 0xffe066 : 0xcfe8b0, e.t === 'eat_gem' ? 14 : 6, 1.6, 1.4);
      } else if (e.t === 'eat_void') {
        const v = curr.voids[e.id];
        if (v) { this.emit(v.x, 1, v.y, 0xffffff, 30, 3, 2); this.kickShake(1.0); }
      } else if (e.t === 'burn') {
        const v = curr.voids[e.id];
        if (v) { this.emit(v.x, 0.8, v.y, 0xff7a3c, 12, 2.2, 1.2); this.kickShake(0.5); }
      } else if (e.t === 'goal') {
        const v = curr.voids[0];
        this.emit(v.x, 1, v.y, 0xa0f2a0, 26, 2.6, 2.2);
      } else if (e.t === 'end') {
        this.kickShake(0.8);
      }
    }

    // markers (tutorial visit rings)
    for (const m of this.markers) {
      m.mesh.rotation.z = t * 0.8;
      const s = 1 + Math.sin(t * 3) * 0.08;
      m.mesh.scale.setScalar(s);
    }

    this.updateParticles(1 / 60);
    this.followPlayer(curr, alpha);
  }

  // ------------------------------------------------------------ camera

  frameCamera(half, snap = false) {
    this.camHalf = half;
    const dist = Math.max(CAM.minDist, half * CAM.distPerHalf);
    this.camDist = dist;
    if (snap) {
      // Reset recentres on the player (falls back to the arena centre).
      const me = this.currSnapshot?.voids?.[0];
      if (me && me.alive) this.camTarget.set(me.x, 0, me.y); else this.camTarget.set(0, 0, 0);
      this.camVel.set(0, 0, 0);
      this.positionCamera();
    }
  }

  // Ground-plane half extents visible from the current camera (world units).
  visibleHalfExtents() {
    const d = this.camDist ?? 60;
    const tanV = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
    const tilt = THREE.MathUtils.degToRad(CAM.tiltDeg);
    const halfW = d * tanV * (this.camera.aspect || 1);
    const halfH = d * tanV / Math.sin(tilt);
    return { halfW, halfH };
  }

  followPlayer(state) {
    const me = state.voids[0];
    // Follow strength grows as the view covers less of the arena (narrow
    // portrait viewports), so the player is never framed out.
    const half = this.camHalf ?? 40;
    const { halfW, halfH } = this.visibleHalfExtents();
    const cover = Math.min(halfW, halfH) / half;
    const follow = THREE.MathUtils.clamp(1 - cover * (1 - CAM.follow), CAM.follow, 1);
    let fx = me.alive ? me.x * follow : 0;
    let fy = me.alive ? me.y * follow : 0;
    if (me.alive) {
      // hard margin: keep the player inside the inner 65% of the view
      const mx = halfW * 0.5, my = halfH * 0.45;
      fx = THREE.MathUtils.clamp(fx, me.x - mx, me.x + mx);
      fy = THREE.MathUtils.clamp(fy, me.y - my, me.y + my);
    }
    // critically damped spring toward the follow point — never cumulative lerp
    const dt = Math.min(0.05, this.clock.getDelta() || 1 / 60);
    const k = CAM.springK, c = CAM.springC;
    this.camVel.x += ((fx - this.camTarget.x) * k - this.camVel.x * c) * dt;
    this.camVel.z += ((fy - this.camTarget.z) * k - this.camVel.z * c) * dt;
    this.camTarget.x += this.camVel.x * dt;
    this.camTarget.z += this.camVel.z * dt;
    this.positionCamera();
  }

  positionCamera() {
    const tilt = THREE.MathUtils.degToRad(CAM.tiltDeg);
    const d = this.camDist ?? 60;
    let sx = 0, sz = 0;
    if (this.shake > 0.001 && !this.settings.reducedMotion) {
      sx = (Math.random() - 0.5) * CAM.shakeAmp * this.shake;
      sz = (Math.random() - 0.5) * CAM.shakeAmp * this.shake;
      this.shake *= Math.exp(-CAM.shakeDecay / 60);
    }
    this.camera.position.set(
      this.camTarget.x + sx,
      Math.sin(tilt) * d,
      this.camTarget.z + Math.cos(tilt) * d + sz);
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);
  }

  kickShake(amount) { if (!this.settings.reducedMotion) this.shake = Math.min(1.5, this.shake + amount); }

  // ------------------------------------------------------------ particles

  emit(x, y, z, color, count, speed, life) {
    const P = this.particles;
    if (!P || PARTICLE_BUDGET[this.q.particles] === 0 || !this.moving) return;
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      if (P.pool.length >= P.max) P.pool.shift();
      const a = Math.random() * Math.PI * 2;
      P.pool.push({
        x, y, z,
        vx: Math.cos(a) * speed * (0.4 + Math.random()), vy: 1.5 + Math.random() * speed, vz: Math.sin(a) * speed * (0.4 + Math.random()),
        life: life * (0.6 + Math.random() * 0.6), age: 0,
        r: c.r, g: c.g, b: c.b,
      });
    }
  }

  updateParticles(dt) {
    const P = this.particles;
    if (!P) return;
    const pos = P.points.geometry.attributes.position.array;
    const col = P.points.geometry.attributes.color.array;
    let n = 0;
    for (let i = P.pool.length - 1; i >= 0; i--) {
      const p = P.pool[i];
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
    P.points.geometry.attributes.position.needsUpdate = true;
    P.points.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------ markers

  setMarkers(list) {
    for (const m of this.markers) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); }
    this.markers = [];
    for (const { x, y } of list) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2.1, 40),
        new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.08, y);
      this.scene.add(mesh);
      this.markers.push({ mesh, x, y });
    }
  }

  // ------------------------------------------------------------ plumbing

  screenToArena(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
  }

  projectToScreen(x, y, z = 0) {
    const rect = this.canvas.getBoundingClientRect();
    this._tmpV.set(x, z, y).project(this.camera);
    return {
      x: rect.left + (this._tmpV.x + 1) / 2 * rect.width,
      y: rect.top + (1 - this._tmpV.y) / 2 * rect.height,
      visible: this._tmpV.z < 1,
    };
  }

  // ---------------------------------------------------------- graphics settings

  /** Apply graphics settings (gfx.js shape) live: shadows, post chain, scale, detail. */
  setGraphics(saved) {
    const prev = this.q;
    const g = resolve(saved, this.detected);
    this.q = g;
    const size = SHADOW_MAP[g.shadows];
    const shadowsChanged = this.three.shadowMap.enabled !== size > 0;
    this.three.shadowMap.enabled = size > 0;
    if (this.keyLight) {
      this.keyLight.castShadow = size > 0;
      if (size > 0 && this.keyLight.shadow.mapSize.x !== size) {
        this.keyLight.shadow.mapSize.set(size, size);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
      }
    }
    // Materials compile shadow sampling in or out: recompile on toggle.
    if (shadowsChanged) this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    const rebuildStage = prev && (prev.detail !== g.detail || prev.particles !== g.particles);
    if (rebuildStage && this.stage) this.loadStage(this.stage, this.currSnapshot);
    this.applyAtmosphere();
    this.applyGlow();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.fpsVisible(g.showFps);
    for (const el of [this.canvas, document.body]) {
      el.dataset.gfxPreset = g.preset;
      el.dataset.gfxPost = g.post ? 'on' : 'off';
    }
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, pixel size and frame rate. */
  graphicsInfo(words) {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, words),
      pixels: px,
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
      postActive: !!this.composer,
    };
  }

  fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '— fps';
      document.getElementById('app')?.append(el);
    }
    if (el) el.hidden = !on;
  }

  postKeyFor(w, h) {
    const g = this.q;
    return g.post ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  buildPost(w, h) {
    const g = this.q;
    this.composer?.dispose();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    try {
      const pr = this.pixelRatio;
      const target = new THREE.WebGLRenderTarget(Math.max(1, w * pr), Math.max(1, h * pr), {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.three, target);
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      // High threshold: only emissive embers/gems, the player's ring and highlights bloom.
      if (g.bloom === 'on') composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, BLOOM_THRESHOLD));
      composer.addPass(new OutputPass()); // tone mapping + sRGB
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(w * pr, h * pr));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly and let the panel say so.
      this.postFailed = true;
      this.composer = null;
      this.applyGlow();
      this.onPostFailed?.();
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  adapt(dt) {
    const f = this._frames;
    f.push(dt);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  setReducedMotion(on) { this.settings.reducedMotion = on; }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = [0, 0]; // re-sized on the next render
  }

  render() {
    if (this.disposed || this.lostContext) return;
    const now = performance.now();
    const dt = this._last ? Math.min(250, now - this._last) : 16;
    this._last = now;
    this.time += 1 / 60;
    if (this.moving && this.q.atmosphere === 'on') {
      this.atmoTime = (this.atmoTime ?? 0) + dt / 1000;
      for (const a of this.animated ?? []) a.update(this.atmoTime, dt / 1000);
    }
    const rescale = this.adapt(dt);
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * this.q.scale * this.adaptiveScale;
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio || rescale) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.three.setPixelRatio(ratio);
      this.three.setSize(w, h, false);
    }
    const key = this.postKeyFor(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this.buildPost(w, h);
    }
    if (this.composer) this.composer.render(dt / 1000);
    else this.three.render(this.scene, this.camera);
  }

  rebuild() { if (this.stage) this.loadStage(this.stage, this.currSnapshot); }

  clearScene() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          m.map?.dispose();
          m.bumpMap?.dispose();
          m.dispose();
        }
      }
    });
    this.scene.clear();
    this.propMeshes = {};
    this.voidViews.clear();
    this.markers = [];
    this.particles = null;
    this.motes = null;
    this.animated = [];
  }

  dispose() {
    this.disposed = true;
    this.clearScene();
    this.composer?.dispose();
    this.envMap?.dispose();
    this.three.dispose();
  }
}

function gpuName(r) {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch { return ''; }
}

// soft round sprite (radial falloff) for particles, motes and contact shadows
function softDot(inner = 0.0, alpha = 1) {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.5 * inner, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.45})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// spiral dust streaks for the accretion swirl (mapped onto a RingGeometry's UVs)
function swirlTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.translate(S / 2, S / 2);
  ctx.lineCap = 'round';
  for (let arm = 0; arm < 5; arm++) {
    for (let i = 0; i < 26; i++) {
      const f = i / 26;
      const a = arm * (Math.PI * 2 / 5) + f * 2.4;
      const r = S * (0.28 + 0.2 * f);
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - f)).toFixed(3)})`;
      ctx.lineWidth = 2.6 * (1 - f) + 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, a, a + 0.12);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// deterministic per-void color, palette-aware (shape+label reinforce color)
function hashColor(id, palette = 'default') {
  const sets = {
    default:      [0xff6b6b, 0x4ecdc4, 0xffd166, 0xa78bfa, 0xf9844a, 0x90be6d, 0x43aa8b],
    deuteranopia: [0x0173b2, 0xde8f05, 0x029e73, 0xd55e00, 0xcc78bc, 0x56b4e9, 0xf0e442],
    protanopia:   [0x0173b2, 0xde8f05, 0x029e73, 0xca9161, 0xcc78bc, 0x56b4e9, 0xf0e442],
    tritanopia:   [0x0072b2, 0xe69f00, 0x009e73, 0xd55e00, 0xcc79a7, 0x56b4e9, 0xf0e442],
  };
  return (sets[palette] ?? sets.default)[id % 7];
}

// procedural pavement texture on a canvas — original, deterministic
function groundTexture(theme, half) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const c = new THREE.Color(theme.ground);
  ctx.fillStyle = `#${c.getHexString()}`;
  ctx.fillRect(0, 0, S, S);
  const line = new THREE.Color(theme.groundLine);
  ctx.strokeStyle = `#${line.getHexString()}`;
  ctx.lineWidth = 2;
  const cells = 10;
  const step = S / cells;
  // seeded wobble so tiles feel hand-laid but deterministic per theme
  let s = theme.id.length * 7919;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    for (let j = 0; j <= cells; j++) ctx.lineTo(j * step, i * step + (rnd() - 0.5) * 3);
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j <= cells; j++) ctx.lineTo(i * step + (rnd() - 0.5) * 3, j * step);
    ctx.stroke();
  }
  // subtle vignette tiles
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) if ((i + j) % 2 === 0) ctx.fillRect(i * step, j * step, step, step);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(Math.max(1, half / 22), Math.max(1, half / 22));
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Detailed pavement: per-slab tone variation, mortar joints, speckle grit and
// moss in the joints, plus a matching bump map (slabs raised, joints sunk).
function groundTextureDetailed(theme, half) {
  const S = 1024;
  const cells = 8;
  const step = S / cells;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return [c, c.getContext('2d')]; };
  const [cv, ctx] = mk();
  const [bv, btx] = mk();
  const base = new THREE.Color(theme.ground);
  const line = new THREE.Color(theme.groundLine);
  const moss = new THREE.Color(theme.fill);
  let s = theme.id.length * 7919 + 17;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const css = (c) => `#${c.getHexString()}`; // sRGB hex (Color stores linear)
  // mortar everywhere first
  ctx.fillStyle = css(base.clone().lerp(line, 0.3).multiplyScalar(0.55));
  ctx.fillRect(0, 0, S, S);
  btx.fillStyle = '#202020';
  btx.fillRect(0, 0, S, S);
  const gap = 5;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      // running-bond: every other row offsets half a slab
      const off = (j % 2) * step / 2;
      for (const dx of [0, -S]) {
        const x = i * step + off + dx, y = j * step;
        if (x + step < 0 || x > S) continue;
        const tone = 0.9 + rnd() * 0.14;
        const c = base.clone().multiplyScalar(tone).lerp(moss, rnd() * 0.04);
        const jx = (rnd() - 0.5) * 2, jy = (rnd() - 0.5) * 2;
        ctx.fillStyle = css(c);
        roundRect(ctx, x + gap + jx, y + gap + jy, step - gap * 2, step - gap * 2, 7);
        ctx.fill();
        const b = 150 + ((rnd() * 60) | 0);
        btx.fillStyle = `rgb(${b},${b},${b})`;
        roundRect(btx, x + gap + jx, y + gap + jy, step - gap * 2, step - gap * 2, 7);
        btx.fill();
        // bevel highlight on the top-left edge of each slab
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + gap + 6, y + step - gap - 4);
        ctx.lineTo(x + gap + 4, y + gap + 4);
        ctx.lineTo(x + step - gap - 6, y + gap + 4);
        ctx.stroke();
      }
    }
  }
  // grit speckles and wear
  for (let k = 0; k < 9000; k++) {
    const x = rnd() * S, y = rnd() * S, r = rnd() * 1.6 + 0.3;
    const light = rnd() < 0.5;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)';
    ctx.fillRect(x, y, r, r);
    btx.fillStyle = light ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    btx.fillRect(x, y, r, r);
  }
  // moss creeping along joints
  ctx.fillStyle = css(moss.clone().multiplyScalar(0.55));
  for (let k = 0; k < 700; k++) {
    const onRow = rnd() < 0.5;
    const a = Math.round(rnd() * cells) * step;
    const b = rnd() * S;
    const x = onRow ? b : a + ((Math.floor(b / step) % 2) * step / 2);
    const y = onRow ? a : b;
    ctx.globalAlpha = 0.25 + rnd() * 0.35;
    ctx.beginPath();
    ctx.arc(x % S, y % S, 1.5 + rnd() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const map = new THREE.CanvasTexture(cv);
  const bump = new THREE.CanvasTexture(bv);
  const rep = Math.max(1, half / 18);
  for (const t of [map, bump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4; }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
