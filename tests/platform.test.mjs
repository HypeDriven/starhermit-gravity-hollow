// src/platform.js on the real StarHermit SDK with a stubbed fetch and launch
// URL. Run: node --test tests/platform.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectPlatform, applyRemoteSettings } from '../src/platform.js';
import { DEFAULT_SETTINGS } from '../src/session.js';

// The package is ESM, so the UMD SDK is evaluated with a CommonJS-style module object.
const SDK = (() => { const module = { exports: {} }; new Function('module', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(module); return module.exports; })();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'h.' + b64u({ sub: 'void-12345678', game_scope: 'hollow-id', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

function harness(href, routes = {}) {
  const calls = [], store = {}, url = new URL(href);
  const win = { location: { hash: url.hash, search: url.search, pathname: url.pathname, origin: url.origin, hostname: url.hostname, href }, history: { replaceState: (a, b, u) => { win.replaced = u; } } };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET'; calls.push({ path, method, body: init.body });
    if (path.includes('/cloud-saves/')) {
      const key = decodeURIComponent(path.split('/cloud-saves/')[1]);
      if (key.endsWith('/info')) return new Response(JSON.stringify({ exists: !!store[key.slice(0, -5)] }), { status: 200 });
      if (method === 'PUT') { store[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); return new Response('{}', { status: 200 }); }
      return store[key] ? new Response(store[key], { status: 200 }) : new Response('', { status: 404 });
    }
    const hit = Object.entries(routes).find(([k]) => `${method} ${path}`.endsWith(k));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('', { status: 404 });
  };
  const sh = SDK.create({ window: win, fetch, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; } });
  return { platform: connectPlatform(sh), sh, calls, store, win };
}

test('hosted: token read, nickname, game:<slug> save round-trip, settings + bindings sync', async () => {
  const h = harness('https://hollow-id.starhermit.com/#game_token=' + TOKEN, {
    'GET /api/v1/users/void-12345678/profile': { username: 'raw', nickname: 'Event Horizon' },
    'GET /api/v1/games/hollow-id/settings': { settings: { music: 0.1, palette: 'protanopia', haptics: 'x' } },
    'PATCH /api/v1/games/hollow-id/settings': {},
    'GET /api/v1/games/hollow-id/controls': { actions: [{ action: 'boost', codes: ['KeyB'] }] },
    'PUT /api/v1/games/hollow-id/controls': {},
  });
  const p = h.platform;
  assert.ok(p); assert.equal(p.userId, 'void-12345678'); assert.equal(p.slug, 'hollow-id');
  assert.equal(h.win.replaced, '/');
  assert.equal(await p.loadProfile(), 'Event Horizon');
  assert.equal(await p.loadCloudSave(), null, 'empty slot');
  const statuses = []; p.onSyncStatus = (s) => statuses.push(s);
  p.scheduleSave({ profile: { name: 'Event Horizon' }, journey: { s1: 3 } });
  assert.equal(await p.flushSave(), true);
  assert.deepEqual(statuses, ['saving', 'synced']);
  assert.deepEqual(Object.keys(h.store), ['game:hollow-id']);
  assert.ok(h.calls.some((c) => c.method === 'PUT' && c.path === '/api/v1/me/cloud-saves/' + encodeURIComponent('game:hollow-id')));
  assert.deepEqual((await p.loadCloudSave()).save.journey, { s1: 3 });

  const settings = structuredClone({ ...DEFAULT_SETTINGS, graphics: {} });
  assert.equal(applyRemoteSettings(settings, await p.loadSettings()), true);
  assert.equal(settings.music, 0.1); assert.equal(settings.palette, 'protanopia'); assert.equal(settings.haptics, true);
  settings.bindings = await p.loadBindings(settings.bindings);
  assert.deepEqual(settings.bindings.boost, ['KeyB']); assert.deepEqual(settings.bindings.up, ['KeyW', 'ArrowUp']);
  p.baseline(settings);
  p.sync(settings);
  assert.equal(h.calls.filter((c) => c.method === 'PATCH').length, 0, 'unchanged state is not patched');
  settings.effects = 0.2; settings.bindings.hint = ['KeyJ'];
  p.sync(settings);
  const patch = h.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/api/v1/games/hollow-id/settings'); assert.equal(JSON.parse(patch.body).settings.effects, 0.2);
  const put = h.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/controls'));
  assert.deepEqual(JSON.parse(put.body).bindings.hint, ['KeyJ']);
  assert.match(p.inviteLink(), /\/game-invite\/void-12345678\/hollow-id$/);
});

test('renewal refused notifies the game', () => {
  const h = harness('https://hollow-id.starhermit.com/#game_token=' + TOKEN);
  let out = 0; h.platform.onSignedOut = () => out++;
  h.sh.signOut('expired');
  assert.equal(out, 1); assert.equal(h.platform.inviteLink(), null);
});

test('standalone: no platform, no requests; sign-in only on the platform host', () => {
  const local = harness('http://127.0.0.1:8080/');
  assert.equal(local.platform, null); assert.equal(local.sh.canSignIn(), false);
  const host = harness('https://hollow-id.starhermit.com/');
  assert.equal(host.platform, null); assert.equal(host.sh.canSignIn(), true);
  assert.equal(local.calls.length + host.calls.length, 0);
});
