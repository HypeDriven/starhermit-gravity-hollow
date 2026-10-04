// Gravity Hollow — StarHermit platform layer over window.StarHermit
// (starhermit-sdk.js, loaded by index.html before the game modules). The SDK
// reads the launch token (#game_token=… library launch or #access_token=…
// sign-in return), strips it, renews it, and owns the cloud-save slot
// game:<slug>, the settings KV and the controls endpoint. This layer resolves
// the account nickname, mirrors the save document, syncs preferences and key
// bindings, and reads the leaderboard. With no token every call is skipped:
// connectPlatform() returns null and offline play makes no request.

const sdk = () => globalThis.StarHermit ?? null;

/** Preferences mirrored to the settings KV (same keys as the local settings). */
export const SYNCED_SETTINGS = [
  'music', 'effects', 'ambience', 'voice', 'muted', 'graphics', 'reducedMotion', 'highContrast',
  'largeText', 'palette', 'leftHanded', 'holdBoost', 'timingAssist', 'haptics', 'cameraSway', 'captions',
];

/** True on <slug>.starhermit.com without a token: offer "Sign in with StarHermit". */
export const canSignIn = () => !!sdk()?.canSignIn();
export const signIn = () => !!sdk()?.signIn();

export class Platform {
  constructor(sh) {
    this.sh = sh;
    this.userId = sh.userId;               // stable account id
    this.slug = sh.slug;
    this.nickname = null;
    this.onSyncStatus = null;              // (status: 'synced'|'saving'|'offline') => void
    this.onSignedOut = null;               // () => void — renewal refused
    this._lastSettings = null;
    this._lastBindings = null;
    sh.on('saved', (ok) => this.setStatus(ok ? 'synced' : 'offline'));
    sh.on('auth', (a) => { if (!a.signedIn) this.onSignedOut?.(); });
    this._flushHandler = () => { if (document.visibilityState !== 'visible') this.flushSave(); };
    document.addEventListener('pagehide', this._flushHandler);
    document.addEventListener('visibilitychange', this._flushHandler);
  }

  get signedIn() { return !!this.sh.signedIn; }

  // ------------------------------------------------------------------ profile

  // Display nickname for the signed-in account ("Player <id>" fallback);
  // never the username, never /api/v1/me (403 for launch tokens).
  async loadProfile() {
    if (!this.userId) return null;
    const p = await this.sh.profile(this.userId).catch(() => null);
    this.nickname = p?.displayName ?? null;
    return this.nickname;
  }

  async nicknameFor(userId) {
    if (!userId) return null;
    const p = await this.sh.profile(userId).catch(() => null);
    return p?.displayName ?? 'Player ' + String(userId).slice(0, 6);
  }

  /** Share link that friends the recipient and invites them back. */
  inviteLink() { return this.signedIn ? this.sh.inviteLink() : null; }

  // --------------------------------------------------------------- cloud save

  setStatus(s) { this.onSyncStatus?.(s); }

  /** The remote {v, save, savedAt} document, or null (none yet / unreachable). */
  async loadCloudSave() {
    try {
      const info = await this.sh.saveInfo();
      if (info && info.exists === false) return null;
      const doc = await this.sh.loadJSON();
      if (doc) this.setStatus('synced');
      return doc;
    } catch { return null; } // offline/unreachable: the local cache wins
  }

  // Debounced (~2 s) mirror of the local save document; localStorage stays
  // the offline cache.
  scheduleSave(doc) {
    if (!this.signedIn) return;
    this.setStatus('saving');
    this.sh.saveJSON({ v: 1, save: doc, savedAt: Date.now() });
  }

  flushSave() { return this.signedIn ? this.sh.flushSave(true) : Promise.resolve(false); }

  // ----------------------------------------------------- settings & bindings

  async loadSettings() { return this.signedIn ? this.sh.getSettings().catch(() => ({})) : {}; }

  /** Platform bindings over the given defaults ({ action: codes[] }). */
  async loadBindings(defaults) { return this.signedIn ? this.sh.loadBindings(defaults).catch(() => defaults) : defaults; }

  /** Remember what the platform already holds (no patch for the boot state). */
  baseline(settings) {
    this._lastSettings = JSON.stringify(subset(settings));
    this._lastBindings = JSON.stringify(settings.bindings);
  }

  /** Patch changed preferences and save changed bindings to the platform. */
  sync(settings) {
    if (!this.signedIn || this._lastSettings === null) return;
    const prefs = subset(settings), json = JSON.stringify(prefs), binds = JSON.stringify(settings.bindings);
    if (json !== this._lastSettings) { this._lastSettings = json; this.sh.patchSettings(prefs); }
    if (binds !== this._lastBindings) { this._lastBindings = binds; this.sh.setControls(settings.bindings).catch(() => {}); }
  }

  // --------------------------------------------------------------- leaderboard

  // Read-only: the platform owns submission. Returns null when there is no
  // board or we are offline — callers show local records only.
  async fetchBoard(pageSize = 10) {
    if (!this.signedIn) return null;
    try {
      const info = await this.sh.getGame();
      if (!info?.leaderboardId) return null;
      const data = await this.sh.leaderboardEntries(info.leaderboardId, { pageSize });
      const raw = data.entries ?? data.items ?? [];
      const entries = await Promise.all(raw.map(async (e, i) => ({
        rank: e.rank ?? i + 1,
        name: await this.nicknameFor(e.userId ?? e.user_id ?? e.id),
        score: e.score ?? e.value ?? 0,
        me: (e.userId ?? e.user_id ?? e.id) === this.userId,
      })));
      const me = info.me?.rank != null
        ? { rank: info.me.rank, score: info.me.score ?? info.me.bestScore ?? 0 }
        : null;
      return { entries, me };
    } catch { return null; }
  }

  destroy() {
    document.removeEventListener('pagehide', this._flushHandler);
    document.removeEventListener('visibilitychange', this._flushHandler);
  }
}

function subset(settings) {
  const out = {};
  for (const k of SYNCED_SETTINGS) out[k] = settings[k];
  return out;
}

/** Apply platform preferences over local ones (type-checked); true when any changed. */
export function applyRemoteSettings(settings, remote) {
  let changed = false;
  for (const k of SYNCED_SETTINGS) {
    const v = remote?.[k];
    if (v == null) continue;
    const ok = k === 'graphics' ? typeof v === 'object' && !Array.isArray(v) : typeof v === typeof settings[k];
    if (ok && JSON.stringify(v) !== JSON.stringify(settings[k])) { settings[k] = v; changed = true; }
  }
  return changed;
}

// Returns a Platform when the SDK holds a launch token, else null (offline play).
export function connectPlatform(sh = sdk()) {
  if (!sh) return null;
  if (!sh.__hollowInit) { sh.__hollowInit = true; sh.init(); }
  return sh.signedIn && sh.slug ? new Platform(sh) : null;
}
