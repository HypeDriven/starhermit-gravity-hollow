// Sound, as the browser build's src/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per game event, the theme's looping
// ambience bed (amb-*.opus) under a match, and the adaptive music — every
// 260 ms a plucked triangle note from the theme's scale with a chance that
// grows with the match's intensity, a low sine every eighth beat. Each
// captioned event also reports its caption (main.ts shows it when Captions is
// on, muted or not, as before).
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects", the menu cues → "interface"; the old default bus
// levels (music 70 %, effects 90 %, ambience 50 %) are folded into each
// sound's gain. The music's notes are rendered once into clips (createClip)
// with the old oscillator envelope. The procedural stand-ins the browser
// build synthesized while a clip decoded are not ported (a live synthesis
// graph makes clip loads fail on the engine's web runtime), so a clip still
// loading is silent. Clips load once the mixer runs (natively at once, in a
// browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";
import { mulberry32 } from "../src/rng.js";

const N = (s: string): string => s;
const LEVEL = { music: 0.7, effects: 0.9, ambience: 0.5 };

const SAMPLES: Record<string, string> = {
  ui_move: "ui-move", ui_confirm: "ui-confirm", ui_back: "ui-back",
  invalid: "invalid-buzz", eat: "eat-morsel", eat_gem: "eat-gem",
  eat_void: "eat-void", burn: "ember-burn", boost: "boost-whoosh",
  respawn: "respawn-bloom", goal: "goal-chime", countdown: "countdown-tick",
  go: "go-signal", round_end: "round-end-fanfare", defeat: "defeat-fall",
  undo: "undo-rewind", hint: "hint-spark", achievement: "achievement-unlock",
  clock_warning: "clock-warning", move_limit: "move-limit-stop", eat_boulder: "eat-boulder",
  lesson_complete: "lesson-complete", swallowed: "swallowed",
};
const AMBIENCE: Record<string, string> = {
  verdant: "amb-garden", ember: "amb-forge", tide: "amb-shore", dusk: "amb-market", frost: "amb-tundra",
};
const INTERFACE = new Set(["ui_move", "ui_confirm", "ui_back"]);

/** src/audio.js captionFor: the English caption key of an event (n: the mass). */
function captionFor(name: string): string | null {
  switch (name) {
    case "eat": return N("consumed +{n}");
    case "eat_gem": return N("gem consumed");
    case "eat_void": return N("rival consumed");
    case "eat_boulder": return N("boulder consumed +{n}");
    case "swallowed": return N("you were swallowed");
    case "clock_warning": return N("15 seconds left");
    case "move_limit": return N("out of movement");
    case "lesson_complete": return N("lesson complete");
    case "burn": return N("burned by an ember");
    case "goal": return N("objective complete");
    case "round_end": return N("round over");
    case "achievement": return N("achievement unlocked");
    case "invalid": return N("action not allowed");
    case "countdown": return N("countdown tick");
    case "go": return N("go!");
    default: return null;
  }
}

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let onCaption: ((key: string, vars: Record<string, string | number>) => void) | null = null;

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
/** cb(captionKey, vars) for each captioned event (an English key). */
export function setOnCaption(cb: (key: string, vars: Record<string, string | number>) => void): void { onCaption = cb; }

/** src/audio.js event(): plays an event's sample (once loaded) and reports its caption. */
export function event(nameIn: string, opts: { mass?: number } = {}): void {
  let name = nameIn;
  if (name === "eat" && (opts.mass ?? 1) >= 8) name = "eat_boulder"; // boulders get the heavy crunch
  const cap = captionFor(name);
  if (onCaption && cap) onCaption(cap, { n: opts.mass ?? (name === "eat_boulder" ? 8 : 1) });
  const file = SAMPLES[name];
  if (!file || suspended) return;
  const clip = clips.get(file);
  if (!clip) return;
  const bus: Bus = INTERFACE.has(name) ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { clips.delete(file); load(file); } // a clip the mixer lost: load it again
}

// -- the music ---------------------------------------------------------------------------
const RATE = 22050;
/** src/audio.js blip(): an oscillator rising to full level in 12 ms, then exponential to 0.0001 at `dur`. */
function noteClip(freq: number, dur: number, wave: "triangle" | "sine"): AudioClip {
  const n = Math.round((dur + 0.02) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const ph = (freq * t) % 1;
    const osc = wave === "sine" ? Math.sin(2 * Math.PI * ph) : 1 - 4 * Math.abs(ph - 0.5);
    const env = t < 0.012 ? Math.pow(10000, t / 0.012) * 0.0001 : t < dur ? Math.pow(0.0001, (t - 0.012) / (dur - 0.012)) : 0;
    out[i] = osc * env;
  }
  return createClip([out], RATE);
}
const SCALES: Record<string, number[]> = {
  verdant: [0, 3, 5, 7, 10], ember: [0, 2, 3, 7, 8], tide: [0, 2, 5, 7, 9],
  dusk: [0, 3, 5, 8, 10], frost: [0, 2, 4, 7, 9],
};
const ROOT = 196;
const notes = new Map<string, AudioClip>();
const rng = mulberry32(0xC0FFEE);
let musicOn = false;
let scale = SCALES.verdant!;
let beat = 0;
let nextBeat = 0;
let nextRender = 0;
let intensity = 0.3;
let ambience: string | null = null;
let ambienceSound: Sound | null = null;
let ambiencePlaying: string | null = null;
let suspended = false;

/** The match's music in the theme's scale (src/audio.js startMusic). */
export function startMusic(theme: string): void {
  musicOn = true;
  scale = SCALES[theme] ?? SCALES.verdant!;
  intensity = 0.3;
  beat = 0;
  nextBeat = 0;
}
export function stopMusic(): void { musicOn = false; }
export function setIntensity(x: number): void { intensity = Math.max(0.1, Math.min(1, x)); }
export function startAmbience(theme: string): void { ambience = AMBIENCE[theme] ?? null; }
export function stopAmbience(): void { ambience = null; }
/** Pause and a hidden window: the music and the bed hold. */
export function setSuspended(on: boolean): void { suspended = on; }

/** Each frame: the clips once the mixer runs (one at a time), the scale's notes
 * rendered one per 0.3 s after them, the ambience bed, then the music's beats
 * by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of Object.values(SAMPLES)) load(name);
    for (const name of Object.values(AMBIENCE)) load(name);
    return;
  }
  pump();
  try {
    const want = !suspended ? ambience : null;
    if (ambiencePlaying !== want) {
      if (ambienceSound) { try { ambienceSound.stop(); } catch { /* gone */ } }
      ambienceSound = null;
      ambiencePlaying = null;
      const bed = want ? clips.get(want) : undefined;
      if (want && bed) { ambienceSound = playClip(bed, { bus: "effects", gain: 0.6 * LEVEL.ambience, loop: true }); ambiencePlaying = want; }
    }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (loading || queue.length) return;
  if (!musicOn || suspended) return;
  const now = context.currentTime;
  if (now >= nextRender) {
    for (const deg of scale) for (const oct of [1, 2]) {
      const k = `${deg}:${oct}`;
      if (!notes.has(k)) { notes.set(k, noteClip(ROOT * Math.pow(2, deg / 12) * oct, 0.5, "triangle")); nextRender = now + 0.3; return; }
    }
    if (!notes.has("bass")) { notes.set("bass", noteClip(ROOT / 2, 0.8, "sine")); nextRender = now + 0.3; return; }
  }
  if (now < nextBeat) return;
  nextBeat = Math.max(now, nextBeat) + 0.26;
  try {
    if (rng() < intensity) {
      const deg = scale[Math.floor(rng() * scale.length)]!;
      const oct = rng() < 0.3 ? 2 : 1;
      const note = notes.get(`${deg}:${oct}`);
      if (note) playClip(note, { bus: "music", gain: (0.05 + intensity * 0.05) * LEVEL.music });
    }
    const bass = notes.get("bass");
    if (beat % 8 === 0 && bass) playClip(bass, { bus: "music", gain: 0.05 * LEVEL.music });
  } catch { /* the mixer is full */ }
  beat++;
}
