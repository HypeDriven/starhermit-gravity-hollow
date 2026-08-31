// Gravity Hollow — procedural audio. Original short transients tied to logical
// events, layered material impacts, quiet ambience, and adaptive music stems.
// Buses: music / effects / ambience / voice, each with its own slider.
// Pitch variants are seeded so replays sound consistent.
// Authored one-shots (sfx/<name>.opus, see sfx/manifest.json) are preferred
// per event once decoded; synthesis below remains the fallback while a clip
// is loading or unavailable.

import { mulberry32 } from './rng.js';

// event name -> authored sample basename (sfx/<basename>.opus)
const SFX_SAMPLES = {
  ui_move: 'ui-move', ui_confirm: 'ui-confirm', ui_back: 'ui-back',
  invalid: 'invalid-buzz', eat: 'eat-morsel', eat_gem: 'eat-gem',
  eat_void: 'eat-void', burn: 'ember-burn', boost: 'boost-whoosh',
  respawn: 'respawn-bloom', goal: 'goal-chime', countdown: 'countdown-tick',
  go: 'go-signal', round_end: 'round-end-fanfare', defeat: 'defeat-fall',
  undo: 'undo-rewind', hint: 'hint-spark', achievement: 'achievement-unlock',
};

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buses = {};
    this.started = false;
    this.musicTimer = null;
    this.ambNodes = [];
    this.rng = mulberry32(0xC0FFEE);
    this.caption = null;   // fn(text) for captions/text cues
    this.samples = new Map(); // basename -> { state: 'loading'|'ready'|'failed', buffer }
  }

  ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.master = master;
      for (const bus of ['music', 'effects', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.gain.value = this.level(bus);
        g.connect(master);
        this.buses[bus] = g;
      }
      this.applyMute();
      return true;
    } catch { return false; }
  }

  level(bus) { return this.settings.muted ? 0 : (this.settings[bus] ?? 0.8); }
  applySettings() {
    if (!this.ctx) return;
    for (const bus of Object.keys(this.buses)) this.buses[bus].gain.value = this.level(bus);
    this.applyMute();
  }
  applyMute() { if (this.master) this.master.gain.value = this.settings.muted ? 0 : 1; }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx?.state === 'running') this.ctx.suspend(); }

  say(text) { this.caption?.(text); }

  // ---- primitive synth helpers -------------------------------------------

  blip({ bus = 'effects', f0 = 440, f1 = null, dur = 0.12, type = 'sine', gain = 0.3, when = 0 }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.buses[bus]);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise({ bus = 'effects', dur = 0.15, gain = 0.2, freq = 1200, q = 1, when = 0, type = 'bandpass' }) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.rng() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.buses[bus]);
    src.start(t);
  }

  // ---- authored samples: lazy fetch/decode/cache after gesture unlock -----

  // Returns true when the clip played; false means fall back to synthesis.
  playSample(basename) {
    if (!this.ensure()) return false;
    const entry = this.samples.get(basename);
    if (entry?.state === 'ready') {
      const src = this.ctx.createBufferSource();
      src.buffer = entry.buffer;
      src.connect(this.buses.effects);
      src.start();
      return true;
    }
    if (!entry) {
      this.samples.set(basename, { state: 'loading' });
      fetch(`sfx/${basename}.opus`)
        .then(r => { if (!r.ok) throw new Error(`sfx ${r.status}`); return r.arrayBuffer(); })
        .then(ab => this.ctx.decodeAudioData(ab))
        .then(buffer => this.samples.set(basename, { state: 'ready', buffer }))
        .catch(() => this.samples.set(basename, { state: 'failed' }));
    }
    return false;
  }

  // ---- event mapping (event hierarchy: ack < move < combo/goal < round) ---

  event(name, opts = {}) {
    if (this.settings.muted) { this.say(captionFor(name, opts)); return; }
    this.resume();
    const sample = SFX_SAMPLES[name];
    if (sample && this.playSample(sample)) { this.say(captionFor(name, opts)); return; }
    const v = 1 + (this.rng() - 0.5) * 0.12; // seeded pitch variant
    switch (name) {
      case 'ui_move': this.blip({ f0: 620 * v, f1: 700 * v, dur: 0.05, gain: 0.08 }); break;
      case 'ui_confirm': this.blip({ f0: 520 * v, f1: 780 * v, dur: 0.09, gain: 0.14 }); break;
      case 'ui_back': this.blip({ f0: 480 * v, f1: 320 * v, dur: 0.09, gain: 0.12 }); break;
      case 'invalid': this.blip({ f0: 200, f1: 140, dur: 0.14, type: 'square', gain: 0.1 }); break;
      case 'eat': {
        const s = Math.min(1, (opts.mass ?? 1) / 20);
        this.noise({ dur: 0.07, gain: 0.10 + s * 0.12, freq: 900 + s * 700 });
        this.blip({ f0: (300 + s * 260) * v, f1: (500 + s * 320) * v, dur: 0.08, gain: 0.12 });
        break;
      }
      case 'eat_gem':
        this.blip({ f0: 880 * v, f1: 1320 * v, dur: 0.16, gain: 0.16 });
        this.blip({ f0: 1320 * v, f1: 1760 * v, dur: 0.2, gain: 0.1, when: 0.06 });
        break;
      case 'eat_void':
        this.noise({ dur: 0.3, gain: 0.3, freq: 300, q: 0.8 });
        this.blip({ f0: 180, f1: 60, dur: 0.35, type: 'sawtooth', gain: 0.2 });
        this.blip({ f0: 660, f1: 990, dur: 0.25, gain: 0.12, when: 0.12 });
        break;
      case 'burn':
        this.noise({ dur: 0.22, gain: 0.22, freq: 2400, q: 2 });
        this.blip({ f0: 320, f1: 120, dur: 0.2, type: 'square', gain: 0.1 });
        break;
      case 'boost': this.noise({ dur: 0.25, gain: 0.14, freq: 600, q: 0.6, type: 'highpass' }); break;
      case 'respawn': this.blip({ f0: 240, f1: 480, dur: 0.3, gain: 0.14 }); break;
      case 'goal':
        [523, 659, 784].forEach((f, i) => this.blip({ f0: f * v, dur: 0.18, gain: 0.14, when: i * 0.09 }));
        break;
      case 'countdown': this.blip({ f0: 440, dur: 0.1, gain: 0.16, bus: 'voice' }); break;
      case 'go': this.blip({ f0: 660, f1: 990, dur: 0.25, gain: 0.2, bus: 'voice' }); break;
      case 'round_end':
        [392, 523, 659, 784].forEach((f, i) => this.blip({ f0: f, dur: 0.3, gain: 0.16, when: i * 0.14, bus: 'voice' }));
        break;
      case 'defeat':
        [440, 415, 392, 330].forEach((f, i) => this.blip({ f0: f, dur: 0.3, gain: 0.12, when: i * 0.15, bus: 'voice' }));
        break;
      case 'undo': this.blip({ f0: 500, f1: 350, dur: 0.12, gain: 0.12 }); break;
      case 'hint': this.blip({ f0: 990, f1: 1240, dur: 0.1, gain: 0.1 }); break;
      case 'achievement':
        [659, 784, 1046, 1318].forEach((f, i) => this.blip({ f0: f, dur: 0.22, gain: 0.14, when: i * 0.08, bus: 'voice' }));
        break;
    }
    this.say(captionFor(name, opts));
  }

  // ---- adaptive music: quiet plucked pattern that intensifies near the end -

  startMusic(themeId = 'verdant') {
    if (!this.ensure()) return;
    this.stopMusic();
    const scales = {
      verdant: [0, 3, 5, 7, 10], ember: [0, 2, 3, 7, 8], tide: [0, 2, 5, 7, 9],
      dusk: [0, 3, 5, 8, 10], frost: [0, 2, 4, 7, 9],
    };
    const scale = scales[themeId] ?? scales.verdant;
    const root = 196;
    let beat = 0;
    this.intensity = 0.3;
    this.musicTimer = setInterval(() => {
      if (this.settings.muted || document.hidden) return;
      const rng = this.rng;
      if (rng() < this.intensity) {
        const deg = scale[Math.floor(rng() * scale.length)];
        const oct = rng() < 0.3 ? 2 : 1;
        const f = root * Math.pow(2, deg / 12) * oct;
        this.blip({ bus: 'music', f0: f, dur: 0.5, gain: 0.05 + this.intensity * 0.05, type: 'triangle' });
      }
      if (beat % 8 === 0) this.blip({ bus: 'music', f0: root / 2, dur: 0.8, gain: 0.05, type: 'sine' });
      beat++;
    }, 260);
  }
  setIntensity(x) { this.intensity = Math.max(0.1, Math.min(1, x)); }
  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  startAmbience(themeId = 'verdant') {
    if (!this.ensure()) return;
    this.stopAmbience();
    const mk = (freq, gain) => {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { last = last * 0.98 + (this.rng() * 2 - 1) * 0.02; d[i] = last * 8; }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = this.ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.buses.ambience);
      src.start();
      this.ambNodes.push(src);
    };
    mk(themeId === 'ember' ? 220 : 400, 0.5);
  }
  stopAmbience() { for (const n of this.ambNodes) { try { n.stop(); } catch {} } this.ambNodes = []; }
}

function captionFor(name, opts) {
  switch (name) {
    case 'eat': return `consumed +${opts.mass ?? 1}`;
    case 'eat_gem': return 'gem consumed';
    case 'eat_void': return 'rival consumed';
    case 'burn': return 'burned by an ember';
    case 'goal': return 'objective complete';
    case 'round_end': return 'round over';
    case 'achievement': return 'achievement unlocked';
    case 'invalid': return 'action not allowed';
    case 'countdown': return 'countdown tick';
    case 'go': return 'go!';
    default: return null;
  }
}
