// Gravity Hollow — StarHermit platform layer. Reads the launch token from the
// URL fragment, keeps it fresh, resolves the account nickname, mirrors the
// local save document to the cloud slot (stored zip), and reads the game
// leaderboard. Everything degrades to local/offline play when no token was
// read: every method is a safe no-op offline.

// ------------------------------------------------------------ token parsing

function readLaunchToken() {
  // Platform launch: #game_token=<jwt>[&session_id=<guid>]. Read once, then
  // strip the fragment so the token never lingers in the URL. Query-param
  // fallbacks exist for local dev only; the platform never sends them.
  if (location.hash.length > 1) {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get('game_token');
    if (token) {
      params.delete('game_token');
      params.delete('session_id');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
      return token;
    }
  }
  const q = new URLSearchParams(location.search);
  return q.get('game_token') ?? q.get('token') ?? q.get('launch') ?? q.get('launchToken');
}

// Decode the JWT payload (base64url, no verification — the API is the authority).
function decodeJwtPayload(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const payload = JSON.parse(atob(b64 + pad));
    return payload && typeof payload === 'object' ? payload : null;
  } catch { return null; }
}

// ---------------------------------------------------------- stored-zip helper
// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0); // attrs + local-header offset
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const REFRESH_MS = 45 * 60 * 1000;  // token lifetime is 60 min; re-mint early
const REFRESH_RETRY_MS = 60 * 1000;
const SAVE_DEBOUNCE_MS = 2000;

export class Platform {
  // token: raw JWT; payload: decoded {sub, game_scope} (may be null).
  constructor(token, payload) {
    this.token = token;
    this.userId = payload?.sub ?? null;   // stable account id
    this.slug = payload?.game_scope ?? null;
    this.nickname = null;
    this.onSyncStatus = null;             // (status: 'synced'|'saving'|'offline') => void
    this._nickCache = new Map();
    this._saveTimer = null;
    this._pendingDoc = null;
    this._pushing = false;
    this._refreshTimer = null;
    this._flushHandler = () => this.flushSave();
    document.addEventListener('pagehide', this._flushHandler);
    document.addEventListener('visibilitychange', this._flushHandler);
  }

  // Authenticated same-origin REST: Bearer on every call. Returns the raw
  // Response so callers decide how to parse (JSON, zip bytes, 404…).
  api(path, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    headers.authorization = `Bearer ${this.token}`;
    return fetch(path, { ...opts, headers });
  }

  async apiJson(path, opts = {}) {
    const res = await this.api(path, opts);
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  }

  // ------------------------------------------------------------ token refresh

  startRefresh() {
    if (!this.slug) return; // scoped tokens re-mint per game; no slug, no refresh
    const tick = async () => {
      try {
        const res = await this.api(`/api/v1/games/${encodeURIComponent(this.slug)}/launch-token`, { method: 'POST' });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (body.token) this.token = body.token;
        this._refreshTimer = setTimeout(tick, REFRESH_MS);
      } catch {
        this._refreshTimer = setTimeout(tick, REFRESH_RETRY_MS);
      }
    };
    this._refreshTimer = setTimeout(tick, REFRESH_MS);
  }

  // ------------------------------------------------------------------ profile

  // Display nickname for the signed-in account; never the username, never
  // /api/v1/me (403 for launch tokens).
  async loadProfile() {
    if (!this.userId) return null;
    try {
      const p = await this.apiJson(`/api/v1/users/${encodeURIComponent(this.userId)}/profile`);
      this.nickname = p.nickname || null;
      return this.nickname;
    } catch { return null; }
  }

  async nicknameFor(userId) {
    if (!userId) return null;
    if (this._nickCache.has(userId)) return this._nickCache.get(userId);
    let nick = null;
    try {
      const p = await this.apiJson(`/api/v1/users/${encodeURIComponent(userId)}/profile`);
      nick = p.nickname || null;
    } catch { /* fall through to the id fallback */ }
    if (!nick) nick = 'Player ' + String(userId).slice(0, 8);
    this._nickCache.set(userId, nick);
    return nick;
  }

  // --------------------------------------------------------------- cloud save

  setStatus(s) { this.onSyncStatus?.(s); }

  async loadCloudSave() {
    if (!this.slug) return null;
    try {
      const res = await this.api(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`);
      if (res.status === 404) return null; // no remote save yet
      if (!res.ok) throw new Error(String(res.status));
      const bytes = new Uint8Array(await res.arrayBuffer());
      const doc = JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
      this.setStatus('synced');
      return doc;
    } catch { return null; } // offline/unreachable: the local cache wins
  }

  // Debounced mirror of the local save document. localStorage stays the
  // offline cache; the cloud slot holds the same doc.
  scheduleSave(doc) {
    if (!this.slug) return;
    this._pendingDoc = doc;
    this.setStatus('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.pushSave(), SAVE_DEBOUNCE_MS);
  }

  flushSave() {
    if (!this._pendingDoc) return;
    clearTimeout(this._saveTimer);
    this.pushSave(this._pendingDoc, true);
  }

  async pushSave(doc = this._pendingDoc, keepalive = false) {
    if (!this.slug || !doc) return;
    if (this._pushing) { this._pendingDoc = doc; return; }
    this._pushing = true;
    this._pendingDoc = null;
    try {
      const payload = { v: 1, save: doc, savedAt: Date.now() };
      const bytes = zipStore('save.json', new TextEncoder().encode(JSON.stringify(payload)));
      const res = await this.api(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataBase64: bytesToBase64(bytes) }),
        keepalive,
      });
      this.setStatus(res.ok ? 'synced' : 'offline');
    } catch {
      this.setStatus('offline');
      this._pendingDoc = doc; // retry on the next schedule/flush
    } finally { this._pushing = false; }
  }

  // --------------------------------------------------------------- leaderboard

  // Read-only: the platform owns submission (hosted rooms score server-side;
  // solo modes stay client-simulated with local records). Returns null when
  // there is no board or we are offline — callers show local records only.
  async fetchBoard(pageSize = 10) {
    if (!this.slug) return null;
    try {
      const info = await this.apiJson(`/api/v1/games/${encodeURIComponent(this.slug)}`);
      if (!info.leaderboardId) return null;
      const res = await this.api(`/api/v1/leaderboards/${encodeURIComponent(info.leaderboardId)}/entries?page=1&pageSize=${pageSize}`);
      if (!res.ok) return null;
      const data = await res.json();
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
    clearTimeout(this._refreshTimer);
    clearTimeout(this._saveTimer);
    document.removeEventListener('pagehide', this._flushHandler);
    document.removeEventListener('visibilitychange', this._flushHandler);
  }
}

// Returns a Platform when a launch token is present, else null (offline play).
export function connectPlatform() {
  const token = readLaunchToken();
  if (!token) return null;
  return new Platform(token, decodeJwtPayload(token));
}
