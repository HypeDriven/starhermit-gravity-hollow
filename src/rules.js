// Gravity Hollow — pure deterministic rules engine.
// No rendering, no DOM, no Date.now(). All randomness flows through the seeded
// rules stream stored in state. Everything is JSON-serializable.
//
// Public API:
//   createMatch(config)            -> state
//   queryActions(state, voidId)    -> legal-action query (also used by hints/tutorial)
//   applyCommand(state, cmd)       -> { ok, reason? } validates + stores actor intent
//   step(state)                    -> advances one fixed tick, returns events
//   serialize(state) / deserialize(json)
//   hashState(state)               -> stable 32-bit hash (hex string)
//   isTerminal(state) / terminalReason(state)
//   rankings(state)                -> ordered placements with tie-breaks
//   scoreBreakdown(state, voidId)  -> per-component score explanation

import { RngStream, hashString } from './rng.js';

export const SCHEMA_VERSION = 1;
export const TICK_RATE = 30;            // fixed simulation step
export const DT = 1 / TICK_RATE;

export const PROP_KINDS = {
  crumb:   { mass: 1,  score: 1,  edible: true  },
  chunk:   { mass: 3,  score: 3,  edible: true  },
  boulder: { mass: 8,  score: 8,  edible: true  },
  gem:     { mass: 15, score: 15, edible: true, gem: true },
  ember:   { mass: 4,  score: 0,  edible: false, hazard: true },
};

const R_K = 0.55;             // radius = R_K * sqrt(mass)
const R_MIN = 1.6;
const R_MAX = 22;
const EAT_FRACTION = 0.5;     // can eat props with mass <= own mass * this
const VOID_EAT_RATIO = 1.25;  // must outweigh rival by this factor to consume
const VOID_EAT_GAIN = 0.5;    // fraction of victim mass gained
const RESPAWN_MASS_KEEP = 0.6;
const EMBER_SHRINK = 3;       // mass lost when touching an ember
const BOOST_SPEED = 1.6;
const BOOST_DRAIN = 0.25;     // mass per tick while boosting
const BOOST_MIN_MASS = 14;
const PROTECT_TICKS = TICK_RATE * 3;
const BASE_SPEED = 9.0;       // units/sec at start mass

export function radiusForMass(mass) {
  return Math.min(R_MAX, Math.max(R_MIN, R_K * Math.sqrt(Math.max(1, mass))));
}
export function speedForMass(mass, startMass) {
  const s = BASE_SPEED * Math.pow(startMass / Math.max(startMass, mass), 0.25);
  return Math.max(BASE_SPEED * 0.45, s);
}

// ---------------------------------------------------------------- creation

// config: {
//   seed, stageId, contentVersion, durationSec, arenaHalf, obstacles[],
//   rivals: [{name, skill}], startMass, propTarget, propWeights {kind:weight},
//   emberCount, goals: [{type,target}], countdownSec, boost: 'on'|'off'|'limited',
//   boostLimit, moveLimit (ticks of movement allowed, 0=none), theme
// }
export function createMatch(config) {
  const rng = new RngStream(config.seed >>> 0);
  const half = config.arenaHalf ?? 42;
  const obstacles = (config.obstacles ?? []).map(o => ({ ...o }));

  const state = {
    version: SCHEMA_VERSION,
    seed: config.seed >>> 0,
    stageId: config.stageId ?? 'adhoc',
    contentVersion: config.contentVersion ?? 1,
    tick: 0,
    phase: 'countdown',
    countdownTicks: Math.round((config.countdownSec ?? 3) * TICK_RATE),
    terminalReason: null,
    elapsedActiveTicks: 0,
    arena: { half, obstacles },
    config: {
      durationTicks: Math.round((config.durationSec ?? 120) * TICK_RATE),
      propTarget: config.propTarget ?? 90,
      propWeights: config.propWeights ?? { crumb: 46, chunk: 30, boulder: 16, gem: 5, ember: 3 },
      respawnTicks: (config.respawnSec ?? 3) * TICK_RATE,
      boost: config.boost ?? 'on',
      boostLimit: config.boostLimit ?? 0,
      moveLimit: config.moveLimit ?? 0,
      startMass: config.startMass ?? 20,
      maxVoids: 8,
    },
    rng: rng.state,          // persisted stream state
    props: [],
    nextPropId: 1,
    voids: [],
    goals: (config.goals ?? []).map(g => ({ type: g.type, target: g.target, progress: 0, done: false })),
    stats: { spawned: 0, eaten: 0 },
  };

  // Player void (id 0) + rivals.
  const startMass = state.config.startMass;
  state.voids.push(makeVoid(0, config.playerName ?? 'You', false, startMass, rng, half, obstacles));
  const rivals = config.rivals ?? [];
  for (let i = 0; i < rivals.length && i + 1 < state.config.maxVoids; i++) {
    const v = makeVoid(i + 1, rivals[i].name ?? `Rival ${i + 1}`, true,
      Math.round(startMass * (rivals[i].massScale ?? 1)), rng, half, obstacles);
    v.skill = rivals[i].skill ?? 0.5;
    state.voids.push(v);
  }

  // Initial embers (hazards), then fill props.
  restoreRng(state, rng);
  spawnEmbers(state, config.emberCount ?? 6);
  fillProps(state);
  state.rng = rng.state;
  return state;
}

function makeVoid(id, name, ai, mass, rng, half, obstacles) {
  let x = 0, y = 0, tries = 0;
  do {
    x = rng.range(-half + 6, half - 6);
    y = rng.range(-half + 6, half - 6);
    tries++;
  } while (tries < 60 && hitsObstacle(x, y, 3, half, obstacles));
  return {
    id, name, ai,
    x, y, vx: 0, vy: 0,
    mass, startMass: mass,
    r: radiusForMass(mass),
    alive: true, respawnTicks: 0, protectTicks: PROTECT_TICKS,
    input: { dx: 0, dy: 0, boost: false, seq: 0 },
    moveTicksUsed: 0, boostsUsed: 0,
    // scoring components
    propMass: 0, gemMass: 0, rivalMass: 0, gemsEaten: 0, rivalsEaten: 0,
    deaths: 0, invalid: 0,
    lastProgressTick: 0,
    aiState: { tx: x, ty: y, retarget: 0 },
  };
}

function restoreRng(state, rng) { rng.state = state.rng >>> 0; }

// ------------------------------------------------------------ serialization

export function serialize(state) { return JSON.stringify(state); }
export function deserialize(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (s.version !== SCHEMA_VERSION) throw new Error(`unsupported state version ${s.version}`);
  return s;
}

export function hashState(state) {
  // Canonical projection: everything that affects rules outcomes.
  const p = {
    t: state.tick, ph: state.phase, r: state.rng, np: state.nextPropId,
    pr: state.props.map(q => [q.id, r2(q.x), r2(q.y), q.m, q.k]),
    v: state.voids.map(v => [v.id, r2(v.x), r2(v.y), r2(v.mass), v.alive ? 1 : 0,
      v.respawnTicks, v.propMass, v.gemMass, v.rivalMass, v.deaths, v.invalid, v.moveTicksUsed, v.boostsUsed]),
    g: state.goals.map(g => [g.progress, g.done ? 1 : 0]),
    e: state.elapsedActiveTicks,
  };
  return hashString(JSON.stringify(p)).toString(16).padStart(8, '0');
}
function r2(n) { return Math.round(n * 1000) / 1000; }

export function isTerminal(state) { return state.phase === 'ended'; }
export function terminalReason(state) { return state.terminalReason; }

// --------------------------------------------------------- legal actions
// Hints, tutorials and the input layer all call this same query.

export function queryActions(state, voidId) {
  const v = state.voids[voidId];
  if (!v) return { error: 'no_such_void' };
  const a = {
    phase: state.phase,
    canMove: false, moveReason: null,
    canBoost: false, boostReason: null,
    edible: [],   // entity descriptors the void may consume right now
    hazards: [],  // nearby dangers
    moveTicksLeft: state.config.moveLimit ? Math.max(0, state.config.moveLimit - v.moveTicksUsed) : null,
    boostsLeft: state.config.boost === 'limited' ? Math.max(0, state.config.boostLimit - v.boostsUsed) : null,
  };
  if (state.phase === 'countdown') { a.moveReason = 'countdown'; return a; }
  if (state.phase !== 'active') { a.moveReason = 'not_active'; return a; }
  if (!v.alive) { a.moveReason = 'respawning'; return a; }
  if (state.config.moveLimit && v.moveTicksUsed >= state.config.moveLimit) {
    a.moveReason = 'move_limit';
  } else {
    a.canMove = true;
  }
  if (state.config.boost === 'off') a.boostReason = 'boost_disabled';
  else if (state.config.boost === 'limited' && v.boostsUsed >= state.config.boostLimit) a.boostReason = 'boost_limit';
  else if (v.mass <= BOOST_MIN_MASS + 1) a.boostReason = 'too_light';
  else a.canBoost = a.canMove;

  const reach = v.r + 2.5;
  for (const p of state.props) {
    const d = Math.hypot(p.x - v.x, p.y - v.y);
    if (d > reach + 8) continue;
    const def = PROP_KINDS[p.k];
    if (def.hazard) { if (d < reach + 4) a.hazards.push({ kind: 'prop', id: p.id, why: 'ember_burns' }); }
    else if (edibleMass(v, p.m)) a.edible.push({ kind: 'prop', id: p.id, mass: p.m, d: r2(d) });
  }
  for (const o of state.voids) {
    if (o.id === v.id || !o.alive) continue;
    const d = Math.hypot(o.x - v.x, o.y - v.y);
    if (canEatVoid(v, o)) a.edible.push({ kind: 'void', id: o.id, mass: r2(o.mass), d: r2(d) });
    else if (canEatVoid(o, v) && d < o.r + v.r + 6) a.hazards.push({ kind: 'void', id: o.id, why: 'bigger_void' });
  }
  return a;
}

function edibleMass(v, propMass) { return propMass <= v.mass * EAT_FRACTION; }
function canEatVoid(a, b) {
  return a.alive && b.alive && b.protectTicks <= 0 && a.mass > b.mass * VOID_EAT_RATIO;
}

// ------------------------------------------------------------- commands
// Command: { id, voidId, seq, type:'move', dir:[-100..100,-100..100], boost:bool }
//          { id, voidId, type:'noop' }
// Commands are validated; invalid ones are counted (idempotent by id+seq).

export function applyCommand(state, cmd) {
  const v = state.voids[cmd?.voidId];
  if (!v) return { ok: false, reason: 'no_such_void' };
  if (cmd.id != null && cmd.id === v.input.lastCmdId) return { ok: true, deduped: true };

  if (cmd.type === 'noop') { if (cmd.id != null) v.input.lastCmdId = cmd.id; return { ok: true }; }
  if (cmd.type !== 'move') { v.invalid++; return { ok: false, reason: 'unknown_command' }; }

  const [dx, dy] = cmd.dir ?? [0, 0];
  if (typeof dx !== 'number' || typeof dy !== 'number' || !isFinite(dx) || !isFinite(dy) ||
      Math.abs(dx) > 100 || Math.abs(dy) > 100) {
    v.invalid++; return { ok: false, reason: 'dir_out_of_range' };
  }

  const q = queryActions(state, v.id);
  let boost = !!cmd.boost;
  let boostRejected = null;
  if (boost && !q.canBoost) { boost = false; boostRejected = q.boostReason ?? 'boost_unavailable'; v.invalid++; }

  // Movement while unable is an invalid action (counted), except during countdown
  // where we silently buffer intent (input is acknowledged, not punished).
  if (!q.canMove && state.phase === 'active' && (dx !== 0 || dy !== 0)) {
    v.invalid++;
    if (cmd.id != null) v.input.lastCmdId = cmd.id;
    return { ok: false, reason: q.moveReason ?? 'cannot_move' };
  }

  v.input.dx = dx; v.input.dy = dy; v.input.boost = boost;
  if (cmd.seq != null) v.input.seq = cmd.seq;
  if (cmd.id != null) v.input.lastCmdId = cmd.id;
  return { ok: true, boostRejected };
}

// ----------------------------------------------------------------- step

export function step(state) {
  if (state.phase === 'ended') return [];
  const events = [];
  const rng = new RngStream(0); restoreRng(state, rng);

  if (state.phase === 'countdown') {
    state.countdownTicks--;
    if (state.countdownTicks <= 0) { state.phase = 'active'; events.push({ t: 'start' }); }
    state.rng = rng.state;
    return events;
  }

  state.tick++;
  state.elapsedActiveTicks++;

  // --- AI intent (deterministic, uses only rules stream + state) ---
  for (const v of state.voids) if (v.ai) aiThink(state, v, rng);

  // --- movement (stable order by id) ---
  const moveLimited = [];
  for (const v of state.voids) {
    if (!v.alive) {
      v.respawnTicks--;
      if (v.respawnTicks <= 0) respawn(state, v, rng, events);
      continue;
    }
    if (v.protectTicks > 0) v.protectTicks--;

    let dx = v.input.dx, dy = v.input.dy;
    const mag = Math.hypot(dx, dy);
    if (mag > 100) { dx = dx / mag * 100; dy = dy / mag * 100; }
    const moving = mag > 4;

    let speed = speedForMass(v.mass, v.startMass);
    let boosting = false;
    if (v.input.boost && v.mass > BOOST_MIN_MASS && state.config.boost !== 'off' &&
        !(state.config.boost === 'limited' && v.boostsUsed >= state.config.boostLimit) &&
        moving && (!state.config.moveLimit || v.moveTicksUsed < state.config.moveLimit)) {
      boosting = true;
      speed *= BOOST_SPEED;
      v.mass = Math.max(BOOST_MIN_MASS, v.mass - BOOST_DRAIN);
      if (!v.wasBoosting) { v.boostsUsed++; events.push({ t: 'boost', id: v.id }); }
    }
    v.wasBoosting = boosting;
    if (moving) {
      if (state.config.moveLimit) {
        if (v.moveTicksUsed >= state.config.moveLimit) { dx = 0; dy = 0; moveLimited.push(v.id); }
        else v.moveTicksUsed++;
      }
      const nx = v.x + (dx / 100) * speed * DT;
      const ny = v.y + (dy / 100) * speed * DT;
      const solved = collide(nx, ny, v.r, state.arena);
      v.x = solved[0]; v.y = solved[1];
      v.vx = dx / 100 * speed; v.vy = dy / 100 * speed;
    } else { v.vx *= 0.8; v.vy *= 0.8; }
    v.r = radiusForMass(v.mass);
  }
  if (moveLimited.length) events.push({ t: 'move_limit', ids: moveLimited });

  // --- prop consumption ---
  for (const v of state.voids) {
    if (!v.alive) continue;
    for (let i = state.props.length - 1; i >= 0; i--) {
      const p = state.props[i];
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      const def = PROP_KINDS[p.k];
      if (def.hazard) {
        if (d < v.r * 0.9 && v.protectTicks <= 0) {
          v.mass = Math.max(5, v.mass - EMBER_SHRINK);
          v.r = radiusForMass(v.mass);
          v.protectTicks = Math.round(TICK_RATE * 0.5); // brief mercy window
          events.push({ t: 'burn', id: v.id, prop: p.id });
        }
        continue;
      }
      if (d < v.r && edibleMass(v, p.m)) {
        state.props.splice(i, 1);
        v.mass += p.m; v.r = radiusForMass(v.mass);
        v.lastProgressTick = state.tick;
        if (def.gem) { v.gemMass += p.m; v.gemsEaten++; events.push({ t: 'eat_gem', id: v.id, prop: p.id, m: p.m }); }
        else { v.propMass += p.m; events.push({ t: 'eat', id: v.id, prop: p.id, m: p.m }); }
        state.stats.eaten++;
      }
    }
  }

  // --- void vs void ---
  for (const a of state.voids) {
    if (!a.alive) continue;
    for (const b of state.voids) {
      if (b.id <= a.id || !b.alive) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      let big = null, small = null;
      if (canEatVoid(a, b) && d < a.r * 0.95) { big = a; small = b; }
      else if (canEatVoid(b, a) && d < b.r * 0.95) { big = b; small = a; }
      if (big) {
        const gain = Math.round(small.mass * VOID_EAT_GAIN);
        big.mass += gain; big.r = radiusForMass(big.mass);
        big.rivalMass += gain; big.rivalsEaten++;
        big.lastProgressTick = state.tick;
        small.alive = false;
        small.deaths++;
        small.respawnTicks = state.config.respawnTicks;
        small.input.dx = 0; small.input.dy = 0; small.input.boost = false;
        events.push({ t: 'eat_void', id: big.id, victim: small.id, gain });
      }
    }
  }

  // --- goals (tracked for void 0, the local player) ---
  const me = state.voids[0];
  for (const g of state.goals) {
    if (g.done) continue;
    if (g.type === 'mass') g.progress = Math.floor(me.mass);
    else if (g.type === 'gems') g.progress = me.gemsEaten;
    else if (g.type === 'score') g.progress = massCollected(me);
    else if (g.type === 'rivals') g.progress = me.rivalsEaten;
    else if (g.type === 'survive') g.progress = me.deaths === 0 ? 1 : 0;
    if (g.type === 'survive') g.done = false; // evaluated at end
    else if (g.progress >= g.target) { g.done = true; events.push({ t: 'goal', goal: g.type }); }
  }

  // --- prop respawn (keeps the plaza lively) ---
  if (state.tick % 12 === 0) fillProps(state, rng);

  // --- terminal check ---
  if (state.tick >= state.config.durationTicks) {
    state.phase = 'ended';
    state.terminalReason = 'time_expired';
    for (const g of state.goals) if (g.type === 'survive') { g.done = me.deaths === 0; g.progress = g.done ? 1 : 0; }
    events.push({ t: 'end', reason: 'time_expired' });
  } else if (state.config.moveLimit && me.alive && me.moveTicksUsed >= state.config.moveLimit) {
    // Move-limited challenges end when the player is out of moves.
    state.phase = 'ended';
    state.terminalReason = 'moves_exhausted';
    events.push({ t: 'end', reason: 'moves_exhausted' });
  }

  state.rng = rng.state;
  return events;
}

// --------------------------------------------------------------- scoring

export function massCollected(v) { return v.propMass + v.gemMass + v.rivalMass; }

export function scoreBreakdown(state, voidId) {
  const v = state.voids[voidId];
  const survive = state.goals.some(g => g.type === 'survive');
  const primary = state.goals[0];
  const c = {
    props: v.propMass,
    gems: v.gemMass,
    rivals: v.rivalMass,
    gemCount: v.gemsEaten,
    rivalCount: v.rivalsEaten,
    survivalBonus: v.deaths === 0 ? 50 : 0,
    invalidPenalty: -2 * v.invalid,
  };
  c.massCollected = massCollected(v);
  c.total = c.massCollected + c.survivalBonus + c.invalidPenalty;
  c.primaryGoalDone = primary ? !!primary.done : true;
  return c;
}

// Rank by mass collected; tie-breaks: primary objective completion, fewer
// invalid actions, lower authoritative elapsed time, stable session id.
export function rankings(state) {
  const rows = state.voids.map(v => {
    const b = scoreBreakdown(state, v.id);
    return {
      id: v.id, name: v.name, ai: v.ai, breakdown: b,
      massCollected: b.massCollected,
      goalDone: b.primaryGoalDone ? 1 : 0,
      invalid: v.invalid,
      elapsed: state.elapsedActiveTicks - (v.alive ? 0 : v.respawnTicks),
      deaths: v.deaths,
    };
  });
  rows.sort((a, b) =>
    b.massCollected - a.massCollected ||
    b.goalDone - a.goalDone ||
    a.invalid - b.invalid ||
    a.elapsed - b.elapsed ||
    a.id - b.id);
  rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}

// -------------------------------------------------------------- internals

function hitsObstacle(x, y, r, half, obstacles) {
  if (Math.abs(x) > half - r || Math.abs(y) > half - r) return true;
  for (const o of obstacles) {
    if (Math.abs(x - o.x) < o.hw + r && Math.abs(y - o.y) < o.hh + r) return true;
  }
  return false;
}

function collide(nx, ny, r, arena) {
  const h = arena.half;
  nx = Math.max(-h + r, Math.min(h - r, nx));
  ny = Math.max(-h + r, Math.min(h - r, ny));
  for (const o of arena.obstacles) {
    const dx = nx - o.x, dy = ny - o.y;
    const px = o.hw + r - Math.abs(dx), py = o.hh + r - Math.abs(dy);
    if (px > 0 && py > 0) {
      if (px < py) nx = o.x + Math.sign(dx || 1) * (o.hw + r);
      else ny = o.y + Math.sign(dy || 1) * (o.hh + r);
    }
  }
  return [nx, ny];
}

function freeSpot(state, rng, clearance) {
  const half = state.arena.half;
  for (let tries = 0; tries < 40; tries++) {
    const x = rng.range(-half + 3, half - 3);
    const y = rng.range(-half + 3, half - 3);
    if (hitsObstacle(x, y, clearance, half, state.arena.obstacles)) continue;
    let ok = true;
    for (const v of state.voids) {
      if (v.alive && Math.hypot(v.x - x, v.y - y) < v.r + clearance + 2) { ok = false; break; }
    }
    if (ok) return [x, y];
  }
  return null;
}

function pickKind(state, rng) {
  const w = state.config.propWeights;
  let total = 0; for (const k in w) total += w[k];
  let roll = rng.next() * total;
  for (const k in w) { roll -= w[k]; if (roll <= 0) return k; }
  return 'crumb';
}

function spawnEmbers(state, count) {
  const rng = new RngStream(0); restoreRng(state, rng);
  for (let i = 0; i < count; i++) {
    const spot = freeSpot(state, rng, 1.5);
    if (!spot) break;
    state.props.push({ id: state.nextPropId++, x: spot[0], y: spot[1], m: PROP_KINDS.ember.mass, k: 'ember' });
  }
  state.rng = rng.state;
}

function fillProps(state, rngOpt) {
  const rng = rngOpt ?? (() => { const r = new RngStream(0); restoreRng(state, r); return r; })();
  let guard = 0;
  while (state.props.length < state.config.propTarget && guard++ < 30) {
    const k = pickKind(state, rng);
    const spot = freeSpot(state, rng, k === 'gem' ? 2 : 1);
    if (!spot) break;
    state.props.push({ id: state.nextPropId++, x: spot[0], y: spot[1], m: PROP_KINDS[k].mass, k });
    state.stats.spawned++;
  }
  if (!rngOpt) state.rng = rng.state;
}

function respawn(state, v, rng, events) {
  const spot = freeSpot(state, rng, 3) ?? [0, 0];
  v.x = spot[0]; v.y = spot[1];
  v.mass = Math.max(v.startMass, Math.round(v.mass * RESPAWN_MASS_KEEP));
  v.r = radiusForMass(v.mass);
  v.alive = true;
  v.protectTicks = PROTECT_TICKS;
  events.push({ t: 'respawn', id: v.id });
}

// Very small deterministic AI: seek nearest edible thing, flee bigger voids,
// occasionally boost. Skill tunes reaction cadence and boost usage.
function aiThink(state, v, rng) {
  if (!v.alive) return;
  const s = v.aiState;
  s.retarget--;
  let fleeX = 0, fleeY = 0, threat = false;
  for (const o of state.voids) {
    if (o.id === v.id || !o.alive) continue;
    if (canEatVoid(o, v)) {
      const d = Math.hypot(o.x - v.x, o.y - v.y);
      if (d < o.r + 10) { fleeX += (v.x - o.x) / (d || 1); fleeY += (v.y - o.y) / (d || 1); threat = true; }
    }
  }
  if (threat) {
    const m = Math.hypot(fleeX, fleeY) || 1;
    v.input.dx = Math.round(fleeX / m * 100); v.input.dy = Math.round(fleeY / m * 100);
    v.input.boost = v.mass > BOOST_MIN_MASS * 2 && v.skill > 0.4;
    return;
  }
  if (s.retarget <= 0) {
    let best = null, bestD = 1e9;
    for (const p of state.props) {
      const def = PROP_KINDS[p.k];
      if (def.hazard || !edibleMass(v, p.m)) continue;
      const d = Math.hypot(p.x - v.x, p.y - v.y) - p.m * 0.6;
      if (d < bestD) { bestD = d; best = p; }
    }
    for (const o of state.voids) {
      if (o.id === v.id || !o.alive || !canEatVoid(v, o)) continue;
      const d = Math.hypot(o.x - v.x, o.y - v.y) - 30;
      if (d < bestD && v.skill > 0.5) { bestD = d; best = o; }
    }
    if (best) { s.tx = best.x; s.ty = best.y; }
    else { s.tx = rng.range(-state.arena.half + 5, state.arena.half - 5); s.ty = rng.range(-state.arena.half + 5, state.arena.half - 5); }
    s.retarget = Math.round((1.6 - v.skill) * TICK_RATE * 0.5) + 5;
  }
  const dx = s.tx - v.x, dy = s.ty - v.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5) { v.input.dx = 0; v.input.dy = 0; }
  else { v.input.dx = Math.round(dx / d * 100); v.input.dy = Math.round(dy / d * 100); }
  v.input.boost = false;
}
