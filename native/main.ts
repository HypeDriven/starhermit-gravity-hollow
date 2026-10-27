// Gravity Hollow on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (src/rules.js), content
// (src/content.js), seeded streams (src/rng.js) and the session with its
// replay envelope, progression and achievements (src/session.js) are the
// browser build's, unchanged in what they decide; this module is what
// src/main.js did around them — the app state machine (title → mode select →
// setup → countdown → active ⇄ paused → results), the event presentation (a
// sound, a caption, an announcement and the plaza's sparks per rules event),
// the Learn lessons (TutorialRun), input (steering by keys, gamepad stick or a
// drag on the plaza; boost held or toggled from the tray), Undo, Hint and
// Camera, results with the replay check and posting ranked rounds to the
// high-score board, and the lifecycle (a hidden window pauses solo play, as
// the browser build's visibilitychange did). Screens and HUD are drawn by
// screens.ts (starhermit:ui), the plaza by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps at the rules' 30 Hz: one rules step per
// fixed step while the match runs, so pauses, a hidden window and slow frames
// never cost time and play scripts replay exactly.
import "./i18n.ts";
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { isDown, onAction, onPointerButton, onPointerMove, onTouch, value, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { worker, type Worker } from "starhermit:script";
import { Content, Rules, Sess, mulberry32, type Results, type RulesEvent, type Session, type Stage, type State, type Step } from "./game.ts";
import { platformStrings } from "../src/platform-i18n.js";
import * as audio from "./audio.ts";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens, goalText, pname, stageName } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

export type Screen = "title" | "modes" | "setup" | "journey" | "profile" | "settings" | "help" | "game";
export type ModeList = "modes" | "practice" | "challenges" | "hosted";
export type { Stage, State, Results };
const { dailyStage, journeyAll, practiceStage, tutorials } = Content;

export const app = {
  screen: "title" as Screen,
  modeList: "modes" as ModeList,
  /** The stage the setup card shows (and Start begins). */
  pendingStage: null as Stage | null,
  /** Where Settings and Help go back to. */
  under: "title" as Screen,
  /** Over the round: the pause menu or the results. */
  overlay: null as "pause" | "results" | null,
  /** Frame the screen or overlay opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as Session | null,
  matchFlow: "title" as "title" | "playing" | "results",
  results: null as Results | null,
  replayCheck: null as { ok: boolean; skipped?: boolean; why?: string | null; hash?: string } | null,
  lb: null as { posted: boolean; rank: number | null } | "posting" | null,
  pauseAway: "",
  tutorial: null as TutorialRun | null,
  boostToggle: false,
  trayBoost: false,
  toasts: [] as { text: string; until: number }[],
  caption: null as { text: string; until: number } | null,
  goUntil: 0,
};
export const settings = platform.settings;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
/** src/ui.js toast(): 3.2 s by default, stacked (at most three). */
export function toast(text: string, seconds = 3.2): void {
  app.toasts.push({ text, until: now() + seconds });
  if (app.toasts.length > 3) app.toasts.shift();
  announce(text);
}
export function click(name = "ui_confirm"): void { audio.event(name); }
export function save(): ReturnType<typeof platform.save> { return platform.save(); }
function haptic(ms: number): void { try { vibrate(ms); } catch { /* not here */ } }
export function utcDateKey(): string { return new Date(platform.nowMs()).toISOString().slice(0, 10); }

// ------------------------------------------------------------------ navigation
export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
}
export function goHome(): void {
  endSession();
  app.overlay = null;
  app.matchFlow = "title";
  app.results = null;
  audio.stopMusic();
  audio.stopAmbience();
  render.loadStage(idleStage(), null);
  show("title", "btn-play");
}
/** Settings or Help over the current screen (the title, a list, or the pause menu). */
export function openPage(screen: "settings" | "help"): void {
  click();
  app.under = app.screen === "game" ? "game" : (app.screen === "settings" || app.screen === "help" ? app.under : app.screen);
  show(screen, screen === "settings" ? "set-captions" : "btn-help-close");
}
export function back(): void {
  click("ui_back");
  if ((app.screen === "settings" || app.screen === "help") && app.under === "game" && app.session) {
    show("game", app.overlay === "pause" ? "btn-resume" : null);
    return;
  }
  if (app.screen === "settings" || app.screen === "help") { show(app.under === "game" ? "title" : app.under, null); return; }
  show("title", "btn-play");
}
let idle: Stage | null = null;
function idleStage(): Stage { return (idle ??= practiceStage("standard")); }

export function showModes(list: ModeList): void { click(); app.modeList = list; show("modes", null); }
export function showJourney(): void { click(); show("journey", null); }
export function showProfile(): void { click(); show("profile", null); }
export function openSetup(stage: Stage): void {
  click();
  app.pendingStage = stage;
  show("setup", "btn-start-match");
  if (stage.kind === "daily") platform.loadStandings();
}
export function openDaily(): void {
  const key = utcDateKey();
  const excluded = (save().dailyExcluded ?? []).includes(key);
  openSetup(dailyStage(key, excluded));
}
export function learnDone(): boolean { return tutorials().every((t) => save().tutorialsDone[t.id]); }
export function nextLearnIndex(): number {
  const t = tutorials();
  for (let i = 0; i < t.length; i++) if (!save().tutorialsDone[t[i]!.id]) return i;
  return 0;
}
/** src/main.js hostedStage: a local table, AI in every other seat. */
export function hostedStage(seats: number, durationSec: number): Stage {
  const names = ["Pip", "Sorrel", "Bram", "Nettle", "Cobb", "Wren", "Tansy"];
  const seed = (Math.floor(platform.nowMs()) % 0x7fffffff) >>> 0;
  const rng = mulberry32(seed);
  return {
    id: `hosted-${seed}`, kind: "hosted", version: 1, seed,
    name: `Hosted Table (${seats} seats)`, theme: "tide", arenaHalf: 46,
    obstacles: [], durationSec,
    rivals: names.slice(0, seats - 1).map((n) => ({ name: n, skill: 0.45 + rng() * 0.3, massScale: 1 })),
    emberCount: 6, propTarget: 110,
    propWeights: { crumb: 42, chunk: 30, boulder: 17, gem: 8, ember: 3 },
    goals: [], boost: "on",
    description: "Local lobby with AI seats. Realtime rooms are planned for a later build.",
  } as Stage;
}
export function startLearn(index: number): void {
  app.pendingStage = tutorials()[index]!;
  beginMatch();
}

// ------------------------------------------------------------------ the match
export function beginMatch(): void {
  const stage = app.pendingStage;
  if (!stage) return;
  endSession();
  audio.setSuspended(false);
  app.overlay = null;
  app.results = null;
  app.replayCheck = null;
  app.lb = null;
  app.pauseAway = "";
  app.boostToggle = false;
  app.trayBoost = false;
  app.matchFlow = "playing";
  lastSent = { dx: 0, dy: 0, boost: false };
  lastCount = null;
  clockWarned = false;
  frameEvents = [];
  drag = null;
  app.session = new Sess.Session(stage, {
    playerName: save().profile.name,
    hooks: {
      onEvents: (events: RulesEvent[], state: State) => onEvents(events, state),
      onPhase: (phase: string) => onPhase(phase),
    },
  });
  render.loadStage(stage, app.session.state);
  audio.startMusic(stage.theme);
  audio.startAmbience(stage.theme);
  audio.setIntensity(0.3);
  show("game", null);
  announce(`${stageName(stage)}. ${stage.goals?.length ? stage.goals.map(goalText).join("; ") : T("Outscore every rival.")}`, true);
  app.tutorial = stage.kind === "learn" ? new TutorialRun(stage) : null;
}
export function restartMatch(): void { click(); beginMatch(); }
export function pauseMatch(reason: "user" | "backgrounded" = "user"): void {
  // The pause button outlives the match; pausing over the results would hide them.
  const s = app.session;
  if (!s || app.matchFlow !== "playing" || Rules.isTerminal(s.state) || app.overlay) return;
  s.pause(reason);
  app.pauseAway = reason === "backgrounded" ? N("Paused because the tab was hidden.") : "";
  app.overlay = "pause";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-resume";
  ui.setFocus(null);
  audio.setSuspended(true);
  if (reason === "user") audio.event("ui_back");
  announce(T("Paused"));
}
export function resumeMatch(): void {
  if (app.overlay !== "pause") return;
  app.overlay = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  app.session?.resume();
  audio.setSuspended(false);
  audio.event("ui_confirm");
}
export function leaveMatch(): void { click("ui_back"); goHome(); }
function endSession(): void {
  if (app.session) app.session.destroy();
  app.session = null;
  app.tutorial = null;
  render.setMarkers([]);
}

let frameEvents: RulesEvent[] = [];
function onPhase(phase: string): void {
  if (phase === "ended") finishMatch();
  else if (phase === "undo") { audio.event("undo"); toast(T("Undone")); }
}
function onEvents(events: RulesEvent[], state: State): void {
  frameEvents.push(...events);
  for (const e of events) {
    switch (e.t) {
      case "start":
        app.goUntil = now() + 0.6;
        audio.event("go");
        announce(T("Go!"), true);
        break;
      case "eat": if (e.id === 0) { audio.event("eat", { mass: e.m }); haptic(8); } break;
      case "eat_gem": if (e.id === 0) { audio.event("eat_gem"); haptic(15); announce(T("Gem consumed")); } break;
      case "eat_void":
        audio.event(e.victim === 0 ? "swallowed" : "eat_void");
        haptic(40);
        announce(e.id === 0 ? T("You swallowed {name}!", { name: pname(state.voids[e.victim!]!.name) })
          : T("{eater} swallowed {name}", { eater: pname(state.voids[e.id!]!.name), name: pname(state.voids[e.victim!]!.name) }), e.id !== 0 && e.victim === 0);
        break;
      case "burn": if (e.id === 0) { audio.event("burn"); haptic(25); announce(T("Burned by an ember")); } break;
      case "boost": if (e.id === 0) audio.event("boost"); break;
      case "respawn": if (e.id === 0) { audio.event("respawn"); announce(T("You respawned")); } break;
      case "goal": audio.event("goal"); toast(T("Objective complete!")); break;
      case "move_limit": if (e.ids?.includes(0)) { audio.event("move_limit"); toast(T("Out of movement!")); } break;
    }
    app.tutorial?.onEvent(e);
  }
}

// -- replay checks off the game's thread (native/verify-worker.js) ----------------------
let verifier: Worker | null = null;
let verifyId = 0;
const pendingChecks = new Map<number, (r: { ok: boolean; why: string | null }) => void>();
function verify(replay: unknown, stage: Stage): Promise<{ ok: boolean; why: string | null }> {
  return new Promise((resolve) => {
    try {
      if (!verifier) {
        verifier = worker("native/verify-worker.js", { type: "module", heapMiB: 64 });
        verifier.on("message", (data) => {
          const d = data as { id: number; ok: boolean; why: string | null };
          const fn = pendingChecks.get(d.id);
          pendingChecks.delete(d.id);
          fn?.({ ok: d.ok, why: d.why });
        });
        verifier.on("stopped", () => {
          verifier = null;
          for (const fn of pendingChecks.values()) fn({ ok: false, why: "worker" });
          pendingChecks.clear();
        });
      }
      const id = ++verifyId;
      pendingChecks.set(id, resolve);
      verifier.post(JSON.parse(JSON.stringify({ id, replay, stage })));
    } catch (e) { resolve({ ok: false, why: e instanceof Error ? e.message : String(e) }); }
  });
}

function finishMatch(): void {
  const s = app.session!;
  const results = s.finish();
  audio.stopMusic();
  const me = results.rankings.find((r) => r.id === 0);
  audio.event(me?.place === 1 ? "round_end" : "defeat");
  const doc = save();
  const before = new Set(Object.keys(doc.achievements));
  Sess.recordResult(doc, s, results);
  platform.saveNow();
  for (const k of Object.keys(doc.achievements).filter((k) => !before.has(k))) {
    audio.event("achievement");
    toast(T("Achievement: {name}", { name: T(Sess.ACHIEVEMENTS[k]?.name ?? k) }));
  }
  app.results = results;
  app.matchFlow = "results";
  app.overlay = "results";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-next";
  ui.setFocus(null);
  app.tutorial = null;
  render.setMarkers([]);
  app.lb = null;
  // Verify our own replay as tamper evidence (skipped when undo rewrote history).
  const kind = s.stage.kind;
  // Lessons end when their steps are done, not by the rules, so their replays cannot verify: none is checked.
  if (kind === "learn") app.replayCheck = { ok: true, skipped: true, why: "lesson" };
  else if (s.undoUsed) app.replayCheck = { ok: true, skipped: true };
  else {
    app.replayCheck = null;
    const hash = results.replay.result?.finalHash ?? "";
    void verify(results.replay, s.stage).then((r) => {
      if (app.session !== s) return;
      app.replayCheck = { ok: r.ok, why: r.why, hash };
      if ((kind === "daily" || kind === "challenge") && r.ok) postToLeaderboard(Math.max(0, results.breakdown.total));
    });
  }
  announce(T("{headline}. Total score {total}.", { headline: resultsHeadline(results), total: results.breakdown.total }), true);
}
export function resultsHeadline(r: Results): string {
  const me = r.rankings.find((x) => x.id === 0);
  const won = me?.place === 1;
  const PLACES = [N("1st place"), N("2nd place"), N("3rd place")];
  return r.terminalReason === "lesson_complete" ? T("Lesson complete!")
    : r.terminalReason === "moves_exhausted" ? T("Out of moves")
    : won ? T("You rule the plaza!") : T(PLACES[(me?.place ?? 0) - 1] ?? N("{n}th place"), { n: me?.place ?? 0 });
}
export function replayLine(): string {
  const c = app.replayCheck;
  if (!c) return T("Verifying replay…");
  if (c.why === "lesson") return "";
  if (c.skipped) return T("Practice mode — replay not ranked");
  return c.ok ? T("Replay verified · {hash}", { hash: c.hash ?? "" }) : T("Replay mismatch ({why})", { why: c.why ?? "" });
}
export function progressLine(): string {
  const kind = app.results?.stage.kind;
  if (kind === "journey") return T("{n} of {total} stages cleared", { n: Object.keys(save().journey).length, total: 40 });
  if (kind === "daily") return T("Daily result recorded");
  return "";
}
/** Signed in only: post a ranked round (Daily Hollow, Challenges) and show the board rank. */
function postToLeaderboard(total: number): void {
  if (!platform.signedIn()) return;
  app.lb = "posting";
  const s = app.session;
  void platform.postLeaderboard(total).then((r) => { if (app.session === s) app.lb = r; });
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  const t = platformStrings();
  if (r === "posting") return t.lbPosting;
  return !r.posted ? t.lbNotPosted : r.rank ? t.lbRank.replace("{rank}", String(r.rank)) : t.lbPosted;
}
export function nextRecommended(): void {
  const stage = app.session?.stage;
  click();
  if (stage?.kind === "learn") {
    const idx = tutorials().findIndex((t) => t.id === stage.id);
    if (idx + 1 < tutorials().length) { startLearn(idx + 1); return; }
    goHome();
    return;
  }
  if (stage?.kind === "journey") {
    const next = journeyAll().find((s) => !save().journey[s.id]);
    if (next) { endSession(); app.overlay = null; app.matchFlow = "title"; audio.stopAmbience(); render.loadStage(idleStage(), null); openSetup(next); return; }
  }
  goHome();
}

// ------------------------------------------------------------------ commands
export function doUndo(): void {
  const s = app.session;
  if (!s || app.overlay) return;
  const r = s.undo();
  if (!r.ok) { audio.event("invalid"); toast(r.reason === "undo_empty" ? T("Nothing to undo") : T("Undo is not available in this mode")); }
}
export function doHint(): void {
  const s = app.session;
  if (!s || app.overlay) return;
  // Hints use the same legal-action query as play.
  const q = s.query();
  audio.event("hint");
  let msg: string;
  if (!q.canMove) msg = q.moveReason === "respawning" ? T("You are respawning — hang tight.") : q.moveReason === "move_limit" ? T("No movement left — make peace with the plaza.") : T("Waiting for the round…");
  else if (q.hazards.length) msg = T("Danger close: a bigger void or an ember is near. Steer away!");
  else if (q.edible.length) {
    const gems = q.edible.filter((e) => e.kind === "prop" && e.mass >= 15);
    msg = gems.length ? T("A gem is in reach — go gleam hunting!")
      : q.edible.length === 1 ? T("{n} thing nearby is edible. Dimmer than you = dinner.", { n: 1 }) : T("{n} things nearby are edible. Dimmer than you = dinner.", { n: q.edible.length });
  } else msg = T("Nothing edible right here. Drift toward open pavement and look for highlights.");
  toast(msg, 4.2);
}
export function resetCamera(): void {
  render.frameCamera(app.session?.state.arena.half ?? 40, true);
  audio.event("ui_move");
}
/** Tray boost: held (hold-to-boost) or toggled. */
export function trayBoost(pressed: boolean, activated: boolean): void {
  if (settings.holdBoost) app.trayBoost = pressed;
  else if (activated) app.boostToggle = !app.boostToggle;
}
export function boostShown(): boolean { return settings.holdBoost ? app.trayBoost || isDown("boost") : app.boostToggle; }
export function copyInvite(): void {
  click();
  const link = platform.inviteLink();
  if (!link) return;
  const t = platformStrings();
  try { clipboard.writeText(link); toast(t.inviteCopied); } catch { toast(t.inviteFailed); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function setName(name: string): void {
  const v = name.trim().slice(0, 20);
  if (!v || platform.signedIn()) return;
  save().profile.name = v;
  platform.saveNow();
}

// ------------------------------------------------------------------ the lessons
/** src/main.js TutorialRun: each Learn step must be performed (or skipped). */
class TutorialRun {
  steps: Step[];
  index = 0;
  count = 0;
  markers: { x: number; y: number }[] = [];
  rng: () => number;
  constructor(stage: Stage) {
    this.steps = stage.steps ?? [];
    this.rng = mulberry32(stage.seed ^ 0xBEEF);
    this.setupStep();
  }
  get step(): Step | undefined { return this.steps[this.index]; }
  setupStep(): void {
    const s = this.step;
    if (!s) return;
    this.count = 0;
    announce(T(s.text), true);
    if (s.require.type === "visit_markers") {
      const half = app.session!.state.arena.half;
      this.markers = [];
      for (let i = 0; i < (s.require.count ?? 0); i++) this.markers.push({ x: (this.rng() * 2 - 1) * (half - 8), y: (this.rng() * 2 - 1) * (half - 8) });
    } else this.markers = [];
    render.setMarkers(this.markers);
  }
  advance(skip = false): void {
    if (!skip) audio.event("goal");
    this.index++;
    if (this.index >= this.steps.length) {
      this.markers = [];
      render.setMarkers([]);
      toast(T("Lesson complete!"));
      audio.event("lesson_complete");
      // End the lesson: the next step sees the terminal state and produces the results
      // (which record the lesson as finished).
      const st = app.session!.state;
      st.phase = "ended";
      st.terminalReason = "lesson_complete";
      return;
    }
    this.setupStep();
  }
  onEvent(e: RulesEvent): void {
    const s = this.step;
    if (!s) return;
    const r = s.require;
    if (r.type === "eat" && e.t === "eat" && e.id === 0) this.count++;
    else if (r.type === "eat_kind" && e.id === 0) {
      const kindMass = ({ chunk: 3, boulder: 8 } as Record<string, number>)[r.kind ?? ""];
      if (r.kind === "gem" && e.t === "eat_gem") this.count++;
      else if (e.t === "eat" && e.m === kindMass) this.count++;
      else return;
    } else if (r.type === "boost" && e.t === "boost" && e.id === 0) this.count++;
    else if (r.type === "eat_rival" && e.t === "eat_void" && e.id === 0) this.count++;
    else return;
    if (this.count >= (r.count ?? 1)) this.advance();
  }
  /** Once per rules step (the browser build counted render frames at ~60 a second: 2 per step). */
  onStep(state: State): void {
    const s = this.step;
    if (!s) return;
    const r = s.require;
    const me = state.voids[0]!;
    if (r.type === "move_ticks") {
      if (Math.hypot(me.vx, me.vy) > 1) this.count += 2;
      if (this.count >= (r.count ?? 0)) this.advance();
    } else if (r.type === "visit_markers" && this.markers.length) {
      for (let i = this.markers.length - 1; i >= 0; i--) {
        const m = this.markers[i]!;
        if (Math.hypot(me.x - m.x, me.y - m.y) < 2.6) {
          this.markers.splice(i, 1);
          audio.event("eat_gem");
          this.count++;
        }
      }
      render.setMarkers(this.markers.slice());
      if (this.count >= (r.count ?? 0)) this.advance();
    } else if (r.type === "finish" && state.phase === "ended") this.advance();
  }
  skip(): void { click(); this.advance(true); }
}
export type { TutorialRun };

// ------------------------------------------------------------------ input
let lastSent = { dx: 0, dy: 0, boost: false };
/** A drag on the plaza steers toward the pointer (window pixels). */
let drag: { x: number; y: number } | null = null;
let lastTouch = -1e9;
const queued: { kind: "down" | "move" | "up"; x: number; y: number }[] = [];
/** HUD rectangles (window pixels) where a press belongs to the UI, set by screens.ts each frame. */
export const hudRects: { x: number; y: number; width: number; height: number }[] = [];
function onHud(x: number, y: number): boolean { return hudRects.some((r) => x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height); }
function canSteer(): boolean { return app.screen === "game" && app.matchFlow === "playing" && !app.overlay && !!app.session; }
/** The frame's queued presses, decided once its UI is built (from onRender). */
function pointerInput(): void {
  for (const q of queued.splice(0)) {
    if (q.kind === "down") drag = canSteer() && !onHud(q.x, q.y) ? { x: q.x, y: q.y } : null;
    else if (q.kind === "move") { if (drag) drag = { x: q.x, y: q.y }; }
    else drag = null;
  }
  if (!canSteer()) drag = null;
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (drag && now() - lastTouch >= 0.6) queued.push({ kind: "move", x, y }); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  if (e.phase === "start") queued.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "move") queued.push({ kind: "move", x: e.x, y: e.y });
  else queued.push({ kind: "up", x: e.x, y: e.y });
});

/** src/main.js computeInput: keys, the gamepad stick, a drag; boost from the key, pad, tray or toggle. */
function computeInput(st: State): { dx: number; dy: number; boost: boolean } {
  let dx = Math.round((value("right") - value("left")) * 100);
  let dy = Math.round((value("down") - value("up")) * 100);
  if (drag) {
    const me = st.voids[0]!;
    const p = render.projectToScreen(me.x, me.y);
    const vx = drag.x - p.x, vy = drag.y - p.y;
    const dist = Math.hypot(vx, vy);
    if (dist > 24 * frame().scale) { dx = Math.round(vx / dist * 100); dy = Math.round(vy / dist * 100); }
    else { dx = 0; dy = 0; } // the dead zone tells a tap from a drag
  }
  const boost = isDown("boost") || app.trayBoost || (!settings.holdBoost && app.boostToggle);
  const mag = Math.hypot(dx, dy);
  if (mag > 100) { dx = Math.round(dx / mag * 100); dy = Math.round(dy / mag * 100); }
  return { dx, dy, boost };
}

onAction((e) => {
  if (!e.pressed) return;
  const fresh = frame().frame !== app.openedFrame;
  if (app.screen !== "game") {
    // Escape (or the pad's Start / East through the UI) leaves a list or page, as its Back button.
    if (e.action === "pause" && fresh && app.screen !== "title" && !ui.capturingKeys()) back();
    return;
  }
  if (e.action === "pause") {
    if (!fresh) return;
    if (app.overlay === "pause") resumeMatch();
    else if (!app.overlay) pauseMatch();
    return;
  }
  if (app.overlay || app.matchFlow !== "playing") return;
  switch (e.action) {
    case "undo": doUndo(); break;
    case "hint": doHint(); break;
    case "camera": resetCamera(); break;
  }
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(Rules.TICK_RATE);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  audio.setOnCaption((key, vars) => {
    if (!settings.captions) return;
    app.caption = { text: T(key, vars), until: now() + 1.8 };
  });
  render.setReducedMotion(preferences().reducedMotion);
  render.setPalette(settings.palette);
  applyLook();
  render.setActive(true);
  goHome();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
platform.onSettingsChange(() => render.setPalette(settings.palette));
platform.onProgressMerged(() => toast(T("Cloud save synced")));
onSessionEnded(() => toast(platformStrings().signedOut));
let hidden = false;
onSuspend(() => {
  hidden = true;
  // Solo play pauses while the window is hidden (src/session.js visibilitychange).
  if (app.session && app.matchFlow === "playing" && app.session.state.phase === "active" && !app.overlay) pauseMatch("backgrounded");
  audio.setSuspended(true);
  platform.flush();
});
onResume(() => {
  hidden = false;
  if (app.overlay === "pause" && app.session && app.pauseAway) app.pauseAway = app.session.awaySummary();
  if (app.overlay !== "pause") audio.setSuspended(false);
});

let lastCount: number | null = null;
let clockWarned = false;
onFixedUpdate(() => {
  const s = app.session;
  if (hidden || !s || app.matchFlow !== "playing" || s.paused || app.overlay) return;
  if (!Rules.isTerminal(s.state)) {
    const { dx, dy, boost } = computeInput(s.state);
    // Command dedupe: submit only when the intent changes.
    if (dx !== lastSent.dx || dy !== lastSent.dy || boost !== lastSent.boost) {
      const verdict = s.submitMove(dx, dy, boost);
      if (!verdict.ok && verdict.reason && verdict.reason !== "not_active" && verdict.reason !== "cannot_move" && verdict.reason !== "respawning" && verdict.reason !== "move_limit") {
        announce(T("Action rejected: {reason}", { reason: verdict.reason }));
      }
      lastSent = { dx, dy, boost };
    }
  }
  s.tickOnce();
  if (app.session !== s || app.matchFlow !== "playing") return;
  const st = s.state;
  app.tutorial?.onStep(st);
  // Countdown numbers.
  if (st.phase === "countdown") {
    const n = Math.ceil(st.countdownTicks / Rules.TICK_RATE);
    if (n !== lastCount) { lastCount = n; audio.event("countdown"); announce(String(n)); }
  }
  audio.setIntensity(0.3 + 0.6 * (st.tick / st.config.durationTicks));
  // One warning cue when the timer turns red (15 s left).
  const remain = s.stage.durationSec - st.tick / Rules.TICK_RATE;
  if (st.phase === "active" && remain < 15 && !clockWarned) { clockWarned = true; audio.event("clock_warning"); }
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  // Steering keys must not also walk the UI focus over the HUD (arrows move focus when nothing has it).
  if (app.screen === "game" && !app.overlay && app.matchFlow === "playing" && ["up", "down", "left", "right"].some((a) => isDown(a))) ui.setFocus(null);
  applyLook();
  audio.update();
  applyContrast(ui.preferences().highContrast);
  const t = now();
  app.toasts = app.toasts.filter((x) => x.until >= t);
  if (app.caption && app.caption.until < t) app.caption = null;
});
onRender(() => {
  hudRects.length = 0;
  drawScreens();
  pointerInput();
  const f = frame();
  const ev = frameEvents;
  frameEvents = [];
  render.update(app.session ? app.session.state : null, ev, frameDt, f.width, f.height);
});
