// The browser build's DOM shell (index.html + src/ui.js + styles.css) as
// starhermit:ui, built every frame over the plaza: the title (key art, Play,
// Daily Hollow / Journey / Profile with their sub-lines, How to play,
// Settings, sign-in / invite, the sync line), the mode cards (modes, Practice
// difficulties, Challenges, Hosted Play tables), the setup card (rules,
// objectives, the plaza standings on the Daily Hollow), the Journey map, the
// profile with achievements, Settings and Help; the match HUD (objective and
// goals rail, timer and standings, score card and pause button), the lesson
// banner with Skip, the action tray (Undo in Practice, Hint, Boost, Camera),
// name labels over the voids, the countdown, the pause and results dialogs,
// toasts and captions. The browser's media queries are layouts picked by the
// window's logical size: wide (rails at the top corners, standings under the
// timer), compact (< 1024 px: no standings line), portrait phone (≤ 700 px
// wide: the timer above both rails), short landscape (≤ 500 px tall: one
// narrow rail at the left, the tray down the right); the left-handed setting
// moves the tray to the start.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, bindings, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { Content, Rules, Sess } from "./game.ts";
import { platformStrings } from "../src/platform-i18n.js";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { PALETTES } from "./platform.ts";
import * as render from "./render.ts";
import {
  app, back, beginMatch, boostShown, click, copyInvite, doHint, doUndo, goHome, hostedStage, hudRects, learnDone, leaderboardLine, leaveMatch,
  nextLearnIndex, nextRecommended, openDaily, openPage, openSetup, pauseMatch, progressLine, replayLine, resetCamera, restartMatch,
  resultsHeadline, resumeMatch, save, setName, settings, show, showJourney, showModes, showProfile, signIn, startLearn, trayBoost, utcDateKey,
} from "./main.ts";

const { JOURNEY_COUNT, challenges, journeyAll, practiceStage } = Content;
const TICK_RATE = Rules.TICK_RATE;
const ACHIEVEMENTS = Sess.ACHIEVEMENTS;

// ------------------------------------------------------------------ text helpers (src/ui.js)
export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export function goalText(g: { type: string; target: number }): string {
  switch (g.type) {
    case "mass": return T("Reach mass {n}", { n: g.target });
    case "gems": return g.target === 1 ? T("Consume {n} gem", { n: g.target }) : T("Consume {n} gems", { n: g.target });
    case "score": return T("Collect {n} mass", { n: g.target });
    case "rivals": return g.target > 1 ? T("Swallow {n} rivals", { n: g.target }) : T("Swallow {n} rival", { n: g.target });
    case "survive": return T("Finish with zero deaths");
    default: return g.type;
  }
}
const PRACTICE_NAMES: Record<string, string> = { "practice-relaxed": N("Practice — Relaxed"), "practice-standard": N("Practice — Standard"), "practice-intense": N("Practice — Intense") };
/** A stage's display name in the current language (content keeps English ids and names). */
export function stageName(stage: { kind?: string; mastery?: boolean; index?: number; dateKey?: string; id?: string; name?: string; rivals?: unknown[] } | null): string {
  if (!stage) return "";
  switch (stage.kind) {
    case "journey": return stage.mastery ? T("Mastery {n}", { n: stage.index ?? 0 }) : T("Stage {n}", { n: stage.index ?? 0 });
    case "daily": return T("Daily Hollow — {date}", { date: stage.dateKey ?? "" });
    case "practice": return T(PRACTICE_NAMES[stage.id ?? ""] ?? stage.name ?? "");
    case "hosted": return T("Hosted Table ({n} seats)", { n: (stage.rivals ?? []).length + 1 });
    default: return T(stage.name ?? "");
  }
}
/** The default guest name and built-in labels are translated; account and typed names are not. */
export function pname(name: string): string { return name === "Wanderer" ? T("Wanderer") : String(name ?? ""); }
const ARROWS: Record<string, string> = { "Arrow Left": "←", "Arrow Right": "→", "Arrow Up": "↑", "Arrow Down": "↓" };
function kbd(action: string): string { const l = bindingLabel(action, "keyboard"); return ARROWS[l] ?? l; }
const moveKeys = (): string => ["up", "left", "down", "right"].map(kbd).join("/");
/** Distinct key names of an action's keyboard bindings (ShiftLeft + ShiftRight read as one "Shift"). */
function keyList(action: string): string {
  const names = bindings(action).filter((b) => b.device === "keyboard").map((b) => (ARROWS[b.label] ?? b.label).replace(/^(Shift|Control|Alt|Meta) (Left|Right)$/, "$1"));
  return [...new Set(names)].join("/") || kbd(action);
}

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; compact: boolean; phone: boolean; shortLand: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const shortLand = lw > lh && lh <= 500;
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, compact: lw < 1024, phone: !shortLand && lw <= 700 && lh >= lw, shortLand };
}
const lastSize = new Map<string, number>();
const pr = (): ui.UiPreferences => ui.preferences();
function textWidth(text: string, style: string | readonly string[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / pr().scale;
}
interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void; width?: number }
const PLAIN = ["btn"];
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 4;
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 40);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(...style, s).id(b.id).button(b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" | "end" = "start", gap = 11): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, b.width ?? (buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null));
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / pr().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (ui.measureText(text, { kind: "heading", style: [cls] }).width / pr().scale <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
/** A two-column definition list (src/ui.js dl.breakdown): label left, value right. */
function dl(id: string, rows: [string, string, boolean?][], w: number): void {
  ui.column(id, () => rows.forEach(([k, v, total], i) => ui.row(`${id}-${i}`, () => {
    para(k, w - 80, total ? "total" : "dt");
    ui.spacer();
    ui.style(total ? "total" : "dd").id(`${id}-${i}-v`).label(v);
  }, { width: w, align: "center", ...(total ? { style: "total-row" } : {}) })), { spacing: 2, width: w });
}
const keep = (r: ui.Rect): void => { hudRects.push(r); };

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  if (app.screen !== "game") draw.rect(0, 0, f.width, f.height, "#050806bd");
  switch (app.screen) {
    case "title": titleScreen(L); break;
    case "modes": page("modes", L, 780, (w) => modesScreen(w)); break;
    case "setup": page("setup", L, 560, (w) => setupScreen(w)); break;
    case "journey": page("journey", L, 780, (w) => journeyScreen(w, L)); break;
    case "profile": page("profile", L, 560, (w) => profileScreen(w)); break;
    case "settings": page("settings", L, 780, (w) => settingsScreen(w)); break;
    case "help": page("help", L, 780, (w) => helpScreen(w)); break;
    case "game": gameScreen(L); break;
  }
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

/** A centred panel `maxW` wide (src/ui.js .panel / .panel.wide), scrolling when taller than the window. */
function page(key: string, L: Layout, maxW: number, build: (w: number) => void): void {
  const pad = L.phone ? 16 : 26;
  const outer = Math.min(maxW, L.lw - 24);
  const avail = Math.max(80, L.lh - 24);
  const h = lastSize.get(key) ?? 0;
  const scroll = h > avail;
  const inner = outer - 2 * pad - (scroll ? 14 : 0);
  const fresh = frame().frame - app.openedFrame <= 5;
  ui.place(`page-${key}`, "center", () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(inner), { style: "panel", width: outer - (scroll ? 14 : 0), spacing: 12, padding: { top: 22, bottom: 22, start: pad, end: pad } });
      lastSize.set(key, r.height / L.sc);
    };
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: outer, height: avail }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
  });
}
function backButton(w: number): void { flow("back-row", [{ id: "btn-back", text: T("Back"), style: ["btn", "btn-ghost"], act: back }], w); }

// ------------------------------------------------------------------ title
function titleScreen(L: Layout): void {
  const doc = save();
  page("title", L, 560, (w) => {
    if (L.lh > 560) ui.column("title-art", () => { /* the art is the style */ }, { style: "art-key", width: w, height: Math.min(200, w * 0.46) });
    ui.column("title-head", () => {
      heading(L.shortLand || w < 360 ? "logo-small" : "logo", "Gravity Hollow", w, "title-h");
      para(T("Grow the hollow. Outscore the plaza."), w, "dim", "tagline", true);
    }, { width: w, align: "center", spacing: 4 });
    button({ id: "btn-play", text: T("Play"), style: ["btn", "btn-primary", "btn-big"], act: () => showModes("modes") }, w);
    const played = doc.daily[utcDateKey()];
    const nowMs = platform.nowMs();
    const d = new Date(nowMs);
    const left = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs;
    const dailySub = played ? T("done · {score} pts", { score: played.score }) : T("new in {h}h {m}m", { h: Math.floor(left / 3600000), m: Math.floor((left % 3600000) / 60000) });
    const cards: [string, string, string, () => void][] = [
      ["btn-daily", T("Daily Hollow"), dailySub, () => { click(); openDaily(); }],
      ["btn-journey", T("Journey"), `${Object.keys(doc.journey).length} / ${JOURNEY_COUNT}`, showJourney],
      ["btn-profile", T("Profile"), pname(doc.profile.name), showProfile],
    ];
    const gap = 10;
    const cols = w < 330 ? 1 : 3;
    const cw = (w - gap * (cols - 1)) / cols;
    ui.grid("title-row", () => {
      for (const [id, title, sub, act] of cards) {
        if (ui.style("btn", "btn-secondary", { width: cw }).id(id).button(`${title}. ${sub}`, {
          content: () => ui.column(`${id}-face`, () => {
            para(title, cw - 36, "body", undefined, true);
            para(sub, cw - 36, "small", `${id}-sub`, true);
          }, { width: cw - 36, align: "center", spacing: 2 }),
        })) act();
      }
    }, { columns: cols, gap, width: w });
    flow("title-help", [
      { id: "btn-help", text: T("How to play"), style: ["btn", "btn-ghost"], act: () => openPage("help") },
      { id: "btn-settings", text: T("Settings"), style: ["btn", "btn-ghost"], act: () => openPage("settings") },
    ], w, "center", 40);
    const t = platformStrings();
    const plat: Btn[] = [];
    if (!platform.signedIn()) plat.push({ id: "btn-signin", text: t.signIn, style: ["btn", "btn-ghost"], act: signIn });
    if (platform.inviteLink()) plat.push({ id: "btn-invite", text: t.invite, style: ["btn", "btn-ghost"], act: copyInvite });
    if (plat.length) flow("title-platform", plat, w, "center", 20);
    ui.column("sync-col", () => para(syncText(), w, "small", "sync-status", true), { width: w, align: "center" });
  });
}
function syncText(): string {
  return T(({ synced: N("Cloud save synced"), saving: N("Saving to cloud…"), offline: N("Cloud unreachable — saved on this device"), local: N("Progress saved on this device") })[platform.syncState()]);
}

// ------------------------------------------------------------------ mode cards
interface Card { id: string; name: string; desc: string; badge?: string; act: () => void }
function cardGrid(id: string, cards: Card[], w: number): void {
  const gap = 13;
  const cols = Math.max(1, Math.min(cards.length, Math.floor((w + gap) / (200 + gap))));
  const cw = (w - gap * (cols - 1)) / cols;
  const inner = cw - 34;
  ui.grid(id, () => {
    for (const c of cards) {
      if (ui.style("mode-card", { width: cw }).id(c.id).button([c.name, c.desc, c.badge ?? ""].filter(Boolean).join(". "), {
        content: () => ui.column(`${c.id}-face`, () => {
          para(c.name, inner, "card-title");
          para(c.desc, inner, "card-desc");
          if (c.badge) ui.style("badge").label(c.badge);
        }, { spacing: 5, align: "start", width: inner }),
      })) { click(); c.act(); }
    }
  }, { columns: cols, gap, width: w, align: "stretch" });
}
function modesScreen(w: number): void {
  const doc = save();
  let cards: Card[];
  switch (app.modeList) {
    case "practice":
      heading("h2", T("Practice"), w, "modes-h");
      cards = (["relaxed", "standard", "intense"] as const).map((d) => {
        const st = practiceStage(d);
        return {
          id: `practice-${d}`, name: stageName(st),
          desc: d === "relaxed" ? T("No rivals, no embers. Just drift and eat.") : d === "standard" ? T("One gentle rival.") : T("Two hungry rivals, embers about."),
          badge: T("unrated · undo on"), act: () => openSetup(st),
        };
      });
      break;
    case "challenges":
      heading("h2", T("Challenges"), w, "modes-h");
      cards = challenges().map((c) => ({
        id: c.id, name: T(c.name), desc: T(c.description ?? ""), badge: doc.challenges[c.id]?.done ? T("cleared") : T("ranked"),
        act: () => openSetup(c),
      }));
      break;
    case "hosted":
      heading("h2", T("Hosted Play"), w, "modes-h");
      cards = [
        { id: "hosted-quick", name: T("Quick Match"), desc: T("4 voids, 2 minutes. AI fills empty seats."), badge: T("local lobby"), act: () => openSetup(hostedStage(4, 120)) },
        { id: "hosted-big", name: T("Big Table"), desc: T("8 voids, 3 minutes, crowded plaza."), badge: T("local lobby"), act: () => openSetup(hostedStage(8, 180)) },
      ];
      break;
    default:
      heading("h2", T("Choose a mode"), w, "modes-h");
      cards = [
        { id: "mode-learn", name: T("Learn"), desc: T("Five short lessons. One rule at a time."), badge: learnDone() ? T("complete") : T("start here"), act: () => startLearn(nextLearnIndex()) },
        { id: "mode-journey", name: T("Journey"), desc: T("40 authored stages with mastery tests."), act: () => show("journey", null) },
        { id: "mode-daily", name: T("Daily Hollow"), desc: T("One shared seed per UTC day. Everyone gets the same plaza."), badge: T("ranked"), act: openDaily },
        { id: "mode-practice", name: T("Practice"), desc: T("Relaxed play with undo. Never rated."), act: () => showModes("practice") },
        { id: "mode-challenges", name: T("Challenges"), desc: T("Move limits, no boost, cramped courts…"), act: () => showModes("challenges") },
        { id: "mode-hosted", name: T("Hosted Play"), desc: T("Local lobby with AI seats. Realtime rooms are planned for a later build."), badge: T("local lobby"), act: () => showModes("hosted") },
      ];
  }
  cardGrid("mode-cards", cards, w);
  backButton(w);
}

// ------------------------------------------------------------------ setup
function setupScreen(w: number): void {
  const stage = app.pendingStage;
  if (!stage) { goHome(); return; }
  heading("h3", stageName(stage), w, "setup-h");
  const desc = stage.description;
  if (desc) para(T(desc), w, "dim", "setup-desc");
  const boost = stage.boost === "off" ? T("disabled") : stage.boost === "limited" ? T("{n} uses", { n: stage.boostLimit ?? 0 }) : T("enabled");
  const s = stage;
  dl("setup-dl", [
    [T("Duration"), fmtTime(stage.durationSec)],
    [T("Rivals"), String((stage.rivals ?? []).length)],
    [T("Boost"), boost],
    [T("Ranked"), s.unrated ? T("No (practice)") : s.excluded ? T("Excluded from ranking") : T("Yes")],
    [T("Undo"), s.undoAllowed ? T("allowed") : T("not allowed")],
  ], w);
  heading("h4", T("Objectives"), w);
  const goals = stage.goals ?? [];
  ui.column("setup-goals", () => {
    if (!goals.length) para("• " + T("Outscore every rival."), w - 16);
    goals.forEach((g, i) => para("• " + goalText(g), w - 16, "body", `setup-goal-${i}`));
  }, { spacing: 4, width: w, padding: { start: 8 } });
  if (stage.kind === "daily") {
    const b = platform.plazaStandings();
    if (b && b.entries.length) {
      heading("h4", T("Plaza standings"), w);
      ui.column("setup-board", () => b.entries.forEach((e, i) => para(`${e.rank}. ${e.name} — ${e.score}`, w - 16, e.me ? "me" : "body", `board-${i}`)), { spacing: 3, width: w, padding: { start: 8 } });
      para(b.me ? T("Your rank: {rank} ({score})", { rank: b.me.rank, score: b.me.score }) : T("Ranked rounds post to the plaza board when you are signed in."), w, "dim");
    }
  }
  flow("setup-btns", [
    { id: "btn-start-match", text: T("Start"), style: ["btn", "btn-primary"], act: () => { click(); beginMatch(); } },
    { id: "btn-back", text: T("Back"), style: ["btn", "btn-ghost"], act: back },
  ], w);
}

// ------------------------------------------------------------------ journey
function journeyScreen(w: number, L: Layout): void {
  const doc = save();
  heading("h2", T("Journey"), w, "journey-h");
  para(T("One new idea at a time. Mastery stages test combined skills."), w, "dim");
  const stages = journeyAll();
  const cleared = Object.keys(doc.journey).length;
  const gap = 8;
  const cols = L.phone ? 5 : Math.max(4, Math.floor((w + gap) / (64 + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  ui.grid("journey-grid", () => {
    stages.forEach((s, i) => {
      const rec = doc.journey[s.id];
      const locked = i > 0 && !doc.journey[stages[i - 1]!.id] && i > cleared;
      const name = stageName(s);
      const label = locked ? T("{stage} (locked)", { stage: name }) : rec ? (rec.stars === 1 ? T("{stage}, {n} star", { stage: name, n: rec.stars }) : T("{stage}, {n} stars", { stage: name, n: rec.stars })) : name;
      const stars = "★".repeat(rec?.stars ?? 0);
      if (ui.style(s.mastery ? "journey-mastery" : "journey-cell", { width: cw, height: cw }).id(`stage-${s.index}`).button(label, {
        disabled: locked,
        content: () => {
          ui.style("body", { text: { align: "center" } }).label(s.mastery ? "★" : String(s.index));
          if (stars) ui.style("stars").label(stars);
        },
      })) openSetup(s);
    });
  }, { columns: cols, gap, width: w });
  backButton(w);
}

// ------------------------------------------------------------------ profile
let nameDraft: string | null = null;
function profileScreen(w: number): void {
  const doc = save();
  heading("h2", T("Profile"), w, "profile-h");
  if (platform.signedIn()) {
    para(`${doc.profile.name} ${T("(StarHermit account)")}`, w, "body", "profile-name");
    para(syncText(), w, "small", "profile-sync");
  } else para(`${pname(doc.profile.name)} ${T("(guest — progress stored on this device)")}`, w, "body", "profile-name");
  dl("profile-stats", [
    [T("Sessions played"), String(doc.sessionsPlayed)],
    [T("Mastery XP"), String(Math.floor(doc.masteryXp))],
    [T("Journey cleared"), `${Object.keys(doc.journey).length} / ${JOURNEY_COUNT}`],
    [T("Days played"), String((doc.playDays ?? []).length)],
  ], w);
  if (!platform.signedIn()) {
    // The name comes from the StarHermit account when signed in; a guest names themselves.
    ui.row("name-row", () => {
      para(T("Display name"), Math.max(80, w * 0.35), "body");
      ui.spacer();
      const cur = nameDraft ?? pname(doc.profile.name);
      const next = ui.textField("profile-name-field", cur, { maxChars: 20, width: Math.min(240, w * 0.6) });
      if (next !== cur) nameDraft = next;
      if (ui.submitted("profile-name-field") || (nameDraft !== null && ui.focused() !== "profile-name-field" && ui.focused() !== T("Display name"))) {
        if (nameDraft !== null) setName(nameDraft);
        nameDraft = null;
      }
    }, { width: w, align: "center", spacing: 10 });
  }
  heading("h3", T("Achievements"), w, "ach-h");
  ui.column("ach-list", () => {
    for (const [key, a] of Object.entries(ACHIEVEMENTS)) {
      const got = !!doc.achievements[key];
      ui.column(`ach-${key}`, () => para(`${T(a.name)} — ${T(a.desc)}${got ? " ✓" : ""}`, w - 28, "body"), { style: got ? "ach-unlocked" : "ach-locked", width: w });
    }
  }, { spacing: 6, width: w });
  backButton(w);
}

// ------------------------------------------------------------------ settings and help
function fieldset(id: string, legend: string, w: number, build: (inner: number) => void): void {
  ui.column(id, () => { ui.style("legend").label(legend); build(w - 26); }, { style: "fieldset", width: w, spacing: 9 });
}
function check(key: "captions" | "leftHanded" | "holdBoost", label: string): void {
  const cur = settings[key];
  const next = ui.id(`set-${key}`).checkbox(label, cur);
  if (next !== cur) { platform.setSetting(key, next); click(); }
}
const PALETTE_NAMES: Record<string, string> = { default: N("Default"), deuteranopia: N("Deuteranopia-safe"), protanopia: N("Protanopia-safe"), tritanopia: N("Tritanopia-safe") };
function settingsScreen(w: number): void {
  heading("h2", T("Settings"), w, "settings-h");
  const gap = 16;
  const cols = w >= 2 * 240 + gap ? 2 : 1;
  const cw = (w - gap * (cols - 1)) / cols;
  ui.grid("settings-cols", () => {
    fieldset("fs-audio", T("Audio"), cw, (inner) => {
      para(T("Music, effects and voice volumes and mute are in the StarHermit Options."), inner, "dim");
      check("captions", T("Captions for audio cues"));
    });
    fieldset("fs-display", T("Display"), cw, (inner) => {
      para(T("Reduced motion, high contrast, larger text and graphics quality are in the StarHermit Options."), inner, "dim");
      const cur = Math.max(0, PALETTES.indexOf(settings.palette));
      ui.row("palette-row", () => {
        para(T("Color palette"), Math.max(80, inner * 0.4), "body");
        ui.spacer();
        const next = ui.style({ width: Math.min(220, inner * 0.58) }).id("set-palette").select(T("Color palette"), cur, PALETTES.map((p) => T(PALETTE_NAMES[p]!)));
        if (next !== cur) platform.setSetting("palette", PALETTES[next]!);
      }, { width: inner, align: "center", spacing: 10 });
    });
    fieldset("fs-controls", T("Controls & access"), cw, (inner) => {
      check("leftHanded", T("Left-handed tray"));
      check("holdBoost", T("Hold-to-boost (off = toggle)"));
      flow("ctl-btns", [
        { id: "btn-rebind", text: T("Keyboard bindings"), style: ["btn", "btn-small"], act: () => requestRebind() },
        { id: "btn-options", text: T("Open Options"), style: ["btn", "btn-small"], act: () => openMenu() },
      ], inner);
    });
  }, { columns: cols, gap, width: w, align: "stretch" });
  flow("settings-btns", [
    { id: "btn-settings-close", text: T("Done"), style: ["btn", "btn-primary"], act: back },
    { id: "btn-replay-tutorial", text: T("Replay tutorial"), style: ["btn", "btn-ghost"], act: () => startLearn(0) },
  ], w);
}
function helpScreen(w: number): void {
  heading("h2", T("How to play"), w, "help-h");
  const cards: [string, string, string][] = [
    [N("Move"), T("Hold {keys} etc., or drag on the plaza. Your hollow follows.", { keys: moveKeys() }), N("You can always move while alive and the clock is running.")],
    [N("Consume"), T("Roll over anything smaller than you — it highlights when edible."), N("Motes first, then chunks, then boulders as you grow.")],
    [N("Grow"), T("Everything you eat adds mass. Bigger hollow, bigger appetite — but slower."), N("Radius follows the square root of mass.")],
    [N("Boost"), T("Hold {keys} or the ⚡ button. Boosting spends mass.", { keys: keyList("boost") }), N("Disabled in some challenges.")],
    [N("Embers"), T("Orange embers burn and shrink you. Give them room."), N("They are never edible.")],
    [N("Rivals"), T("Outweigh a rival by a quarter and you can swallow them."), N("Eaten rivals respawn — and remember you.")],
    [N("Scoring"), T("Rank by mass collected. Ties break on objectives, clean play, then speed."), N("Results show every component.")],
    [N("Pause"), T("{keys} pauses. Solo play also pauses when the tab hides.", { keys: keyList("pause") }), ""],
    [N("Undo"), T("In Practice, {keys} steps back to the previous moment.", { keys: keyList("undo") }), N("Not available in ranked modes.")],
  ];
  const gap = 13;
  const cols = Math.max(1, Math.floor((w + gap) / (200 + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  ui.grid("help-cards", () => {
    cards.forEach(([title, body, note], i) => ui.column(`help-${i}`, () => {
      para(T(title), cw - 34, "card-title");
      para(body, cw - 34, "card-desc");
      if (note) para(T(note), cw - 34, "card-desc");
    }, { style: "info-card", width: cw, spacing: 5 }));
  }, { columns: cols, gap, width: w, align: "stretch" });
  flow("help-btns", [{ id: "btn-help-close", text: T("Close"), style: ["btn", "btn-primary"], act: back }], w);
}

// ------------------------------------------------------------------ the match HUD
function card(id: string, build: () => void, w?: number): void {
  ui.column(id, build, { style: "hud-card", spacing: 2, ...(w ? { width: w } : {}) });
}
function objectiveCard(w: number): void {
  const s = app.session!;
  card("hud-objective", () => para(stageName(s.stage), w - 28, "hud-strong", "hud-stage"), w);
}
function goalsCard(w: number): void {
  const st = app.session!.state;
  card("hud-goals", () => {
    if (!st.goals.length) para(T("Outscore every rival"), w - 28, "hud-dim");
    st.goals.forEach((g, i) => {
      const text = `${g.done ? "✓ " : ""}${goalText(g)}${g.type !== "survive" ? ` (${Math.min(g.progress, g.target)}/${g.target})` : ""}`;
      para(text, w - 28, g.done ? "hud-done" : "hud-text", `hud-goal-${i}`);
    });
  }, w);
}
function massLine(): string {
  const me = app.session!.state.voids[0]!;
  return T("Mass <strong>{mass}</strong> · Collected <strong>{collected}</strong>", { mass: Math.floor(me.mass), collected: me.propMass + me.gemMass + me.rivalMass })
    .replace(/<\/?strong>/g, "");
}
function scoreCard(w: number): void {
  const s = app.session!;
  const me = s.state.voids[0]!;
  const q = s.query();
  card("hud-score", () => {
    para(massLine(), w - 28, "hud-strong", "hud-mass");
    if (!me.alive) para(T("Respawning…"), w - 28, "hud-dim");
    if (q.moveTicksLeft != null) para(T("Moves left {n}s", { n: (q.moveTicksLeft / TICK_RATE).toFixed(0) }), w - 28, "hud-text", "hud-moves");
    if (q.boostsLeft != null) para(T("Boosts left {n}", { n: q.boostsLeft }), w - 28, "hud-text", "hud-boosts");
  }, w);
}
function timerCard(): void {
  const s = app.session!;
  const remain = Math.max(0, s.stage.durationSec - s.state.tick / TICK_RATE);
  card("hud-timer", () => ui.style(remain < 15 ? "hud-timer-late" : "hud-timer").id("hud-timer-text").label(fmtTime(remain)));
}
function ranksCard(w: number): void {
  const st = app.session!.state;
  const ranks = [...st.voids].sort((a, b) => (b.propMass + b.gemMass + b.rivalMass) - (a.propMass + a.gemMass + a.rivalMass));
  const text = ranks.map((v, i) => `${i + 1}. ${pname(v.name)} ${v.propMass + v.gemMass + v.rivalMass}${v.alive ? "" : " ✝"}`).join(" · ");
  card("hud-ranks", () => para(text, w - 28, "hud-ranks", "hud-ranks-text", true));
}
function pauseButton(w?: number): void {
  // The ⏸ button (src/index.html #btn-pause): two drawn bars, named "Pause".
  const r = ui.id("btn-pause").widget(T("Pause"), {
    role: "button", size: { width: w ?? 52, height: 44 }, style: "hud-btn",
    draw: (rect, st) => {
      const k = st.scale, cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2;
      draw.rect(cx - 6 * k, cy - 8 * k, 4 * k, 16 * k, st.colors.text);
      draw.rect(cx + 2 * k, cy - 8 * k, 4 * k, 16 * k, st.colors.text);
    },
  });
  if (r.activated) pauseMatch();
}
/** The tray (src/index.html #action-tray): round buttons with a glyph and a small label. */
function tray(L: Layout): void {
  const s = app.session!;
  const size = L.shortLand ? 48 : 64;
  const items: { id: string; label: string; glyph: string; small: string; boost?: boolean; act?: () => void }[] = [];
  if (s.stage.undoAllowed) items.push({ id: "btn-undo", label: T("Undo"), glyph: "↩", small: T("undo"), act: doUndo });
  items.push({ id: "btn-hint", label: T("Hint"), glyph: "?", small: T("hint"), act: doHint });
  items.push({ id: "btn-boost", label: T("Boost (hold)"), glyph: "⚡", small: T("boost"), boost: true });
  items.push({ id: "btn-camera", label: T("Reset camera"), glyph: "◎", small: T("camera"), act: resetCamera });
  const build = (): void => {
    for (const it of items) {
      const on = it.boost && boostShown();
      const r = ui.id(it.id).widget(it.label, {
        role: "button", size: { width: size, height: size }, style: it.boost ? (on ? "tray-boost-on" : "tray-boost") : "tray-btn",
        draw: (rect, st) => {
          const k = st.scale;
          const cx = rect.x + rect.width / 2;
          draw.text(it.glyph, cx, rect.y + rect.height * (L.shortLand ? 0.22 : 0.18), { size: (L.shortLand ? 16 : 20.8) * k, color: st.colors.text, align: "center" });
          if (!L.shortLand) draw.text(it.small, cx, rect.y + rect.height * 0.62, { size: 10 * k, color: "#9db3a6", align: "center" });
        },
      });
      if (it.boost) trayBoost(r.pressed, r.activated);
      else if (r.activated) { ui.setFocus(null); it.act!(); }
    }
  };
  const gap = L.shortLand ? 8 : 12;
  let r: ui.Rect;
  if (L.shortLand) r = ui.place("action-tray", { anchor: "end", x: 10 }, () => ui.column("tray-col", build, { spacing: gap }));
  else if (settings.leftHanded) r = ui.place("action-tray", { anchor: "bottom-start", x: 12, y: 10 }, () => ui.row("tray-row", build, { spacing: gap }));
  else r = ui.place("action-tray", { anchor: "bottom", y: 10 }, () => ui.row("tray-row", build, { spacing: gap }));
  keep(r);
}

function gameScreen(L: Layout): void {
  const s = app.session;
  if (!s) { goHome(); return; }
  const f = frame();
  const playing = app.matchFlow === "playing";
  let hudBottom = 0;
  if (playing) {
    if (L.shortLand) {
      const w = Math.min(200, L.lw * 0.3);
      const r = ui.place("hud-left", { anchor: "top-start", x: 6, y: 6 }, () => ui.column("hud-left-col", () => {
        ui.row("hud-tp", () => { timerCard(); ui.spacer(); pauseButton(); }, { width: w, align: "center" });
        objectiveCard(w);
        goalsCard(w);
        scoreCard(w);
      }, { spacing: 6, width: w }));
      keep(r);
    } else if (L.phone) {
      const t = ui.place("hud-center", { anchor: "top", y: 8 }, () => ui.row("hud-center-row", () => timerCard(), { spacing: 8 }));
      keep(t);
      const top = t.height / L.sc + 16;
      const lw = Math.floor(L.lw * 0.6) - 12, rw = L.lw - lw - 24;
      const a = ui.place("hud-left", { anchor: "top-start", x: 8, y: top }, () => ui.column("hud-left-col", () => { objectiveCard(lw); goalsCard(lw); }, { spacing: 8, width: lw }));
      const b = ui.place("hud-right", { anchor: "top-end", x: 8, y: top }, () => ui.column("hud-right-col", () => { scoreCard(rw); pauseButton(rw); }, { spacing: 8, width: rw }));
      keep(a); keep(b);
      hudBottom = Math.max(a.y + a.height, b.y + b.height) / L.sc;
    } else {
      const rail = Math.min(L.lw * (L.compact ? 0.38 : 0.3), 340);
      const a = ui.place("hud-left", { anchor: "top-start", x: 8, y: 8 }, () => ui.column("hud-left-col", () => { objectiveCard(rail); goalsCard(rail); }, { spacing: 8 }));
      const b = ui.place("hud-right", { anchor: "top-end", x: 8, y: 8 }, () => ui.column("hud-right-col", () => { scoreCard(rail); pauseButton(rail); }, { spacing: 8, align: "end" }));
      const c = ui.place("hud-center", { anchor: "top", y: 8 }, () => ui.column("hud-center-col", () => {
        timerCard();
        if (!L.compact) ranksCard(Math.min(L.lw * 0.44, L.lw - 2 * rail - 48));
      }, { spacing: 6, align: "center" }));
      keep(a); keep(b); keep(c);
      hudBottom = (c.y + c.height) / L.sc;
      toastTop = (b.y + b.height) / L.sc - L.oy + 8;
    }
    tray(L);
    lessonBanner(L, hudBottom);
    voidLabels(L);
  }
  // Countdown numbers, then "GO" for a moment.
  const st = s.state;
  const cd = st.phase === "countdown" && playing ? String(Math.max(1, Math.ceil(st.countdownTicks / TICK_RATE))) : f.time < app.goUntil && playing ? T("GO") : null;
  if (cd && !app.overlay) ui.place("countdown", "center", () => ui.style("countdown", L.lw < 500 ? { text: { size: 72 } } : {}).id("countdown-text").label(cd));
  if (app.overlay === "pause") pauseDialog(L);
  else if (app.overlay === "results") resultsDialog(L);
}

/** The lesson banner: below the HUD cards above it, never over them. */
function lessonBanner(L: Layout, hudBottom: number): void {
  const tut = app.tutorial;
  const step = tut?.step;
  if (!tut || !step) return;
  const w = Math.min(L.phone ? L.lw - 24 : 520, L.lw - 24);
  const y = (L.shortLand ? 8 : hudBottom ? hudBottom - L.oy + 8 : 78);
  const at = L.shortLand ? { anchor: "top-end" as const, x: 76, y } : { anchor: "top" as const, y };
  const bw = L.shortLand ? Math.min(w, L.lw - Math.min(200, L.lw * 0.3) - 100) : w;
  const r = ui.place("tutorial-banner", at, () => ui.column("banner-col", () => {
    para(T(step.text), bw - 40, "body", "tutorial-text", true);
    if (step.hint) para(T(step.hint), bw - 40, "dim", "tutorial-hint", true);
    flow("banner-btns", [{ id: "btn-tutorial-skip", text: T("Skip lesson"), style: ["btn", "btn-ghost", "btn-small"], act: () => tut.skip() }], bw - 40, "center");
  }, { style: "banner", width: bw, spacing: 4, align: "center" }));
  keep(r);
}

/** Name and mass over each void (src/main.js updateLabels). */
function voidLabels(L: Layout): void {
  if (app.overlay) return;
  const st = app.session!.state;
  const sc = L.sc;
  for (const v of st.voids) {
    if (!v.alive) continue;
    const p = render.projectToScreen(v.x, v.y, v.r * 1.6);
    if (!p.visible) continue;
    const text = `${v.id === 0 ? "▶ " : ""}${pname(v.name)} · ${Math.floor(v.mass)}`;
    const tw = ui.measureText(text, { style: ["void-label-text"] });
    const w = tw.width + 14 * sc, h = tw.height + 2 * sc;
    const x = p.x - w / 2, y = p.y - h;
    draw.roundRect(x, y, w, h, 8 * sc, "#0000008c");
    draw.text(text, p.x, y + sc, { size: 12 * sc * ui.preferences().textScale, color: "#e8f0ea", align: "center" });
  }
}

// ------------------------------------------------------------------ dialogs
/** A modal card: a scrolling body when taller than the window, a pinned footer (its buttons stay clickable). */
function dialogFrame(label: string, L: Layout, maxW: number, build: (w: number) => void, footer: ((w: number) => void) | null, onClose: () => void): void {
  const w = Math.min(maxW, L.lw - 24) - 44;
  const fh = footer ? (lastSize.get(`dlg-${label}-foot`) ?? 56) + 12 : 0;
  const avail = Math.max(80, L.lh * 0.92 - 44 - fh);
  const h = lastSize.get(`dlg-${label}`) ?? 0;
  const body = (): void => {
    const r = ui.column(`${label}-body`, () => build(w), { spacing: 10, width: w });
    lastSize.set(`dlg-${label}`, r.height / L.sc);
  };
  const fresh = frame().frame - app.openedFrame <= 4;
  const open = ui.dialog(label, "", true, () => {
    if (h > avail) ui.scrollArea(`${label}-scroll`, { width: w + 14, height: avail }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
    if (footer) {
      const r = ui.column(`${label}-foot`, () => footer(w), { width: w, spacing: 8, padding: { top: 12 } });
      lastSize.set(`dlg-${label}-foot`, r.height / L.sc - 12);
    }
  });
  // The Escape (or East) that opened it must not close it the same frame.
  if (!open && frame().frame !== app.openedFrame) onClose();
}
function pauseDialog(L: Layout): void {
  dialogFrame(T("Paused"), L, 420, (w) => {
    heading("h2", T("Paused"), w, "pause-h");
    if (app.pauseAway) para(T(app.pauseAway), w, "dim", "pause-away");
    button({ id: "btn-resume", text: T("Resume"), style: ["btn", "btn-primary", "btn-big"], act: resumeMatch }, w);
    ui.column("pause-stack", () => {
      button({ id: "btn-pause-settings", text: T("Settings"), style: ["btn", "btn-secondary"], act: () => openPage("settings") }, w);
      button({ id: "btn-pause-help", text: T("Help"), style: ["btn", "btn-secondary"], act: () => openPage("help") }, w);
      button({ id: "btn-restart", text: T("Restart"), style: ["btn", "btn-secondary"], act: restartMatch }, w);
      button({ id: "btn-leave", text: T("Leave match"), style: ["btn", "btn-danger"], act: leaveMatch }, w);
    }, { spacing: 10, width: w });
  }, null, resumeMatch);
}
function resultsDialog(L: Layout): void {
  const r = app.results;
  if (!r) return;
  const me = r.rankings.find((x) => x.id === 0);
  const won = me?.place === 1 || r.terminalReason === "lesson_complete";
  dialogFrame(T("Results"), L, 780, (w) => {
    heading("h2", T("{stage} — Results", { stage: stageName(r.stage) }), w, "results-h");
    para(resultsHeadline(r), w, "headline", "results-headline");
    if (L.lh > 560) ui.column("results-art", () => { /* the art is the style */ }, { style: won ? "art-win" : "art-defeat", width: w, height: Math.min(150, w * 0.26) });
    const two = w >= 560;
    const cw = two ? (w - 20) / 2 : w;
    const standings = (): void => { ui.column("results-standings", () => {
      heading("h3", T("Standings"), cw);
      r.rankings.forEach((x, i) => para(`${i + 1}. ` + (x.deaths ? T("{name} — {n} collected, {deaths} ✝", { name: pname(x.name), n: x.massCollected, deaths: x.deaths }) : T("{name} — {n} collected", { name: pname(x.name), n: x.massCollected })),
        cw - 12, x.id === 0 ? "me" : "body", `standing-${i}`));
    }, { spacing: 4, width: cw }); };
    const breakdown = (): void => { ui.column("results-breakdown", () => {
      const bd = r.breakdown;
      heading("h3", T("Your score breakdown"), cw);
      dl("results-dl", [
        [T("Props consumed"), String(bd.props)],
        [T("Gems ({n})", { n: bd.gemCount }), String(bd.gems)],
        [T("Rivals ({n})", { n: bd.rivalCount }), String(bd.rivals)],
        [T("Survival bonus"), String(bd.survivalBonus)],
        [T("Invalid-action penalty"), String(bd.invalidPenalty)],
        [T("Total"), String(bd.total), true],
      ], cw);
      heading("h3", T("Objectives"), cw);
      if (!r.goals.length) para("—", cw);
      r.goals.forEach((g, i) => para(`${g.done ? "✓" : "✗"} ${goalText(g)}`, cw - 12, g.done ? "accent" : "body", `results-goal-${i}`));
      const prog = progressLine();
      if (prog) para(prog, cw, "dim", "results-progress");
      para(replayLine(), cw, "dim", "results-replay");
      const lb = leaderboardLine();
      if (lb) para(lb, cw, "body", "results-lb");
    }, { spacing: 4, width: cw }); };
    if (two) ui.row("results-cols", () => { standings(); breakdown(); }, { spacing: 20, align: "start", width: w });
    else { standings(); breakdown(); }
  }, (w) => {
    flow("results-btns", [
      { id: "btn-next", text: T("Next"), style: ["btn", "btn-primary"], act: nextRecommended },
      { id: "btn-retry", text: T("Retry"), style: ["btn", "btn-secondary"], act: restartMatch },
      { id: "btn-results-home", text: T("Home"), style: ["btn", "btn-ghost"], act: () => { click(); goHome(); } },
    ], w);
  }, () => { app.openedFrame = frame().frame; /* the results stay until a choice is made */ });
}

// ------------------------------------------------------------------ toasts and captions
let toastTop = 64;
function toasts(L: Layout): void {
  // Over a screen or dialog the stack sits at the top edge; during play at the top end, under the HUD.
  const menu = app.screen !== "game" || !!app.overlay;
  const w = Math.min(menu ? 520 : 260, L.lw - 24);
  let y = menu || L.phone || L.shortLand ? 8 : toastTop;
  for (const [i, t] of app.toasts.entries()) {
    const at = menu || L.phone ? { anchor: "top" as const, y } : L.shortLand ? { anchor: "top" as const, y } : { anchor: "top-end" as const, x: 12, y };
    const r = ui.place(`toast-${i}`, at, () => ui.column(`toast-col-${i}`, () => para(t.text, w - 30, "toast-text", `toast-${i}-text`), { style: "toast" }));
    y += r.height / L.sc + 8;
  }
  if (app.caption && app.screen === "game") {
    const text = app.caption.text;
    ui.place("captions", { anchor: "bottom", y: L.shortLand ? 12 : 90 }, () => ui.column("caption-col", () => para(text, Math.min(L.lw - 60, 480), "caption-text", "caption-text", true), { style: "caption" }));
  }
}
