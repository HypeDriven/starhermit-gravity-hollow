// Gravity Hollow — Three.js presentation layer. Consumes immutable rules
// snapshots + interpolation alpha; never mutates rules state. Semantic entity
// views, authored camera, pooled VFX, quality tiers, and explicit disposal.

import * as THREE from '../vendor/three.module.js';
import { THEMES } from './content.js';
import { radiusForMass } from './rules.js';

const TIERS = {
  low:    { dpr: 1.0, shadows: false, particles: 0,   envDetail: 0.3, aa: false },
  medium: { dpr: 1.5, shadows: true,  particles: 400, envDetail: 0.7, aa: true },
  high:   { dpr: 2.0, shadows: true,  particles: 1200, envDetail: 1.0, aa: true },
};

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
    this.three = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.18;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 400);
    this.camTarget = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.shake = 0;
    this.clock = new THREE.Clock();
    this.quality = 'medium';
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
    canvas.addEventListener('webglcontextrestored', () => { this.lostContext = false; this.rebuild(); this.onContextRestored?.(); });
  }

  // ------------------------------------------------------------- stage

  loadStage(stage, snapshot) {
    this.clearScene();
    this.stage = stage;
    this.theme = THEMES[stage.theme] ?? THEMES.verdant;
    const t = this.theme;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, 90, 260);

    // lighting: one dominant key, soft environment fill, contact grounding
    const hemi = new THREE.HemisphereLight(t.fill, t.ground, 2.1);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(t.fill, 0.5);
    this.scene.add(amb);
    const key = new THREE.DirectionalLight(t.key, 2.6);
    key.position.set(30, 55, 18);
    key.castShadow = TIERS[this.quality].shadows;
    key.shadow.mapSize.set(1024, 1024);
    const ext = stage.arenaHalf + 12;
    Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 5, far: 140 });
    this.scene.add(key);
    this.keyLight = key;

    this.buildGround(stage);
    this.buildObstacles(stage);
    this.buildPropMeshes(stage);
    this.buildParticles();
    this.voidViews.clear();
    if (snapshot) this.syncSnapshot(snapshot, snapshot, 0, []);
    this.frameCamera(stage.arenaHalf, true);
  }

  buildGround(stage) {
    const half = stage.arenaHalf;
    const tex = groundTexture(this.theme, stage.arenaHalf);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 });
    const geo = new THREE.PlaneGeometry(half * 2 + 8, half * 2 + 8);
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    // plaza rim
    const rimMat = new THREE.MeshStandardMaterial({ color: this.theme.obstacle, roughness: 0.8 });
    const rimGeo = new THREE.BoxGeometry(half * 2 + 8, 1.6, 1.2);
    for (const [x, y, rot] of [[0, -half - 4.6, 0], [0, half + 4.6, 0], [-half - 4.6, 0, Math.PI / 2], [half + 4.6, 0, Math.PI / 2]]) {
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(x, 0.8, y);
      rim.rotation.y = rot;
      rim.castShadow = rim.receiveShadow = true;
      this.scene.add(rim);
    }
  }

  buildObstacles(stage) {
    const detail = TIERS[this.quality].envDetail;
    for (const o of stage.obstacles) {
      let mesh;
      if (o.kind === 'fountain') {
        const g = new THREE.CylinderGeometry(o.hw, o.hw * 1.1, 1.6, 24);
        mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: this.theme.obstacleTop, roughness: 0.5, metalness: 0.15 }));
        const water = new THREE.Mesh(
          new THREE.CylinderGeometry(o.hw * 0.78, o.hw * 0.78, 0.3, 24),
          new THREE.MeshStandardMaterial({ color: this.theme.accent, roughness: 0.15, metalness: 0.4, emissive: this.theme.accent, emissiveIntensity: 0.25 }));
        water.position.set(o.x, 1.05, o.y);
        this.scene.add(water);
      } else if (o.kind === 'planter' && detail > 0.4) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 1.2, o.hh * 2),
          new THREE.MeshStandardMaterial({ color: this.theme.obstacle, roughness: 0.9 }));
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.min(o.hw, o.hh) * 0.9, 1),
          new THREE.MeshStandardMaterial({ color: this.theme.fill, roughness: 1 }));
        bush.position.set(o.x, 1.6, o.y);
        bush.castShadow = true;
        this.scene.add(bush);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 2.2, o.hh * 2),
          new THREE.MeshStandardMaterial({ color: this.theme.obstacle, roughness: 0.85 }));
      }
      mesh.position.set(o.x, o.kind === 'arcade' ? 1.1 : 0.6, o.y);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildPropMeshes(stage) {
    const max = (stage.propTarget ?? 90) + 40;
    const defs = {
      crumb:   { geo: new THREE.IcosahedronGeometry(0.55, 0), rough: 0.6 },
      chunk:   { geo: new THREE.IcosahedronGeometry(0.95, 0), rough: 0.55 },
      boulder: { geo: new THREE.DodecahedronGeometry(1.5, 0), rough: 0.7 },
      gem:     { geo: new THREE.OctahedronGeometry(1.05, 0), rough: 0.2 },
      ember:   { geo: new THREE.TetrahedronGeometry(1.0, 0), rough: 0.4 },
    };
    for (const [kind, d] of Object.entries(defs)) {
      const color = this.theme.propColors[kind] ?? 0xffffff;
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: d.rough, metalness: kind === 'gem' ? 0.6 : 0.05,
        emissive: kind === 'ember' ? color : (kind === 'gem' ? color : 0x000000),
        emissiveIntensity: kind === 'ember' ? 0.7 : kind === 'gem' ? 0.35 : 0,
      });
      const im = new THREE.InstancedMesh(d.geo, mat, max);
      im.count = 0;
      im.userData.max = max;
      im.castShadow = kind !== 'crumb';
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name = `props:${kind}`;
      this.scene.add(im);
      this.propMeshes[kind] = im;
    }
  }

  buildParticles() {
    const max = Math.max(64, TIERS[this.quality].particles);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    this.particles = { points: new THREE.Points(geo, mat), pool: [], max };
    this.particles.points.frustumCulled = false;
    this.particles.points.raycast = () => {}; // cosmetic particles never intercept raycasts
    this.scene.add(this.particles.points);
  }

  // ------------------------------------------------------------- voids

  makeVoidView(v) {
    const group = new THREE.Group();
    const isMe = v.id === 0;
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a12, roughness: 0.25, metalness: 0.1,
      clearcoat: 0.8, clearcoatRoughness: 0.3,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), bodyMat);
    body.scale.y = 0.72;
    body.castShadow = true;
    group.add(body);
    // rim: shape + color reinforce ownership (not bloom alone)
    const ringColor = isMe ? 0xffffff : hashColor(v.id, this.settings.palette);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.05, 1.22, 40),
      new THREE.MeshBasicMaterial({ color: ringColor, transparent: true, opacity: isMe ? 0.95 : 0.7, side: THREE.DoubleSide }));
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
    this.scene.add(group);
    return { group, body, ring, glow, trailAcc: 0 };
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
      const protecting = v.protectTicks > 0 && v.alive;
      view.ring.material.opacity = (v.id === 0 ? 0.95 : 0.7) * (protecting ? (0.5 + 0.5 * Math.sin(t * 10)) : 1);
      // boost trail
      if (v.input.boost && v.alive && TIERS[this.quality].particles > 0 && !this.settings.reducedMotion) {
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
      this.camTarget.set(0, 0, 0);
      this.positionCamera();
    }
  }

  followPlayer(state) {
    const me = state.voids[0];
    const fx = me.alive ? me.x * CAM.follow : 0;
    const fy = me.alive ? me.y * CAM.follow : 0;
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
    if (!P || TIERS[this.quality].particles === 0 || this.settings.reducedMotion) return;
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

  setQuality(tier) {
    if (!TIERS[tier]) tier = 'medium';
    this.quality = tier;
    const q = TIERS[tier];
    this.three.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.three.shadowMap.enabled = q.shadows;
    this.three.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.keyLight) this.keyLight.castShadow = q.shadows;
    if (this.stage) this.loadStage(this.stage, this.currSnapshot); // rebuild with tier detail
  }

  setReducedMotion(on) { this.settings.reducedMotion = on; }

  resize() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.three.setSize(w, h, false);
  }

  render() {
    if (this.disposed || this.lostContext) return;
    this.time += 1 / 60;
    this.three.render(this.scene, this.camera);
  }

  rebuild() { if (this.stage) this.loadStage(this.stage, this.currSnapshot); }

  clearScene() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.scene.clear();
    this.propMeshes = {};
    this.voidViews.clear();
    this.markers = [];
    this.particles = null;
  }

  dispose() {
    this.disposed = true;
    this.clearScene();
    this.three.dispose();
  }
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
