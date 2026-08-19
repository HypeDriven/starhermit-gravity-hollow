// Node test suite for the Gravity Hollow rules engine and content pack.
// Run: node tests/rules.test.mjs
import {
  createMatch, applyCommand, step, queryActions, serialize, deserialize,
  hashState, rankings, scoreBreakdown, isTerminal, terminalReason,
  TICK_RATE, radiusForMass,
} from '../src/rules.js';
import { journeyStage, challenges, practiceStage, tutorials, dailyStage, validateAll, journeyAll } from '../src/content.js';
import { hashString } from '../src/rng.js';

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; console.error(`FAIL: ${name}`); }
}
function section(s) { console.log(`\n== ${s}`); }

// helper: run a scripted match; script = { tick: [commands] }
function runMatch(config, script = {}, maxTicks = Infinity) {
  const state = createMatch(config);
  const hashes = [];
  const limit = Math.min(maxTicks, state.config.durationTicks + state.countdownTicks + 5);
  while (!isTerminal(state) && state.tick + state.countdownTicks < limit) {
    const cmds = script[state.tick] ?? [];
    for (const c of cmds) applyCommand(state, c);
    step(state);
    if (state.tick % 30 === 0) hashes.push(hashState(state));
  }
  return { state, hashes };
}

function baseConfig(over = {}) {
  return {
    seed: 12345, stageId: 'test', contentVersion: 1, durationSec: 30,
    arenaHalf: 40, obstacles: [{ x: 10, y: 10, hw: 2, hh: 2, kind: 'planter' }],
    rivals: [{ name: 'AI', skill: 0.5 }], emberCount: 3, propTarget: 60,
    goals: [{ type: 'gems', target: 2 }], boost: 'on', countdownSec: 1,
    ...over,
  };
}

section('creation & serialization');
{
  const s = createMatch(baseConfig());
  ok(s.voids.length === 2, 'two voids created');
  ok(s.props.length > 20, 'props seeded');
  ok(s.phase === 'countdown', 'starts in countdown');
  const json = serialize(s);
  const s2 = deserialize(json);
  ok(hashState(s) === hashState(s2), 'serialize round-trip preserves hash');
  ok(s2.voids[0].mass === s.voids[0].mass, 'void mass round-trips');
}

section('deterministic replay (same seed + commands => identical hashes)');
{
  const script = {};
  for (let t = 0; t < 600; t += 7) {
    script[t] = [{ id: `c${t}`, voidId: 0, type: 'move', dir: [((t * 37) % 200) - 100, ((t * 53) % 200) - 100], boost: t % 21 === 0 }];
  }
  const a = runMatch(baseConfig({ durationSec: 25 }), script);
  const b = runMatch(baseConfig({ durationSec: 25 }), script);
  ok(a.hashes.length > 0 && a.hashes.join() === b.hashes.join(), 'hash streams identical');
  ok(hashState(a.state) === hashState(b.state), 'final hashes identical');
  ok(a.state.rng === b.state.rng, 'rng stream states identical');
}

section('different seeds diverge');
{
  const a = runMatch(baseConfig({ seed: 1, durationSec: 10 }));
  const b = runMatch(baseConfig({ seed: 2, durationSec: 10 }));
  ok(hashState(a.state) !== hashState(b.state), 'seeds produce different states');
}

section('legal actions & invalid reasons');
{
  const s = createMatch(baseConfig());
  let q = queryActions(s, 0);
  ok(q.canMove === false && q.moveReason === 'countdown', 'cannot move during countdown');
  while (s.phase === 'countdown') step(s);
  q = queryActions(s, 0);
  ok(s.phase === 'active', 'countdown transitions to active');
  ok(q.canMove === true, 'can move when active');
  ok(Array.isArray(q.edible) && Array.isArray(q.hazards), 'query exposes edible/hazards');

  // out-of-range dir
  const r1 = applyCommand(s, { id: 'x1', voidId: 0, type: 'move', dir: [500, 0] });
  ok(!r1.ok && r1.reason === 'dir_out_of_range', 'out-of-range dir rejected');
  ok(s.voids[0].invalid === 1, 'invalid action counted');

  // unknown command type
  const r2 = applyCommand(s, { id: 'x2', voidId: 0, type: 'teleport' });
  ok(!r2.ok && r2.reason === 'unknown_command', 'unknown command rejected');

  // duplicate id is idempotent
  const before = s.voids[0].invalid;
  applyCommand(s, { id: 'x3', voidId: 0, type: 'move', dir: [10, 0] });
  const d = applyCommand(s, { id: 'x3', voidId: 0, type: 'move', dir: [10, 0] });
  ok(d.deduped === true, 'duplicate command id deduped');
  ok(s.voids[0].invalid === before, 'dedupe does not double-count');

  // boost rejection when too light
  const light = createMatch(baseConfig({ startMass: 12 }));
  while (light.phase === 'countdown') step(light);
  const rb = applyCommand(light, { id: 'b1', voidId: 0, type: 'move', dir: [10, 0], boost: true });
  ok(rb.ok && rb.boostRejected === 'too_light', 'boost rejected when too light, move still applied');

  // boost disabled stage
  const nb = createMatch(baseConfig({ boost: 'off' }));
  while (nb.phase === 'countdown') step(nb);
  ok(queryActions(nb, 0).boostReason === 'boost_disabled', 'boost disabled reason');

  // move limit
  const ml = createMatch(baseConfig({ moveLimit: 10, durationSec: 60 }));
  while (ml.phase === 'countdown') step(ml);
  for (let i = 0; i < 9; i++) { applyCommand(ml, { id: `m${i}`, voidId: 0, type: 'move', dir: [100, 0] }); step(ml); }
  ok(queryActions(ml, 0).canMove === true, 'moves remain before limit');
  applyCommand(ml, { id: 'm9', voidId: 0, type: 'move', dir: [100, 0] }); step(ml);
  ok(isTerminal(ml) && terminalReason(ml) === 'moves_exhausted', 'move-limited match ends when moves run out');
}

section('consumption & growth');
{
  // player-only arena, no rivals/hazards
  const s = createMatch(baseConfig({ rivals: [], emberCount: 0, propTarget: 120, countdownSec: 0 }));
  step(s); // countdown->active (0 sec countdown => next step)
  const me = s.voids[0];
  // teleport a crumb in front of the player and eat it
  const crumb = s.props.find(p => p.k === 'crumb');
  crumb.x = me.x; crumb.y = me.y;
  const m0 = me.mass;
  step(s);
  ok(me.mass === m0 + 1, 'crumb consumed adds mass');
  ok(me.propMass === 1, 'propMass component tracked');
  ok(me.r === radiusForMass(me.mass), 'radius derives from mass');

  // gem scoring
  const gem = s.props.find(p => p.k === 'gem') ?? (() => { s.props.push({ id: 9999, x: 0, y: 0, m: 15, k: 'gem' }); return s.props[s.props.length - 1]; })();
  me.mass = 100; me.r = radiusForMass(100);
  gem.x = me.x; gem.y = me.y;
  step(s);
  ok(me.gemsEaten >= 1 && me.gemMass >= 15, 'gem tracked separately');

  // inedible when too heavy
  const big = s.props.find(p => p.k === 'boulder');
  if (big) {
    const tiny = createMatch(baseConfig({ rivals: [], emberCount: 0, countdownSec: 0 }));
    step(tiny);
    const tm = tiny.voids[0];
    big.x = tm.x; big.y = tm.y; big.m = 100; // far above capacity
    const mm = tm.mass;
    step(tiny);
    ok(tm.mass === mm, 'too-heavy prop not eaten');
  }
}

section('ember hazard');
{
  const s = createMatch(baseConfig({ rivals: [], emberCount: 0, countdownSec: 0 }));
  step(s);
  const me = s.voids[0];
  me.mass = 60; me.r = radiusForMass(60);
  me.protectTicks = 0;
  s.props.push({ id: 7777, x: me.x, y: me.y, m: 4, k: 'ember' });
  const m0 = me.mass;
  const ev = step(s);
  ok(me.mass < m0, 'ember shrinks void');
  ok(ev.some(e => e.t === 'burn'), 'burn event emitted');
}

section('void eats void & respawn');
{
  const s = createMatch(baseConfig({ countdownSec: 0, emberCount: 0 }));
  step(s);
  const me = s.voids[0], ai = s.voids[1];
  me.mass = 200; me.r = radiusForMass(200);
  ai.mass = 30; ai.r = radiusForMass(30);
  ai.protectTicks = 0; me.protectTicks = 0;
  ai.x = me.x; ai.y = me.y;
  ai.ai = false; // hold still
  const ev = step(s);
  ok(ev.some(e => e.t === 'eat_void'), 'eat_void event');
  ok(!ai.alive && ai.deaths === 1, 'victim dead, death counted');
  ok(me.rivalMass > 0, 'rival mass component tracked');
  // respawn after configured ticks
  for (let i = 0; i < s.config.respawnTicks + 2; i++) step(s);
  ok(ai.alive === true, 'victim respawns');
  ok(ai.protectTicks > 0, 'respawn protection active');
}

section('terminal state & rankings');
{
  const { state } = runMatch(baseConfig({ durationSec: 5 }), {});
  ok(isTerminal(state), 'match terminates');
  ok(terminalReason(state) === 'time_expired', 'terminal reason is time_expired');
  const ranks = rankings(state);
  ok(ranks.length === 2 && ranks[0].place === 1, 'rankings produced with places');
  const sorted = ranks.every((r, i) => i === 0 || ranks[i - 1].massCollected >= r.massCollected);
  ok(sorted, 'ranked by mass collected desc');
  const bd = scoreBreakdown(state, 0);
  ok(typeof bd.total === 'number' && 'survivalBonus' in bd && 'invalidPenalty' in bd, 'breakdown components present');
  ok(bd.massCollected === bd.props + bd.gems + bd.rivals, 'mass components sum');
  // stepping after end is a no-op
  const h = hashState(state);
  step(state);
  ok(hashState(state) === h, 'no-op after terminal');
}

section('tie-break order');
{
  const s = createMatch(baseConfig({ countdownSec: 0, durationSec: 5 }));
  step(s);
  // force equal collected mass; freeze the rival so nothing changes
  s.voids[1].ai = false; s.voids[1].input.dx = 0; s.voids[1].input.dy = 0;
  s.voids[0].propMass = 100; s.voids[1].propMass = 100;
  s.voids[1].invalid = 3;
  s.phase = 'ended'; s.terminalReason = 'time_expired';
  const r = rankings(s);
  ok(r[0].id === 0 && r[0].invalid < r[1].invalid, 'fewer invalid actions breaks a mass tie');
  // equal invalid counts fall through to stable id
  s.voids[1].invalid = 0;
  const r2 = rankings(s);
  ok(r2[0].id === 0, 'stable session id is the final tie-break');
}

section('obstacle collision keeps voids in arena');
{
  const script = { 0: [{ id: 'a', voidId: 0, type: 'move', dir: [100, 100] }] };
  const { state } = runMatch(baseConfig({ durationSec: 8 }), script);
  const me = state.voids[0];
  const h = state.arena.half;
  ok(Math.abs(me.x) <= h && Math.abs(me.y) <= h, 'stays inside arena bounds');
  for (const o of state.arena.obstacles) {
    const inside = Math.abs(me.x - o.x) < o.hw && Math.abs(me.y - o.y) < o.hh;
    ok(!inside, 'never inside an obstacle');
  }
}

section('fuzz: malformed commands never hang or NaN');
{
  const s = createMatch(baseConfig({ durationSec: 10 }));
  const junk = [null, undefined, {}, { type: 'move' }, { type: 'move', dir: [NaN, 0] },
    { type: 'move', dir: ['a', 'b'] }, { voidId: 99, type: 'move', dir: [1, 1] },
    { voidId: 0, type: 'move', dir: [Infinity, -Infinity] }, { voidId: -1, type: 'noop' }];
  let steps = 0;
  for (let round = 0; round < 30 && !isTerminal(s); round++) {
    for (const j of junk) applyCommand(s, j);
    applyCommand(s, { id: `f${round}`, voidId: 0, type: 'move', dir: [round % 200 - 100, 50] });
    step(s); steps++;
    for (const v of s.voids) ok(isFinite(v.x) && isFinite(v.y) && isFinite(v.mass), `finite state at step ${steps}`);
    ok(steps < 10000, 'bounded loop');
  }
}

section('content validators');
{
  const report = validateAll();
  let bad = 0;
  for (const [id, r] of report) if (!r.ok) { bad++; console.error(`  content ${id}: ${r.errors.join('; ')}`); }
  ok(bad === 0, `all ${report.length} content entries validate`);
  ok(journeyAll().length === 40, 'journey has 40 stages');
  ok(challenges().length >= 8, 'at least 8 challenges');
  ok(tutorials().length === 5, 'five tutorial lessons');
  const d1 = dailyStage('2026-08-18'), d2 = dailyStage('2026-08-18'), d3 = dailyStage('2026-08-19');
  ok(d1.seed === d2.seed && d1.seed !== d3.seed, 'daily seed stable per UTC day');
}

section('golden sessions: journey stages complete with real AI');
{
  // easy (1), medium (18), hard (35): simulate with a simple greedy player-bot
  for (const idx of [1, 18, 35]) {
    const stage = journeyStage(idx);
    const s = createMatch({ ...stage, playerName: 'Bot' });
    let guard = 0;
    while (!isTerminal(s) && guard++ < stage.durationSec * TICK_RATE + 200) {
      // greedy player: steer to nearest edible prop
      if (s.phase === 'active' && s.voids[0].alive) {
        const me = s.voids[0];
        let best = null, bd = 1e9;
        for (const p of s.props) {
          if (p.k === 'ember' || p.m > me.mass * 0.5) continue;
          const d = Math.hypot(p.x - me.x, p.y - me.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const dx = best.x - me.x, dy = best.y - me.y, m = Math.hypot(dx, dy) || 1;
          applyCommand(s, { id: `g${s.tick}`, voidId: 0, type: 'move', dir: [Math.round(dx / m * 100), Math.round(dy / m * 100)] });
        }
      }
      step(s);
    }
    ok(isTerminal(s), `journey ${idx} terminates`);
    ok(s.voids[0].mass > s.voids[0].startMass, `journey ${idx} player grows (mass ${Math.round(s.voids[0].mass)})`);
    ok(s.stats.eaten > 10, `journey ${idx} props were consumed`);
  }
}

section('interrupted & resumed session (snapshot mid-match)');
{
  const script = {};
  for (let t = 0; t < 300; t += 5) script[t] = [{ id: `i${t}`, voidId: 0, type: 'move', dir: [60, -40] }];
  const cfg = baseConfig({ durationSec: 12 });
  const a = createMatch(cfg);
  // run half
  while (a.tick < 150 && !isTerminal(a)) { for (const c of script[a.tick] ?? []) applyCommand(a, c); step(a); }
  const snap = serialize(a);
  // resume from snapshot in a "new process"
  const b = deserialize(snap);
  while (!isTerminal(a)) { for (const c of script[a.tick] ?? []) applyCommand(a, c); step(a); }
  while (!isTerminal(b)) { for (const c of script[b.tick] ?? []) applyCommand(b, c); step(b); }
  ok(hashState(a) === hashState(b), 'resumed session converges to identical end state');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
