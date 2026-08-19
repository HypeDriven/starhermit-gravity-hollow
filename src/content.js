// Gravity Hollow — versioned content: themes, journey stages, challenges,
// tutorials, and the daily challenge. Content is data: identifier, seed,
// initial state parameters, goals, allowed mechanics, par values, tutorial
// flags, and presentation theme. Validators prove basic legality, reachable
// goals, bounded duration, and absence of soft locks.

import { seedFromString, mulberry32 } from './rng.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------- themes

export const THEMES = {
  verdant: {
    id: 'verdant', name: 'Verdant Court',
    sky: 0x0c1a12, fog: 0x0c1a12, ground: 0x1c3327, groundLine: 0x2c5240,
    obstacle: 0x3d6b4f, obstacleTop: 0x54906e,
    key: 0xfff2d8, fill: 0x7dbb92, accent: 0x9fe6a0,
    propColors: { crumb: 0xcfe8b0, chunk: 0xa4d47e, boulder: 0x7fb35e, gem: 0x64f2c0, ember: 0xff7a3c },
    ambience: 'garden',
  },
  ember: {
    id: 'ember', name: 'Ember Arcade',
    sky: 0x1d0f0a, fog: 0x1d0f0a, ground: 0x33201a, groundLine: 0x54332a,
    obstacle: 0x6b4434, obstacleTop: 0x8a5a44,
    key: 0xffd9b0, fill: 0xbb8a7d, accent: 0xffb25e,
    propColors: { crumb: 0xf2d8a0, chunk: 0xe0a86a, boulder: 0xb5794e, gem: 0x64d8f2, ember: 0xff5a2c },
    ambience: 'forge',
  },
  tide: {
    id: 'tide', name: 'Tideglass Promenade',
    sky: 0x0a1420, fog: 0x0a1420, ground: 0x16283a, groundLine: 0x27445e,
    obstacle: 0x35566e, obstacleTop: 0x4d7590,
    key: 0xd8ecff, fill: 0x7da8bb, accent: 0x7ee0e6,
    propColors: { crumb: 0xbfe0e8, chunk: 0x8ec4d4, boulder: 0x5e9ab0, gem: 0xf2e664, ember: 0xff8a4c },
    ambience: 'shore',
  },
  dusk: {
    id: 'dusk', name: 'Dusk Bazaar',
    sky: 0x160f22, fog: 0x160f22, ground: 0x251a38, groundLine: 0x3d2c58,
    obstacle: 0x54406e, obstacleTop: 0x6f5890,
    key: 0xf2d8ff, fill: 0xa07dbb, accent: 0xe69fd8,
    propColors: { crumb: 0xe0cfe8, chunk: 0xc4a4d4, boulder: 0x9a7fb3, gem: 0x9ff264, ember: 0xff6a5c },
    ambience: 'market',
  },
  frost: {
    id: 'frost', name: 'Frost Meridian',
    sky: 0x0d141c, fog: 0x0d141c, ground: 0x1e2c38, groundLine: 0x3a5468,
    obstacle: 0x5a7488, obstacleTop: 0x7d99ad,
    key: 0xffffff, fill: 0x9dbbcc, accent: 0xa0d8f2,
    propColors: { crumb: 0xe8f2f8, chunk: 0xc4dce8, boulder: 0x9ab8c8, gem: 0xf2b064, ember: 0xff7a3c },
    ambience: 'tundra',
  },
};

export const THEME_IDS = Object.keys(THEMES);

// ------------------------------------------------------------- generators

function obstacleSet(half, density, rng) {
  // Plaza modules: planters, fountain rings (as rects), arcade blocks.
  const obs = [];
  obs.push({ x: 0, y: 0, hw: 3.2, hh: 3.2, kind: 'fountain' }); // central fountain
  const n = Math.round(density * 7);
  for (let i = 0; i < n; i++) {
    const side = i % 4;
    const along = rng() * 2 - 1;
    const depth = 0.45 + rng() * 0.4;
    let x, y, hw, hh;
    if (side === 0) { x = along * half * 0.8; y = -half * depth; hw = 2 + rng() * 3; hh = 1.2 + rng() * 1.6; }
    else if (side === 1) { x = along * half * 0.8; y = half * depth; hw = 2 + rng() * 3; hh = 1.2 + rng() * 1.6; }
    else if (side === 2) { x = -half * depth; y = along * half * 0.8; hw = 1.2 + rng() * 1.6; hh = 2 + rng() * 3; }
    else { x = half * depth; y = along * half * 0.8; hw = 1.2 + rng() * 1.6; hh = 2 + rng() * 3; }
    // keep the center lanes open so nothing soft-locks
    if (Math.abs(x) < 8 && Math.abs(y) < 8) continue;
    obs.push({ x: r1(x), y: r1(y), hw: r1(hw), hh: r1(hh), kind: rng() < 0.5 ? 'planter' : 'arcade' });
  }
  return obs;
}
function r1(n) { return Math.round(n * 10) / 10; }

const RIVAL_NAMES = ['Pip', 'Sorrel', 'Bram', 'Nettle', 'Cobb', 'Wren', 'Tansy', 'Hollis'];

// Journey stage i (1..40). One new concept at a time, combined with one known
// concept, mastery stage every 5th.
export function journeyStage(i) {
  const seed = seedFromString(`gh:journey:v${CONTENT_VERSION}:${i}`);
  const rng = mulberry32(seed);
  const tier = Math.ceil(i / 5);              // 1..8
  const mastery = i % 5 === 0;
  const theme = THEME_IDS[(tier - 1) % THEME_IDS.length];
  const half = Math.min(50, 34 + tier * 2);
  const obstacles = obstacleSet(half, 0.4 + tier * 0.08, rng);
  const rivalCount = Math.min(5, Math.max(0, tier - 1 + (mastery ? 1 : 0)));
  const rivals = [];
  for (let r = 0; r < rivalCount; r++) {
    rivals.push({ name: RIVAL_NAMES[(i + r) % RIVAL_NAMES.length], skill: Math.min(0.95, 0.3 + tier * 0.07 + rng() * 0.1), massScale: 1 });
  }
  const emberCount = tier >= 2 ? Math.min(14, 3 + tier * 2) : 0;
  const durationSec = mastery ? 150 : 100 + tier * 5;

  // Goals teach one concept at a time.
  const goals = [];
  let concept;
  if (i <= 2) { concept = 'collect'; goals.push({ type: 'score', target: 40 + i * 20 }); }
  else if (i <= 4) { concept = 'grow'; goals.push({ type: 'mass', target: 60 + i * 10 }); }
  else if (i <= 6) { concept = 'gems'; goals.push({ type: 'gems', target: 2 + tier }); }
  else if (i <= 9) { concept = 'hazards'; goals.push({ type: 'score', target: 90 + i * 12 }); goals.push({ type: 'survive', target: 1 }); }
  else if (i <= 14) { concept = 'rivals'; goals.push({ type: 'rivals', target: mastery ? 2 : 1 }); }
  else if (i <= 20) { concept = 'combo'; goals.push({ type: 'gems', target: 3 + tier }); goals.push({ type: 'survive', target: 1 }); }
  else if (i <= 30) { concept = 'contest'; goals.push({ type: 'score', target: 140 + i * 10 }); goals.push({ type: 'rivals', target: 1 }); }
  else { concept = 'mastery'; goals.push({ type: 'gems', target: 6 }); goals.push({ type: 'rivals', target: 2 }); goals.push({ type: 'survive', target: 1 }); }

  const gemWeight = concept === 'gems' || concept === 'combo' || concept === 'mastery' ? 10 : 5;
  return {
    id: `journey-${String(i).padStart(2, '0')}`,
    kind: 'journey', index: i, mastery, concept,
    version: CONTENT_VERSION, seed,
    name: `${mastery ? 'Mastery' : 'Stage'} ${i}`,
    theme, arenaHalf: half, obstacles, durationSec,
    rivals, emberCount,
    propTarget: 80 + tier * 6,
    propWeights: { crumb: 44, chunk: 30, boulder: 16, gem: gemWeight, ember: emberCount > 6 ? 2 : 0 },
    goals,
    boost: i <= 3 ? 'off' : 'on',      // boost introduced after stage 3
    par: { mass: 60 + i * 12, gems: Math.max(1, tier), timeSec: durationSec },
    tutorialFlags: i <= 6 ? [`concept:${concept}`] : [],
  };
}

export const JOURNEY_COUNT = 40;
export function journeyAll() { const a = []; for (let i = 1; i <= JOURNEY_COUNT; i++) a.push(journeyStage(i)); return a; }

// ---------------------------------------------------------------- daily
// One shared seed and ruleset per UTC day. Immutable after publication; a
// defective day is marked excluded from ranking, never silently replaced.

export function dailyStage(utcDateKey, excluded = false) {
  const seed = seedFromString(`gh:daily:v${CONTENT_VERSION}:${utcDateKey}`);
  const rng = mulberry32(seed);
  const theme = THEME_IDS[Math.floor(rng() * THEME_IDS.length)];
  const half = 40 + Math.floor(rng() * 8);
  const obstacles = obstacleSet(half, 0.5 + rng() * 0.4, rng);
  const rivals = [];
  const n = 2 + Math.floor(rng() * 3);
  for (let r = 0; r < n; r++) rivals.push({ name: RIVAL_NAMES[Math.floor(rng() * RIVAL_NAMES.length)], skill: 0.45 + rng() * 0.3, massScale: 1 });
  return {
    id: `daily-${utcDateKey}`, kind: 'daily', version: CONTENT_VERSION, seed,
    name: `Daily Hollow — ${utcDateKey}`, dateKey: utcDateKey, excluded,
    theme, arenaHalf: half, obstacles, durationSec: 150,
    rivals, emberCount: 4 + Math.floor(rng() * 8), propTarget: 100,
    propWeights: { crumb: 42, chunk: 30, boulder: 17, gem: 8, ember: 3 },
    goals: [{ type: 'gems', target: 4 }],
    boost: 'on',
    par: { mass: 220, gems: 4, timeSec: 150 },
  };
}

// ------------------------------------------------------------- challenges

export function challenges() {
  const mk = (id, name, desc, mut) => {
    const seed = seedFromString(`gh:challenge:v${CONTENT_VERSION}:${id}`);
    const rng = mulberry32(seed);
    const base = {
      id: `challenge-${id}`, kind: 'challenge', version: CONTENT_VERSION, seed,
      name, description: desc, theme: 'dusk', arenaHalf: 40,
      obstacles: obstacleSet(40, 0.5, rng), durationSec: 120,
      rivals: [{ name: 'Pip', skill: 0.5, massScale: 1 }, { name: 'Wren', skill: 0.55, massScale: 1 }],
      emberCount: 6, propTarget: 90,
      propWeights: { crumb: 44, chunk: 30, boulder: 16, gem: 6, ember: 4 },
      goals: [{ type: 'score', target: 150 }], boost: 'on',
      par: { mass: 200, gems: 3, timeSec: 120 },
    };
    return Object.assign(base, mut);
  };
  return [
    mk('sprint', 'Sprint Hollow', 'Only 45 seconds. Make every route count.', { durationSec: 45, goals: [{ type: 'score', target: 90 }], par: { mass: 130, gems: 2, timeSec: 45 } }),
    mk('fasting', 'No Boost Bout', 'Boost is disabled. Win on lines, not bursts.', { boost: 'off', goals: [{ type: 'score', target: 140 }] }),
    mk('ration', 'Three Bursts', 'You may boost exactly three times.', { boost: 'limited', boostLimit: 3, goals: [{ type: 'score', target: 150 }] }),
    mk('measured', 'Measured Steps', 'A strict move limit: 25 seconds of movement.', { moveLimit: 25 * 30, durationSec: 300, goals: [{ type: 'score', target: 120 }], par: { mass: 160, gems: 2, timeSec: 300 } }),
    mk('gemrush', 'Gem Rush', 'Gems are everywhere — so are rivals.', { propWeights: { crumb: 30, chunk: 26, boulder: 18, gem: 22, ember: 4 }, goals: [{ type: 'gems', target: 8 }], rivals: [{ name: 'Cobb', skill: 0.7, massScale: 1 }, { name: 'Tansy', skill: 0.65, massScale: 1 }, { name: 'Bram', skill: 0.6, massScale: 1 }] }),
    mk('gauntlet', 'Ember Gauntlet', 'The plaza is littered with embers.', { emberCount: 18, propWeights: { crumb: 42, chunk: 30, boulder: 16, gem: 6, ember: 10 }, goals: [{ type: 'score', target: 130 }, { type: 'survive', target: 1 }] }),
    mk('leviathan', 'Leviathan Tank', 'Rivals start huge. Grow fast or be lunch.', { rivals: [{ name: 'Hollis', skill: 0.6, massScale: 3 }, { name: 'Nettle', skill: 0.55, massScale: 2.2 }], goals: [{ type: 'score', target: 120 }, { type: 'survive', target: 1 }] }),
    mk('cramped', 'Cramped Court', 'A tiny arena. Nowhere to hide.', { arenaHalf: 26, obstacles: obstacleSet(26, 0.35, mulberry32(seedFromString('gh:challenge:cramped:o'))), rivals: [{ name: 'Sorrel', skill: 0.6, massScale: 1 }], goals: [{ type: 'score', target: 110 }] }),
  ];
}

// -------------------------------------------------------------- practice

export function practiceStage(difficulty) {
  const d = { relaxed: 0, standard: 1, intense: 2 }[difficulty] ?? 1;
  const seed = seedFromString(`gh:practice:v${CONTENT_VERSION}:${difficulty}:${new Date(0).getUTCFullYear()}`) ^ (d * 7919);
  const rng = mulberry32(seed);
  const half = 40;
  return {
    id: `practice-${difficulty}`, kind: 'practice', version: CONTENT_VERSION, seed,
    name: `Practice — ${difficulty[0].toUpperCase() + difficulty.slice(1)}`,
    theme: THEME_IDS[d % THEME_IDS.length], arenaHalf: half,
    obstacles: obstacleSet(half, 0.35 + d * 0.15, rng), durationSec: 120,
    rivals: d === 0 ? [] : d === 1 ? [{ name: 'Pip', skill: 0.4, massScale: 1 }] : [{ name: 'Pip', skill: 0.55, massScale: 1 }, { name: 'Wren', skill: 0.6, massScale: 1 }],
    emberCount: d * 3, propTarget: 95,
    propWeights: { crumb: 44, chunk: 30, boulder: 16, gem: 6, ember: d ? 4 : 0 },
    goals: [{ type: 'score', target: 80 + d * 60 }], boost: 'on',
    par: { mass: 140 + d * 60, gems: 2 + d, timeSec: 120 },
    unrated: true, undoAllowed: true,
  };
}

// -------------------------------------------------------------- tutorial
// Learn mode: interactive lessons, one rule at a time; the player must
// perform the action. Steps reference the rules legal-action query.

export function tutorials() {
  const base = {
    kind: 'learn', version: CONTENT_VERSION, theme: 'verdant', arenaHalf: 30,
    obstacles: [], durationSec: 600, rivals: [], emberCount: 0,
    propTarget: 60, propWeights: { crumb: 60, chunk: 30, boulder: 10, gem: 0, ember: 0 },
    goals: [], boost: 'off', countdownSec: 0,
  };
  const L = (n, name, mut, steps) => ({
    id: `learn-${n}`, name, seed: seedFromString(`gh:learn:v${CONTENT_VERSION}:${n}`),
    ...base, ...mut, steps,
  });
  return [
    L(1, 'Drift', {}, [
      { text: 'You are a hollow — a small hungry void. Move with WASD, arrow keys, or drag on the plaza.', require: { type: 'move_ticks', count: 45 }, hint: 'Hold any direction to drift.' },
      { text: 'Good. Drift to each glowing marker.', require: { type: 'visit_markers', count: 3 }, hint: 'Follow the bright rings.' },
    ]),
    L(2, 'Nibble', { propWeights: { crumb: 100, chunk: 0, boulder: 0, gem: 0, ember: 0 }, propTarget: 40 }, [
      { text: 'Pale motes are smaller than you. Roll over them to consume.', require: { type: 'eat', count: 6 }, hint: 'Anything dimmer than you is food.' },
      { text: 'Consume 10 motes. Watch your hollow swell.', require: { type: 'eat', count: 10 }, hint: 'Bigger hollow, bigger appetite.' },
    ]),
    L(3, 'Appetite', { propWeights: { crumb: 40, chunk: 40, boulder: 20, gem: 0, ember: 0 }, propTarget: 50 }, [
      { text: 'Chonky morsels need a bigger hollow. Eat small first, then medium.', require: { type: 'eat_kind', kind: 'chunk', count: 4 }, hint: 'Outlines show what you can eat right now.' },
      { text: 'Now grow until you can swallow a boulder.', require: { type: 'eat_kind', kind: 'boulder', count: 2 }, hint: 'Boulders highlight once you are big enough.' },
    ]),
    L(4, 'Ember & Boost', { boost: 'on', emberCount: 4, propWeights: { crumb: 50, chunk: 30, boulder: 12, gem: 8, ember: 0 }, propTarget: 55 }, [
      { text: 'Orange embers burn — they shrink you. Avoid them and eat 3 gems.', require: { type: 'eat_kind', kind: 'gem', count: 3 }, hint: 'Gems gleam. Embers smolder.' },
      { text: 'Hold SHIFT (or the BOOST button) to surge. Boosting spends mass — use it twice.', require: { type: 'boost', count: 2 }, hint: 'Boost is a spending, not a gift.' },
    ]),
    L(5, 'Rivals', { boost: 'on', rivals: [{ name: 'Pip', skill: 0.35, massScale: 0.8 }], propTarget: 70, goals: [{ type: 'rivals', target: 1 }] }, [
      { text: 'Pip is another hollow. Outgrow them, then swallow them whole.', require: { type: 'eat_rival', count: 1 }, hint: 'You must outweigh them by a quarter.' },
      { text: 'Now outscore Pip before the clock runs out.', require: { type: 'finish' }, hint: 'Mass collected decides the winner.' },
    ]),
  ];
}

// ------------------------------------------------------------ validators
// Offline validation: basic legality, reachable goals, bounded duration, no
// soft locks. Run by tests and at boot in dev.

export function validateContent(stage) {
  const errors = [];
  if (!stage.id || !stage.version || typeof stage.seed !== 'number') errors.push('identity: id/version/seed required');
  if (!(stage.durationSec > 0 && stage.durationSec <= 900)) errors.push('duration: must be in (0, 900]s');
  if (!(stage.arenaHalf >= 20 && stage.arenaHalf <= 60)) errors.push('arena: half-size out of bounds');
  if (!THEMES[stage.theme]) errors.push(`theme: unknown '${stage.theme}'`);
  const startMass = stage.startMass ?? 20;
  // Goal reachability heuristics: props in weights must be able to chain to targets.
  for (const g of stage.goals ?? []) {
    if (g.type === 'gems') {
      const gemW = stage.propWeights?.gem ?? 0;
      if (gemW <= 0) errors.push(`goal gems:${g.target} unreachable — no gem weight`);
      const totalWeight = Object.values(stage.propWeights ?? {}).reduce((a, b) => a + b, 0);
      const expectedGems = (stage.propTarget ?? 80) * (gemW / totalWeight);
      if (expectedGems < g.target * 0.5) errors.push(`goal gems:${g.target} likely starved (expect ~${expectedGems.toFixed(1)} live)`);
    }
    if (g.type === 'mass' && g.target > 1200) errors.push('goal mass: above plausible ceiling');
    if (g.type === 'rivals' && (stage.rivals ?? []).length === 0) errors.push('goal rivals: no rivals present');
    if (g.type === 'score' && g.target > 2500) errors.push('goal score: above plausible ceiling');
  }
  // Soft-lock check: every obstacle must leave the center lane and rim walkable.
  for (const o of stage.obstacles ?? []) {
    if (o.hw >= stage.arenaHalf * 0.5 || o.hh >= stage.arenaHalf * 0.5) errors.push('obstacle: blocks a full axis (soft lock risk)');
  }
  if ((stage.rivals ?? []).length > 7) errors.push('rivals: exceeds max seats');
  return { ok: errors.length === 0, errors };
}

export function validateAll() {
  const report = [];
  for (const s of journeyAll()) report.push([s.id, validateContent(s)]);
  for (const s of challenges()) report.push([s.id, validateContent(s)]);
  for (const d of ['relaxed', 'standard', 'intense']) report.push([`practice-${d}`, validateContent(practiceStage(d))]);
  for (const t of tutorials()) report.push([t.id, validateContent(t)]);
  report.push(['daily-sample', validateContent(dailyStage('2026-01-01'))]);
  return report;
}
