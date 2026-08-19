// Gravity Hollow — session layer: fixed-step simulation loop with interpolation
// alpha, validated command submission, undo (practice), replay envelopes,
// local persistence, achievements, and progression. The session owns the rules
// state; nothing else mutates it.

import * as Rules from './rules.js';
import { hashString } from './rng.js';

export const BUILD_VERSION = '1.0.0';
const SAVE_KEY = 'gravity-hollow:save:v1';
const SETTINGS_KEY = 'gravity-hollow:settings:v1';
const REPLAY_KEY = 'gravity-hollow:replays:v1';

// ------------------------------------------------------------ persistence

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const doc = JSON.parse(raw);
    if (doc && doc.v && doc.data && doc.checksum === checksum(doc.data)) return doc.data;
    return fallback; // checksum mismatch — treat as absent, never crash
  } catch { return fallback; }
}
function saveJson(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ v: 1, data, checksum: checksum(data) })); } catch { /* storage full/blocked */ }
}
function checksum(data) { return hashString(JSON.stringify(data)).toString(16); }

export function loadSave() {
  return loadJson(SAVE_KEY, {
    profile: { name: 'Wanderer', guest: true },
    journey: {},            // stageId -> { stars, best }
    tutorialsDone: {},      // learnId -> true
    daily: {},              // dateKey -> { score, place, excluded }
    challenges: {},         // id -> { done, best }
    achievements: {},       // key -> { at }
    cosmetics: { theme: null, trail: 'default' },
    masteryXp: 0,
    sessionsPlayed: 0,
    lastDailyKey: null,
  });
}
export function persistSave(save) { saveJson(SAVE_KEY, save); }

export const DEFAULT_SETTINGS = {
  music: 0.7, effects: 0.9, ambience: 0.5, voice: 0.8, muted: false,
  quality: 'auto',          // auto | low | medium | high
  reducedMotion: false, highContrast: false, largeText: false,
  palette: 'default',       // default | deuteranopia | protanopia | tritanopia
  leftHanded: false, holdBoost: true, timingAssist: false, haptics: true,
  cameraSway: true, captions: true,
  bindings: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], boost: ['ShiftLeft', 'ShiftRight', 'Space'], pause: ['Escape', 'KeyP'], undo: ['KeyZ'], hint: ['KeyH'], camera: ['KeyC'] },
};
export function loadSettings() {
  const s = loadJson(SETTINGS_KEY, null);
  return s ? { ...DEFAULT_SETTINGS, ...s, bindings: { ...DEFAULT_SETTINGS.bindings, ...(s.bindings ?? {}) } } : { ...DEFAULT_SETTINGS };
}
export function persistSettings(settings) { saveJson(SETTINGS_KEY, settings); }

// ----------------------------------------------------------- achievements
// Small static set; stable lowercase keys; idempotent unlocks.

export const ACHIEVEMENTS = {
  first_void:      { name: 'First Hollow', desc: 'Finish your first match.' },
  mechanic_master: { name: 'Full Toolkit', desc: 'Eat a prop, a gem, and a rival, and boost — in one match.' },
  streak_3:        { name: 'Habit Forming', desc: 'Play on three different days.' },
  journey_20:      { name: 'Half the Hollow', desc: 'Clear 20 Journey stages.' },
  mastery_clear:   { name: 'Mastery Proven', desc: 'Clear a Journey mastery stage.' },
  quiet_giant:     { name: 'Quiet Giant', desc: 'Finish a match with 300+ mass and zero deaths.' },
  long_table:      { name: 'Regular at the Plaza', desc: 'Play 25 sessions.' }, // accessibility-neutral long-term goal
};

// -------------------------------------------------------------- replays

export function loadReplays() { return loadJson(REPLAY_KEY, []); }
export function persistReplays(r) { saveJson(REPLAY_KEY, r.slice(-8)); }

// --------------------------------------------------------------- session

export class Session {
  // stage: content object; hooks: { onEvents(events), onPhase(phase, reason), onTick(state, alpha) }
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.hooks = opts.hooks ?? {};
    this.state = Rules.createMatch({ ...stage, playerName: opts.playerName ?? 'You' });
    this.paused = false;
    this.pauseReason = null;
    this.acc = 0;
    this.lastTime = null;
    this.raf = null;
    this.cmdSeq = 0;
    this.replay = {
      schema: 1, build: BUILD_VERSION, contentVersion: stage.version,
      seed: stage.seed, stageId: stage.id,
      initialHash: Rules.hashState(this.state),
      startedAt: Date.now(), commands: [], hashes: [], result: null,
    };
    this.undoStack = [];              // practice only
    this.undoAllowed = !!stage.undoAllowed;
    this.assists = opts.assists ?? {};
    this.solo = opts.solo !== false;
    this._tickCounter = 0;
    this._ended = false;
    this._bgPaused = false;
    this._visibilityHandler = () => {
      if (document.hidden) {
        if (this.solo && this.state.phase === 'active' && !this.paused) {
          this.paused = true; this.pauseReason = 'backgrounded'; this._bgPaused = true;
          this.hooks.onPhase?.('paused', 'backgrounded');
        }
      } else if (this._bgPaused) {
        // returning client gets a concise "while you were away" summary
        this._bgPaused = false;
        this.hooks.onPhase?.('resume-available', this.awaySummary());
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  awaySummary() {
    const me = this.state.voids[0];
    return `Paused while away. Mass ${Math.floor(me.mass)}, ${this.state.props.length} props in the plaza.`;
  }

  start() {
    this.lastTime = null;
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      if (this.lastTime == null) { this.lastTime = t; return; }
      let dt = (t - this.lastTime) / 1000;
      this.lastTime = t;
      if (dt > 0.25) dt = 0.25;              // tab-back clamp
      if (!this.paused && !Rules.isTerminal(this.state)) {
        this.acc += dt;
        const stepDt = Rules.DT;
        let guard = 0;
        while (this.acc >= stepDt && guard++ < 8) {
          this.acc -= stepDt;
          this.tickOnce();
        }
        if (guard >= 8) this.acc = 0;         // spiral-of-death guard
      }
      const alpha = Math.min(1, this.acc / Rules.DT);
      this.hooks.onFrame?.(this.state, alpha);
    };
    this.raf = requestAnimationFrame(loop);
  }

  tickOnce() {
    this._tickCounter++;
    const events = Rules.step(this.state);
    if (this._tickCounter % (Rules.TICK_RATE * 2) === 0) {
      this.replay.hashes.push({ step: this._tickCounter, tick: this.state.tick, hash: Rules.hashState(this.state) });
    }
    if (events.length) this.hooks.onEvents?.(events, this.state);
    if (Rules.isTerminal(this.state) && !this._ended) {
      this._ended = true;
      this.replay.result = {
        reason: Rules.terminalReason(this.state),
        finalHash: Rules.hashState(this.state),
        rankings: Rules.rankings(this.state).map(r => ({ id: r.id, place: r.place, mass: r.massCollected })),
      };
      this.hooks.onPhase?.('ended', Rules.terminalReason(this.state));
    }
  }

  // Validated command submission. Returns the engine verdict for UI feedback.
  submitMove(dx, dy, boost) {
    if (this.paused || Rules.isTerminal(this.state)) return { ok: false, reason: 'not_active' };
    const cmd = {
      id: `local-${this.stage.id}-${this.cmdSeq}`, voidId: 0, seq: this.cmdSeq++,
      type: 'move', dir: [Math.round(dx), Math.round(dy)], boost: !!boost,
    };
    const verdict = Rules.applyCommand(this.state, cmd);
    if (verdict.ok && !verdict.deduped) {
      this.replay.commands.push([this._tickCounter, cmd.seq, cmd.dir[0], cmd.dir[1], cmd.boost ? 1 : 0]);
      if (this.undoAllowed) this.pushUndo();
    }
    return verdict;
  }

  pushUndo() {
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.undoStack.push(Rules.serialize(this.state));
  }
  canUndo() { return this.undoAllowed && this.undoStack.length > 0 && !Rules.isTerminal(this.state); }
  undo() {
    if (!this.canUndo()) return { ok: false, reason: 'undo_unavailable' };
    // step back to the previous snapshot (discard current)
    this.undoStack.pop();
    const snap = this.undoStack.pop();
    if (!snap) return { ok: false, reason: 'undo_empty' };
    this.state = Rules.deserialize(snap);
    this.undoUsed = true;
    this.hooks.onPhase?.('undo', null);
    return { ok: true };
  }

  pause(reason = 'user') {
    if (Rules.isTerminal(this.state)) return;
    this.paused = true; this.pauseReason = reason;
    this.hooks.onPhase?.('paused', reason);
  }
  resume() {
    this.paused = false; this.pauseReason = null; this.lastTime = null;
    this.hooks.onPhase?.('resumed', null);
  }

  query() { return Rules.queryActions(this.state, 0); }

  finish() { // archive replay + return results payload
    const replays = loadReplays();
    replays.push(this.replay);
    persistReplays(replays);
    return {
      stage: this.stage,
      rankings: Rules.rankings(this.state),
      breakdown: Rules.scoreBreakdown(this.state, 0),
      terminalReason: Rules.terminalReason(this.state),
      goals: this.state.goals,
      replay: this.replay,
    };
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this._visibilityHandler);
  }
}

// Verify a replay envelope by re-simulating. Used by tests and the results screen.
export function verifyReplay(replay, stage) {
  const state = Rules.createMatch({ ...stage, playerName: 'Replay' });
  if (Rules.hashState(state) !== replay.initialHash) return { ok: false, why: 'initial_hash' };
  const byStep = new Map();
  for (const [step, seq, dx, dy, b] of replay.commands) {
    if (!byStep.has(step)) byStep.set(step, []);
    byStep.get(step).push({ id: `local-${stage.id}-${seq}`, voidId: 0, seq, type: 'move', dir: [dx, dy], boost: !!b });
  }
  let hi = 0, stepCount = 0;
  while (!Rules.isTerminal(state)) {
    for (const c of byStep.get(stepCount) ?? []) Rules.applyCommand(state, c);
    Rules.step(state);
    stepCount++;
    if (hi < replay.hashes.length && (replay.hashes[hi].step ?? replay.hashes[hi].tick) === stepCount) {
      if (replay.hashes[hi].hash !== Rules.hashState(state)) return { ok: false, why: `hash@step${stepCount}` };
      hi++;
    }
  }
  const finalOk = Rules.hashState(state) === replay.result?.finalHash;
  return { ok: finalOk, why: finalOk ? null : 'final_hash' };
}

// ------------------------------------------------------- progression logic

export function recordResult(save, session, results) {
  const stage = session.stage;
  const me = results.rankings.find(r => r.id === 0);
  const won = me?.place === 1;
  const goalsDone = results.goals.filter(g => g.done).length;
  save.sessionsPlayed++;

  if (stage.kind === 'journey') {
    const earned = Math.min(3, (won ? 1 : 0) +
      (results.goals.length > 0 && goalsDone >= results.goals.length ? 1 : 0) +
      (results.breakdown.survivalBonus > 0 ? 1 : 0));
    const prev = save.journey[stage.id] ?? { stars: 0, best: 0 };
    save.journey[stage.id] = { stars: Math.max(prev.stars, earned), best: Math.max(prev.best, results.breakdown.massCollected) };
    if (stage.mastery && won) unlock(save, 'mastery_clear');
    const cleared = Object.values(save.journey).filter(j => j.stars > 0).length;
    if (cleared >= 20) unlock(save, 'journey_20');
    save.masteryXp += results.breakdown.massCollected;
  } else if (stage.kind === 'daily' && !stage.excluded) {
    save.daily[stage.dateKey] = { score: results.breakdown.total, place: me?.place ?? 0 };
  } else if (stage.kind === 'challenge') {
    const prev = save.challenges[stage.id] ?? { done: false, best: 0 };
    save.challenges[stage.id] = { done: prev.done || won, best: Math.max(prev.best, results.breakdown.total) };
  } else if (stage.kind === 'learn') {
    save.tutorialsDone[stage.id] = true;
  }

  unlock(save, 'first_void');
  if (save.sessionsPlayed >= 25) unlock(save, 'long_table');
  const bd = results.breakdown;
  if (bd.props > 0 && bd.gems > 0 && bd.rivals > 0 && session.state.voids[0].boostsUsed > 0) unlock(save, 'mechanic_master');
  if (session.state.voids[0].mass >= 300 && session.state.voids[0].deaths === 0) unlock(save, 'quiet_giant');

  // day-streak tracking
  const today = new Date().toISOString().slice(0, 10);
  save.playDays = save.playDays ?? [];
  if (!save.playDays.includes(today)) save.playDays.push(today);
  if (save.playDays.length >= 3) unlock(save, 'streak_3');

  persistSave(save);
  return { won, goalsDone, newAchievements: [] };
}

export function unlock(save, key) {
  if (!ACHIEVEMENTS[key] || save.achievements[key]) return false;
  save.achievements[key] = { at: Date.now() };
  return true;
}
