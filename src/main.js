// Gravity Hollow — bootstrap & orchestration. Owns the app state machine:
// boot → title → mode-select → setup → countdown → active ↔ paused → results.
// Wires session (rules) ↔ renderer ↔ UI ↔ audio, and all input modalities.

import { Session, loadSave, persistSave, loadSettings, persistSettings, recordResult, verifyReplay } from './session.js';
import { Renderer } from './render.js';
import { UI, fmtTime } from './ui.js';
import { AudioEngine } from './audio.js';
import { journeyAll, challenges, practiceStage, tutorials, dailyStage, validateAll } from './content.js';
import * as Rules from './rules.js';
import { mulberry32 } from './rng.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.save = loadSave();
    this.settings = loadSettings();
    this.ui = new UI(this);
    this.audio = new AudioEngine(this.settings);
    this.audio.caption = (t) => this.ui.caption(t);
    this.session = null;
    this.renderer = null;
    this.prevState = null;
    this.keys = new Set();
    this.pointer = { active: false, id: null, x: 0, y: 0 };
    this.boostToggle = false;
    this.lastSent = { dx: 0, dy: 0, boost: false };
    this.gamepad = { active: false };
    this.tutorial = null;
    this.serverOffset = 0; // server-time offset for daily boundaries
    this.rafHandle = null;
    this.hudAcc = 0;
    this.matchFlow = 'title';
  }

  // ---------------------------------------------------------------- boot

  async boot() {
    $('boot-status').textContent = 'Checking plaza rules…';
    $('boot-progress').value = 30;
    // content validation runs at boot (dev evidence) — never blocks play
    try {
      const report = validateAll();
      const bad = report.filter(([, r]) => !r.ok);
      if (bad.length) console.warn('[content] validation issues', bad);
    } catch (e) { console.warn('[content] validator failed', e); }

    $('boot-status').textContent = 'Syncing clock…';
    $('boot-progress').value = 50;
    await this.syncTime();

    $('boot-status').textContent = 'Raising the plaza…';
    $('boot-progress').value = 75;
    try {
      this.renderer = new Renderer($('game-canvas'), this.settings);
    } catch (e) {
      console.error('WebGL unavailable', e);
      for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
      $('compat').classList.remove('hidden');
      return;
    }
    this.applySettings();
    this.renderer.onContextLost = () => this.ui.toast('Graphics context lost — restoring…');
    this.bindChrome();
    this.bindInput();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 60));

    // idle scene behind the title
    this.idleStage = practiceStage('standard');
    this.renderer.loadStage(this.idleStage, null);

    $('boot-progress').value = 100;
    this.ui.updateTitle(this.save);
    this.refreshDailyLine();
    this.ui.show('title');
    this.matchFlow = 'title';
    this.startRenderLoop();
    // first meaningful action < 20s target: Play is one tap away.

    // headless smoke autopilot: ?smoke starts a practice match and self-drives
    if (new URLSearchParams(location.search).has('smoke')) this.runSmoke();
  }

  runSmoke() {
    this.smokeMode = true;
    this.pendingStage = practiceStage('standard');
    this.beginMatch();
    this.smokeInput = [0, 0];
    const iv = setInterval(() => {
      const s = this.session?.state;
      if (!s) return;
      if (s.phase === 'active') {
        const me = s.voids[0];
        let best = null, bd = 1e9;
        for (const p of s.props) {
          if (p.k === 'ember' || p.m > me.mass * 0.5) continue;
          const d = Math.hypot(p.x - me.x, p.y - me.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const dx = best.x - me.x, dy = best.y - me.y, m = Math.hypot(dx, dy) || 1;
          this.session.submitMove(Math.round(dx / m * 100), Math.round(dy / m * 100), false);
        }
      }
      // headless rAF can starve; step the sim directly in smoke mode
      for (let i = 0; i < 4 && !Rules.isTerminal(s); i++) this.session.tickOnce();
      if (s.tick >= 300 && !this._smokeMid) {
        this._smokeMid = true;
        console.log('SMOKE_OK', JSON.stringify({
          phase: s.phase, tick: s.tick, mass: Math.round(s.voids[0].mass),
          props: s.props.length, eaten: s.stats.eaten,
          drawCalls: this.renderer.three.info.render.calls,
          triangles: this.renderer.three.info.render.triangles,
        }));
      }
      if (Rules.isTerminal(s)) {
        clearInterval(iv);
        console.log('SMOKE_END', JSON.stringify({
          reason: s.terminalReason, mass: Math.round(s.voids[0].mass),
          resultsVisible: !document.getElementById('screen-results').classList.contains('hidden'),
          replayNote: document.getElementById('results-replay')?.textContent,
        }));
      }
    }, 16);
  }

  async syncTime() {
    // Synchronize with the platform clock (same-origin /api/v1/time), using
    // round-trip adjustment; fall back to local time when offline.
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { cache: 'no-store' });
      if (!res.ok) throw new Error('no time');
      const t1 = Date.now();
      const body = await res.json();
      // Hosts expose the epoch under different keys (`epochMs`, `serverTime`, `now`).
      const epoch = Number(body.epochMs ?? body.serverTime ?? body.now);
      if (!Number.isFinite(epoch)) throw new Error('no time');
      const serverMs = epoch + (t1 - t0) / 2;
      this.serverOffset = serverMs - t1;
    } catch { this.serverOffset = 0; }
  }
  now() { return Date.now() + this.serverOffset; }
  utcDateKey() { return new Date(this.now()).toISOString().slice(0, 10); }

  refreshDailyLine() {
    const key = this.utcDateKey();
    const next = new Date(this.now());
    next.setUTCHours(24, 0, 0, 0);
    const leftMs = next.getTime() - this.now();
    const hrs = Math.floor(leftMs / 3600000), mins = Math.floor((leftMs % 3600000) / 60000);
    const played = this.save.daily[key];
    this.ui.setDailySub(played ? `done · ${played.score} pts` : `new in ${hrs}h ${mins}m`);
  }

  // ------------------------------------------------------------ chrome

  bindChrome() {
    $('btn-play').addEventListener('click', () => { this.audio.event('ui_confirm'); this.showModes(); });
    $('btn-daily').addEventListener('click', () => { this.audio.event('ui_confirm'); this.openDaily(); });
    $('btn-journey').addEventListener('click', () => { this.audio.event('ui_confirm'); this.showJourney(); });
    $('btn-profile').addEventListener('click', () => { this.audio.event('ui_confirm'); this.ui.buildProfile(this.save); this.ui.show('profile'); });
    $('btn-help').addEventListener('click', () => { this.audio.event('ui_confirm'); this.ui.buildHelp(this.settings); this.ui.overlay('help'); });
    $('btn-settings').addEventListener('click', () => { this.audio.event('ui_confirm'); this.ui.overlay('settings'); });
    $('btn-help-close').addEventListener('click', () => this.ui.back());
    $('btn-settings-close').addEventListener('click', () => this.ui.back());
    $('btn-replay-tutorial').addEventListener('click', () => { this.startLearn(0); });

    this.ui.bindSettings(this.settings, () => this.applySettings(true));

    // HUD & pause
    $('btn-pause').addEventListener('click', () => this.pauseMatch());
    $('btn-resume').addEventListener('click', () => this.resumeMatch());
    $('btn-pause-settings').addEventListener('click', () => this.ui.overlay('settings'));
    $('btn-pause-help').addEventListener('click', () => { this.ui.buildHelp(this.settings); this.ui.overlay('help'); });
    $('btn-restart').addEventListener('click', () => this.restartMatch());
    $('btn-leave').addEventListener('click', () => this.leaveMatch());
    $('btn-start-match').addEventListener('click', () => { this.audio.event('ui_confirm'); this.beginMatch(); });

    // results
    $('btn-retry').addEventListener('click', () => this.restartMatch());
    $('btn-results-home').addEventListener('click', () => this.goHome());
    $('btn-next').addEventListener('click', () => this.nextRecommended());

    // tray
    $('btn-undo').addEventListener('click', () => this.doUndo());
    $('btn-hint').addEventListener('click', () => this.doHint());
    $('btn-camera').addEventListener('click', () => { this.renderer.frameCamera(this.session?.state.arena.half ?? 40, true); this.audio.event('ui_move'); });
    const boostBtn = $('btn-boost');
    const press = (on) => (e) => {
      e.preventDefault();
      if (this.settings.holdBoost) this.boostHeld = on;
      else if (on) this.boostToggle = !this.boostToggle;
      boostBtn.classList.toggle('active', this.settings.holdBoost ? on : this.boostToggle);
    };
    boostBtn.addEventListener('pointerdown', press(true));
    boostBtn.addEventListener('pointerup', press(false));
    boostBtn.addEventListener('pointercancel', press(false));
  }

  applySettings(persist = false) {
    const s = this.settings;
    document.body.classList.toggle('large-text', s.largeText);
    document.body.classList.toggle('high-contrast', s.highContrast);
    document.body.classList.toggle('left-handed', s.leftHanded);
    this.audio.applySettings();
    if (this.renderer) {
      const tier = s.quality === 'auto' ? autoTier() : s.quality;
      if (tier !== this.renderer.quality) this.renderer.setQuality(tier);
      this.renderer.setReducedMotion(s.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    if (persist) { persistSettings(s); this.ui.toast('Settings saved'); }
  }

  persistAll() { persistSave(this.save); persistSettings(this.settings); }

  onResize() { this.renderer?.resize(); }

  // ---------------------------------------------------------- navigation

  showModes() {
    const cards = [
      { name: 'Learn', desc: 'Five short lessons. One rule at a time.', badge: this.learnDone() ? 'complete' : 'start here', onPick: () => this.startLearn(this.nextLearnIndex()) },
      { name: 'Journey', desc: '40 authored stages with mastery tests.', onPick: () => this.showJourney() },
      { name: 'Daily Hollow', desc: 'One shared seed per UTC day. Everyone gets the same plaza.', badge: 'ranked', onPick: () => this.openDaily() },
      { name: 'Practice', desc: 'Relaxed play with undo. Never rated.', onPick: () => this.openPractice() },
      { name: 'Challenges', desc: 'Move limits, no boost, cramped courts…', onPick: () => this.openChallenges() },
      { name: 'Hosted Play', desc: 'Private rooms & quick match (when hosted).', badge: 'beta', onPick: () => this.openHosted() },
    ];
    this.ui.buildModeCards(cards);
    this.ui.show('modes');
  }

  showJourney() {
    this.ui.buildJourney(this.save, journeyAll(), (stage) => this.openSetup(stage));
    this.ui.show('journey');
  }

  learnDone() { return tutorials().every(t => this.save.tutorialsDone[t.id]); }
  nextLearnIndex() { const t = tutorials(); for (let i = 0; i < t.length; i++) if (!this.save.tutorialsDone[t[i].id]) return i; return 0; }

  openDaily() {
    const key = this.utcDateKey();
    const excluded = (this.save.dailyExcluded ?? []).includes(key);
    this.openSetup(dailyStage(key, excluded));
  }
  openPractice() {
    // difficulty picker as mode cards
    this.ui.buildModeCards(['relaxed', 'standard', 'intense'].map(d => ({
      name: `Practice — ${d}`, desc: d === 'relaxed' ? 'No rivals, no embers. Just drift and eat.'
        : d === 'standard' ? 'One gentle rival.' : 'Two hungry rivals, embers about.',
      badge: 'unrated · undo on',
      onPick: () => this.openSetup(practiceStage(d)),
    })));
    this.ui.show('modes');
  }
  openChallenges() {
    this.ui.buildModeCards(challenges().map(c => ({
      name: c.name, desc: c.description,
      badge: this.save.challenges[c.id]?.done ? 'cleared' : 'ranked',
      onPick: () => this.openSetup(c),
    })));
    this.ui.show('modes');
  }
  openHosted() {
    // Hosted play requires the StarHermit host (server.js). Same-origin /ws is
    // probed; without it we offer a local lobby with AI seats.
    this.ui.buildModeCards([
      { name: 'Quick Match', desc: '4 voids, 2 minutes. AI fills empty seats.', badge: 'local lobby', onPick: () => this.openSetup(this.hostedStage(4, 120)) },
      { name: 'Big Table', desc: '8 voids, 3 minutes, crowded plaza.', badge: 'local lobby', onPick: () => this.openSetup(this.hostedStage(8, 180)) },
    ]);
    this.ui.show('modes');
  }
  hostedStage(seats, durationSec) {
    const names = ['Pip', 'Sorrel', 'Bram', 'Nettle', 'Cobb', 'Wren', 'Tansy'];
    const seed = (Date.now() % 0x7fffffff) >>> 0;
    const rng = mulberry32(seed);
    return {
      id: `hosted-${seed}`, kind: 'hosted', version: 1, seed,
      name: `Hosted Table (${seats} seats)`, theme: 'tide', arenaHalf: 46,
      obstacles: [], durationSec,
      rivals: names.slice(0, seats - 1).map(n => ({ name: n, skill: 0.45 + rng() * 0.3, massScale: 1 })),
      emberCount: 6, propTarget: 110,
      propWeights: { crumb: 42, chunk: 30, boulder: 17, gem: 8, ember: 3 },
      goals: [], boost: 'on',
      description: 'Local lobby with AI seats. Connect via server.js for real seats.',
    };
  }

  openSetup(stage) {
    this.pendingStage = stage;
    this.ui.buildSetup(stage, stage);
    this.ui.show('setup');
  }

  startLearn(index) {
    const lesson = tutorials()[index];
    this.pendingStage = lesson;
    this.beginMatch();
  }

  // ------------------------------------------------------------- match

  beginMatch() {
    const stage = this.pendingStage;
    if (!stage) return;
    this.endSession();
    this.ui.showNone();
    this.ui.showHud(true);
    this.ui.setUndoVisible(!!stage.undoAllowed);
    this.prevState = null;
    this.matchFlow = 'playing';

    this.session = new Session(stage, {
      playerName: this.save.profile.name,
      hooks: {
        onEvents: (events, state) => this.onEvents(events, state),
        onPhase: (phase, reason) => this.onPhase(phase, reason),
        onFrame: (state, alpha) => this.onFrame(state, alpha),
      },
    });
    this.renderer.loadStage(stage, this.session.state);
    this.audio.ensure();
    this.audio.resume();
    this.audio.startMusic(stage.theme);
    this.audio.startAmbience(stage.theme);
    this.audio.setIntensity(0.3);
    this.ui.announce(`${stage.name}. ${stage.goals?.length ? stage.goals.map(g => g.type).join(', ') : 'Outscore every rival.'}`, true);

    // tutorial controller for Learn mode
    this.tutorial = stage.kind === 'learn' ? new TutorialRun(stage, this) : null;
    this.session.start();
  }

  restartMatch() {
    this.audio.event('ui_confirm');
    this.beginMatch();
  }

  pauseMatch() {
    if (!this.session) return;
    this.session.pause('user');
    $('pause-away').textContent = '';
    this.ui.show('pause');
    this.audio.event('ui_back');
  }
  resumeMatch() {
    this.ui.showNone();
    this.session?.resume();
    this.audio.event('ui_confirm');
  }
  leaveMatch() {
    this.audio.event('ui_back');
    this.endSession();
    this.goHome();
  }
  goHome() {
    this.endSession();
    this.ui.showHud(false);
    this.ui.tutorialBanner(null);
    this.ui.updateTitle(this.save);
    this.refreshDailyLine();
    this.ui.show('title');
    this.matchFlow = 'title';
    this.renderer.loadStage(this.idleStage, null);
    this.audio.stopMusic();
  }

  endSession() {
    if (this.session) { this.session.destroy(); this.session = null; }
    this.tutorial = null;
    this.ui.countdown(null);
  }

  onPhase(phase, reason) {
    if (phase === 'paused' && reason === 'backgrounded') {
      $('pause-away').textContent = 'Paused because the tab was hidden.';
      this.ui.show('pause');
    } else if (phase === 'resume-available') {
      $('pause-away').textContent = reason ?? '';
    } else if (phase === 'ended') {
      this.finishMatch();
    } else if (phase === 'undo') {
      this.audio.event('undo');
      this.ui.toast('Undone');
    }
  }

  onEvents(events, state) {
    this.frameEvents = (this.frameEvents ?? []).concat(events);
    for (const e of events) {
      switch (e.t) {
        case 'start':
          this.ui.countdown('GO');
          this.audio.event('go');
          setTimeout(() => this.ui.countdown(null), 600);
          this.ui.announce('Go!', true);
          break;
        case 'eat': if (e.id === 0) { this.audio.event('eat', { mass: e.m }); this.haptic(8); } break;
        case 'eat_gem': if (e.id === 0) { this.audio.event('eat_gem'); this.haptic(15); this.ui.announce('Gem consumed'); } break;
        case 'eat_void':
          this.audio.event('eat_void');
          this.haptic(40);
          this.ui.announce(e.id === 0 ? `You swallowed ${state.voids[e.victim].name}!` : `${state.voids[e.id].name} swallowed ${state.voids[e.victim].name}`, e.id !== 0 && e.victim === 0);
          break;
        case 'burn': if (e.id === 0) { this.audio.event('burn'); this.haptic(25); this.ui.announce('Burned by an ember'); } break;
        case 'boost': if (e.id === 0) this.audio.event('boost'); break;
        case 'respawn': if (e.id === 0) { this.audio.event('respawn'); this.ui.announce('You respawned'); } break;
        case 'goal': this.audio.event('goal'); this.ui.toast('Objective complete!'); break;
        case 'move_limit': if (e.ids.includes(0)) this.ui.toast('Out of movement!'); break;
      }
      this.tutorial?.onEvent(e, state);
    }
  }

  onFrame(state, alpha) {
    // DOM HUD at ~5Hz; canvas every frame
    this.hudAcc++;
    if (this.hudAcc % 12 === 0) {
      this.ui.updateHud(state, this.session.stage, this.session.query());
      this.audio.setIntensity(0.3 + 0.6 * (state.tick / state.config.durationTicks));
    }
    // countdown numbers
    if (state.phase === 'countdown') {
      const n = Math.ceil(state.countdownTicks / 30);
      this.ui.countdown(String(n));
      if (n !== this._lastCount) { this._lastCount = n; this.audio.event('countdown'); }
    }
    this.tutorial?.onFrame(state);
  }

  finishMatch() {
    const results = this.session.finish();
    this.ui.countdown(null);
    this.audio.stopMusic();
    const me = results.rankings.find(r => r.id === 0);
    this.audio.event(me?.place === 1 ? 'round_end' : 'defeat');

    const before = new Set(Object.keys(this.save.achievements));
    recordResult(this.save, this.session, results);
    const after = Object.keys(this.save.achievements).filter(k => !before.has(k));
    for (const k of after) {
      this.audio.event('achievement');
      this.ui.toast(`Achievement: ${k.replace(/_/g, ' ')}`);
    }

    // verify our own replay as tamper evidence (skipped if undo rewrote history)
    const check = this.session.undoUsed
      ? { ok: true, skipped: true }
      : verifyReplay(results.replay, this.session.stage);
    $('results-replay').textContent = check.skipped
      ? 'Practice mode — replay not ranked'
      : check.ok ? `Replay verified · ${results.replay.result.finalHash}` : `Replay mismatch (${check.why})`;

    const progress = this.session.stage.kind === 'journey'
      ? `${Object.keys(this.save.journey).length} of 40 stages cleared`
      : this.session.stage.kind === 'daily' ? 'Daily result recorded' : '';
    this.ui.showResults(results, progress);
    this.matchFlow = 'results';
  }

  nextRecommended() {
    const stage = this.session?.stage;
    this.audio.event('ui_confirm');
    if (stage?.kind === 'learn') {
      const idx = tutorials().findIndex(t => t.id === stage.id);
      if (idx + 1 < tutorials().length) { this.startLearn(idx + 1); return; }
      this.goHome(); return;
    }
    if (stage?.kind === 'journey') {
      const next = journeyAll().find(s => !this.save.journey[s.id]);
      if (next) { this.openSetup(next); return; }
    }
    this.goHome();
  }

  // --------------------------------------------------------------- input

  bindInput() {
    const canvas = $('game-canvas');
    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = this.settings.bindings;
      if (b.pause.includes(e.code)) {
        if (this.matchFlow === 'playing') {
          if (this.ui.current === 'pause') this.resumeMatch(); else this.pauseMatch();
        }
      }
      if (this.matchFlow === 'playing' && this.ui.current === null) {
        if (b.undo.includes(e.code)) this.doUndo();
        if (b.hint.includes(e.code)) this.doHint();
        if (b.camera.includes(e.code)) this.renderer.frameCamera(this.session?.state.arena.half ?? 40, true);
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // pointer: drag to steer, with pointer capture and safe cancel
    canvas.addEventListener('pointerdown', (e) => {
      if (this.matchFlow !== 'playing') return;
      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.pointer.x = e.clientX; this.pointer.y = e.clientY;
      this.pointer.startX = e.clientX; this.pointer.startY = e.clientY;
      this.pointer.startT = performance.now();
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.pointer.active && e.pointerId === this.pointer.id) { this.pointer.x = e.clientX; this.pointer.y = e.clientY; }
    });
    const endPointer = (e) => {
      if (e.pointerId !== this.pointer.id) return;
      this.pointer.active = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', () => { this.pointer.active = false; });

    // first gesture unlocks audio
    document.addEventListener('pointerdown', () => { this.audio.ensure(); this.audio.resume(); }, { once: true });
    document.addEventListener('keydown', () => { this.audio.ensure(); this.audio.resume(); }, { once: true });
  }

  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.18) {
        this.padDir = [Math.round(ax / Math.max(1, mag) * 100), Math.round(ay / Math.max(1, mag) * 100)];
      } else this.padDir = null;
      this.padBoost = p.buttons[0]?.pressed || p.buttons[7]?.pressed;
      if (p.buttons[9]?.pressed && !this._padStart && this.matchFlow === 'playing') {
        this.ui.current === 'pause' ? this.resumeMatch() : this.pauseMatch();
      }
      this._padStart = p.buttons[9]?.pressed;
      return;
    }
    this.padDir = null; this.padBoost = false;
  }

  computeInput() {
    if (this.smokeInput) return { dx: this.smokeInput[0], dy: this.smokeInput[1], boost: false };
    const b = this.settings.bindings;
    let dx = 0, dy = 0;
    if (b.left.some(k => this.keys.has(k))) dx -= 100;
    if (b.right.some(k => this.keys.has(k))) dx += 100;
    if (b.up.some(k => this.keys.has(k))) dy -= 100;
    if (b.down.some(k => this.keys.has(k))) dy += 100;
    let boost = b.boost.some(k => this.keys.has(k));

    // pointer drag: steer toward the pointer relative to the player's screen pos
    if (this.pointer.active && this.session) {
      const me = this.session.state.voids[0];
      const p = this.renderer.projectToScreen(me.x, me.y);
      const vx = this.pointer.x - p.x, vy = this.pointer.y - p.y;
      const dist = Math.hypot(vx, vy);
      if (dist > 24) { // dead zone distinguishes tap/drag
        dx = Math.round(vx / dist * 100);
        dy = Math.round(vy / dist * 100);
      } else { dx = 0; dy = 0; }
    }
    if (this.padDir) { dx = this.padDir[0]; dy = this.padDir[1]; }
    boost = boost || this.padBoost || this.boostHeld || (!this.settings.holdBoost && this.boostToggle);

    const mag = Math.hypot(dx, dy);
    if (mag > 100) { dx = Math.round(dx / mag * 100); dy = Math.round(dy / mag * 100); }
    return { dx, dy, boost };
  }

  doUndo() {
    if (!this.session) return;
    const r = this.session.undo();
    if (!r.ok) { this.audio.event('invalid'); this.ui.toast(r.reason === 'undo_empty' ? 'Nothing to undo' : 'Undo is not available in this mode'); }
  }

  doHint() {
    if (!this.session) return;
    // hints use the same legal-action query as play
    const q = this.session.query();
    this.audio.event('hint');
    let msg;
    if (!q.canMove) msg = q.moveReason === 'respawning' ? 'You are respawning — hang tight.' : q.moveReason === 'move_limit' ? 'No movement left — make peace with the plaza.' : 'Waiting for the round…';
    else if (q.hazards.length) msg = 'Danger close: a bigger void or an ember is near. Steer away!';
    else if (q.edible.length) {
      const gems = q.edible.filter(e => e.kind === 'prop' && e.mass >= 15);
      msg = gems.length ? 'A gem is in reach — go gleam hunting!' : `${q.edible.length} things nearby are edible. Dimmer than you = dinner.`;
    } else msg = 'Nothing edible right here. Drift toward open pavement and look for highlights.';
    this.ui.toast(msg, 4200);
    this.ui.announce(msg);
  }

  haptic(ms) { if (this.settings.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch {} }

  // ------------------------------------------------------------ main loop

  startRenderLoop() {
    const loop = () => {
      this.rafHandle = requestAnimationFrame(loop);
      const playing = this.session && this.matchFlow === 'playing' && this.ui.current !== 'pause' && !this.smokeMode;
      if (playing && !document.hidden) {
        this.pollGamepad();
        const { dx, dy, boost } = this.computeInput();
        // command-identifier dedupe: only submit when intent changes
        if (dx !== this.lastSent.dx || dy !== this.lastSent.dy || boost !== this.lastSent.boost) {
          const verdict = this.session.submitMove(dx, dy, boost);
          if (!verdict.ok && verdict.reason && verdict.reason !== 'not_active' && verdict.reason !== 'cannot_move') {
            this.ui.announce(`Action rejected: ${verdict.reason}`);
          }
          this.lastSent = { dx, dy, boost };
        }
      }
      if (this.session) {
        const curr = this.session.state;
        const evts = this.frameEvents ?? [];
        this.frameEvents = [];
        this.renderer.syncSnapshot(this.prevState ?? curr, curr, 1, evts);
        this.prevState = curr;
      }
      this.updateLabels();
      if (!document.hidden) this.renderer.render();
    };
    loop();
  }

  updateLabels() {
    const host = $('labels');
    if (!this.session || this.matchFlow !== 'playing') { host.innerHTML = ''; this._labelEls = null; return; }
    const voids = this.session.state.voids;
    if (!this._labelEls || this._labelEls.length !== voids.length) {
      host.innerHTML = '';
      this._labelEls = voids.map(v => {
        const el = document.createElement('div');
        el.className = 'void-label';
        host.appendChild(el);
        return el;
      });
    }
    voids.forEach((v, i) => {
      const el = this._labelEls[i];
      if (!v.alive) { el.style.display = 'none'; return; }
      const p = this.renderer.projectToScreen(v.x, v.y, v.r * 1.6);
      el.style.display = p.visible ? '' : 'none';
      el.style.left = `${p.x}px`; el.style.top = `${p.y}px`;
      el.textContent = `${v.id === 0 ? '▶ ' : ''}${v.name} · ${Math.floor(v.mass)}`;
    });
  }
}

// ---------------------------------------------------------------- tutorial

class TutorialRun {
  constructor(stage, app) {
    this.app = app;
    this.steps = stage.steps ?? [];
    this.index = 0;
    this.count = 0;
    this.moveTicks = 0;
    this.markersDone = 0;
    this.rng = mulberry32(stage.seed ^ 0xBEEF);
    this.setupStep();
  }
  get step() { return this.steps[this.index]; }
  setupStep() {
    const s = this.step;
    if (!s) { this.app.ui.tutorialBanner(null); return; }
    this.count = 0;
    this.app.ui.tutorialBanner(s, () => this.advance(true));
    this.app.ui.announce(s.text, true);
    if (s.require.type === 'visit_markers') {
      const half = this.app.session.state.arena.half;
      this.markers = [];
      for (let i = 0; i < s.require.count; i++) {
        this.markers.push({ x: (this.rng() * 2 - 1) * (half - 8), y: (this.rng() * 2 - 1) * (half - 8) });
      }
      this.app.renderer.setMarkers(this.markers);
    } else this.app.renderer.setMarkers([]);
  }
  advance(skip = false) {
    if (!skip) this.app.audio.event('goal');
    this.index++;
    if (this.index >= this.steps.length) {
      this.app.ui.tutorialBanner(null);
      this.app.renderer.setMarkers([]);
      this.app.ui.toast('Lesson complete!');
      // end the lesson; the session loop detects the terminal state and
      // produces results (which records tutorial completion)
      this.app.session.state.phase = 'ended';
      this.app.session.state.terminalReason = 'lesson_complete';
      return;
    }
    this.setupStep();
  }
  onEvent(e, state) {
    const s = this.step;
    if (!s) return;
    const r = s.require;
    if (r.type === 'eat' && e.t === 'eat' && e.id === 0) this.count++;
    else if (r.type === 'eat_kind' && e.id === 0) {
      const kindMass = { chunk: 3, boulder: 8 }[r.kind];
      if (r.kind === 'gem' && e.t === 'eat_gem') this.count++;
      else if (e.t === 'eat' && e.m === kindMass) this.count++;
    }
    else if (r.type === 'boost' && e.t === 'boost' && e.id === 0) this.count++;
    else if (r.type === 'eat_rival' && e.t === 'eat_void' && e.id === 0) this.count++;
    else return;
    if (this.count >= (r.count ?? 1)) this.advance();
  }
  onFrame(state) {
    const s = this.step;
    if (!s) return;
    const r = s.require;
    if (r.type === 'move_ticks') {
      const me = state.voids[0];
      if (Math.hypot(me.vx, me.vy) > 1) this.count++;
      if (this.count >= r.count) this.advance();
    } else if (r.type === 'visit_markers' && this.markers?.length) {
      const me = state.voids[0];
      for (let i = this.markers.length - 1; i >= 0; i--) {
        const m = this.markers[i];
        if (Math.hypot(me.x - m.x, me.y - m.y) < 2.6) {
          this.markers.splice(i, 1);
          this.app.audio.event('eat_gem');
          this.count++;
        }
      }
      this.app.renderer.setMarkers(this.markers);
      if (this.count >= r.count) this.advance();
    } else if (r.type === 'finish' && state.phase === 'ended') {
      this.advance();
    }
  }
}

function autoTier() {
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) || navigator.maxTouchPoints > 2;
  const dpr = window.devicePixelRatio || 1;
  if (mobile) return 'low';
  return dpr > 1.5 ? 'high' : 'medium';
}

// boot
const app = new App();
window.addEventListener('error', (e) => {
  console.error('fatal', e.error ?? e.message);
  $('boot-status').textContent = `Something failed to load: ${e.message}`;
});
app.boot();
