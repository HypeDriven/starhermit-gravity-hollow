// The game's data and the StarHermit platform, on the runtime's modules:
// - the save document (src/session.js: profile, Journey stars and bests,
//   finished lessons, daily results, challenges, achievements, counters, play
//   days) is the game's save (starhermit:storage `saves`) on the device and in
//   the player's cloud slot; two devices' copies merge on a conflict
//   (src/session.js mergeSaves: the best of each). The slot the browser build
//   wrote (the JS SDK's saveJSON of { v, save, savedAt } under game:<slug>)
//   shows as foreign: it is merged in and replaced once;
// - src/session.js keeps reading and writing `localStorage`: here a shim whose
//   save key is that save and whose other keys (the last replays) are the
//   device's starhermit:storage, as the browser build kept them on the device;
// - the game's own options (sound captions, the rival colour palette, the
//   left-handed tray, hold-to-boost) are `settings` (game.<key>, synced with
//   the account); the browser build's account settings (its settings KV) are
//   migrated, then removed. Volumes, mute, graphics, language, reduced motion,
//   high contrast, text size, vibration and key bindings are the runtime's;
// - the player (signed in or a guest), the invite link, the platform's clock
//   for the daily, the read-only plaza standings, and posting a ranked round
//   through score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did) with the
//   rank on the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import { Sess, type SaveDoc } from "./game.ts";

export type { SaveDoc };
const { loadSave, mergeSaves } = Sess;
const SAVE_KEY = "gravity-hollow:save:v1";

// --- the save and the localStorage shim ----------------------------------------------
let current: SaveDoc | null = null;
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

/** src/session.js's checksum envelope of a document ({ v, data, checksum }). */
const envelope = (data: unknown): string => Sess.envelopeJson(data);
function persist(): void {
  if (!current) return;
  try { saves.save(current as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
const shim = {
  getItem(key: string): string | null {
    if (key === SAVE_KEY) return current ? envelope(current) : null;
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    if (key === SAVE_KEY) {
      try { current = (JSON.parse(value) as { data: SaveDoc }).data; } catch { return; }
      persist();
      return;
    }
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    if (key === SAVE_KEY) { current = null; return; }
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

/** A save document read from anywhere (the engine save, the browser build's cloud slot), or null. */
export function readDoc(raw: unknown): SaveDoc | null { return Sess.parseSaveDoc(raw, blank()); }
function blank(): SaveDoc {
  const saved = current;
  current = null;
  const fresh = loadSave();
  current = saved;
  return fresh;
}

/** The live save document (rounds update it in place and save it). */
let live: SaveDoc | null = null;
export function save(): SaveDoc {
  if (!live) live = loadSave();
  return live;
}
/** Saves the live document (device at once, the account debounced by the runtime). */
export function saveNow(): void {
  current = save();
  persist();
}

/** Merges another copy into the live document (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const remote = readDoc(other);
  if (!remote) return false;
  const doc = save();
  const next = mergeSaves(doc, remote);
  syncName(next);
  if (JSON.stringify(next) === JSON.stringify(doc)) return false;
  for (const k of Object.keys(doc)) delete (doc as unknown as Record<string, unknown>)[k];
  Object.assign(doc, next);
  saveNow();
  return true;
}

saves.onConflict((local, remote) => {
  const a = readDoc(local?.data ?? null), b = readDoc(remote.data);
  const out = a && b ? mergeSaves(a, b) : (a ?? b ?? save());
  return { merged: out as unknown as JsonValue };
});
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  let doc: unknown = null;
  try { doc = old.text ? JSON.parse(old.text) : null; } catch { doc = null; }
  const changed = adopt(doc);
  current = save();
  try { saves.save(current as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (changed) merged();
}

/** For the title and profile: local (a guest) | saving | synced | offline. */
export function syncState(): "local" | "saving" | "synced" | "offline" {
  if (!player()) return "local";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "offline";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

/** Signed in, the account's name is the profile's (the browser build did the same at sign-in). */
function syncName(doc: SaveDoc): void {
  const me = player();
  if (!me) return;
  doc.profile = { ...(doc.profile ?? {}), name: me.displayName || doc.profile?.name || "Wanderer", guest: false };
}

// --- the game's options ---------------------------------------------------------------
export type Palette = "default" | "deuteranopia" | "protanopia" | "tritanopia";
export const PALETTES: Palette[] = ["default", "deuteranopia", "protanopia", "tritanopia"];
export interface Settings { captions: boolean; palette: Palette; leftHanded: boolean; holdBoost: boolean }
export const settings: Settings = { captions: true, palette: "default", leftHanded: false, holdBoost: true };
type Key = keyof Settings;
const KEYS: Key[] = ["captions", "palette", "leftHanded", "holdBoost"];
const settingsListeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }
function settingsChanged(): void { for (const fn of settingsListeners) fn(); }
function check(key: Key, v: unknown): boolean | string | undefined {
  if (key === "palette") return typeof v === "string" && (PALETTES as string[]).includes(v) ? v : undefined;
  return typeof v === "boolean" ? v : undefined;
}
function readSetting(key: Key): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = check(key, v);
  if (ok !== undefined) (settings as unknown as Record<string, unknown>)[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptSetting(key: Key, value: unknown): void {
  const v = check(key, value);
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v);
    (settings as unknown as Record<string, unknown>)[key] = v;
    settingsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setSetting<K extends Key>(key: K, value: Settings[K]): void {
  if (settings[key] === value) return;
  settings[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
  settingsChanged();
}
// The browser build's account settings (src/platform.js SYNCED_SETTINGS, patched
// key by key, and the language helper's ui.language): the game's options among
// them carry over (unless this game set them since), then all are removed.
export const BROWSER_KEYS = [
  "music", "effects", "ambience", "voice", "muted", "graphics", "reducedMotion", "highContrast",
  "largeText", "palette", "leftHanded", "holdBoost", "timingAssist", "haptics", "cameraSway", "captions", "ui.language",
];
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if ((KEYS as string[]).includes(key)) adoptSetting(key as Key, store.legacy(key));
  for (const key of keys) if (BROWSER_KEYS.includes(key)) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  current = readDoc(cur?.data ?? null);
  live = loadSave();
  syncName(live);
  for (const k of KEYS) readSetting(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readSetting(key as Key);
    settingsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  settingsChanged();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ----------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = null;
  standings = undefined;
  if (live) { syncName(live); if (player()) saveNow(); }
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}

// --- the StarHermit high-score board ---------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? null;
  return board;
}

export interface Standings { entries: { rank: number; name: string; score: number; me: boolean }[]; me: { rank: number; score: number } | null }
let standings: Standings | null | undefined;
/** The high-score board's top entries for the Daily Hollow setup (null: none / offline; undefined: not read yet). */
export function plazaStandings(): Standings | null | undefined { return standings; }
let reading = false;
/** Reads the board once (again after a posted score). Guests can read it too. */
export function loadStandings(): void {
  if (standings !== undefined || reading) return;
  reading = true;
  void (async () => {
    try {
      const b = await highScoreBoard();
      if (!b) { standings = null; return; }
      const r = await leaderboards.entries(b.id, { pageSize: 10 });
      const meId = player()?.userId;
      const entries = r.items.map((e, i) => ({ rank: e.rank ?? i + 1, name: e.displayName || e.username, score: e.score ?? 0, me: !!meId && e.userId === meId }));
      const mine = entries.find((e) => e.me);
      standings = { entries, me: mine ? { rank: mine.rank, score: mine.score } : null };
    } catch { standings = null; } finally { reading = false; }
  })();
}

/** Signed in only: post a ranked round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  standings = undefined; // re-read the plaza standings next time
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
