// src/platform.js on the real StarHermit SDK with a stubbed fetch and launch
// URL. Run: node --test tests/platform.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectPlatform, applyRemoteSettings } from '../src/platform.js';
import { DEFAULT_SETTINGS, mergeSaves } from '../src/session.js';

// The package is ESM, so the UMD SDK is evaluated with a CommonJS-style module object.
const SDK = (() => { const module = { exports: {} }; new Function('module', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(module); return module.exports; })();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'h.' + b64u({ sub: 'void-12345678', game_scope: 'hollow-id', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

function harness(href, routes = {}) {
  const calls = [], store = {}, etags = {}, url = new URL(href);
  let version = 0;
  const win = { location: { hash: url.hash, search: url.search, pathname: url.pathname, origin: url.origin, hostname: url.hostname, href }, history: { replaceState: (a, b, u) => { win.replaced = u; } } };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET'; calls.push({ path, method, body: init.body });
    if (path.includes('/cloud-saves/')) {
      const key = decodeURIComponent(path.split('/cloud-saves/')[1]);
      // Versioned like the platform: /info and PUT answer an etag; a conditional
      // PUT (If-Match / If-None-Match: *) against another version is a 412.
      if (key.endsWith('/info')) { const k = key.slice(0, -5); return new Response(JSON.stringify({ exists: !!store[k], ...(store[k] ? { etag: etags[k] } : {}) }), { status: 200 }); }
      if (method === 'PUT') {
        const h = new Headers(init.headers || {}), match = h.get('If-Match'), none = h.get('If-None-Match');
        if ((match && match !== etags[key]) || (none === '*' && store[key])) return new Response(JSON.stringify({ error: 'precondition_failed', etag: etags[key] }), { status: 412 });
        store[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64'); etags[key] = `"v${++version}"`;
        return new Response(JSON.stringify({ etag: etags[key] }), { status: 200 });
      }
      return store[key] ? new Response(store[key], { status: 200 }) : new Response('', { status: 404 });
    }
    const hit = Object.entries(routes).find(([k]) => `${method} ${path}`.endsWith(k));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('', { status: 404 });
  };
  const sh = SDK.create({ window: win, fetch, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; } });
  // Another device writing the slot: new bytes, new version.
  const otherDevice = (key, bytes) => { store[key] = bytes; etags[key] = `"v${++version}"`; };
  return { platform: connectPlatform(sh), sh, calls, store, win, otherDevice };
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
  await new Promise((r) => setTimeout(r, 0)); // control writes are queued (one at a time)
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
  // Sign-in is offered on the game's own <uuid>.starhermit.com host only.
  const host = harness('https://0f8fad5b-d9cb-469f-a165-70867728950e.starhermit.com/');
  assert.equal(host.platform, null); assert.equal(host.sh.canSignIn(), true);
  const named = harness('https://hollow-id.starhermit.com/');
  assert.equal(named.sh.canSignIn(), false);
  assert.equal(local.calls.length + host.calls.length + named.calls.length, 0);
});

test('a cloud save another device wrote first is re-read and handed to the game to merge', async () => {
  const h = harness('https://hollow-id.starhermit.com/#game_token=' + TOKEN);
  const p = h.platform;
  assert.equal(await p.loadCloudSave(), null);
  // The bytes the other device will write (made with the same SDK, then replayed).
  const theirs = { journey: { 'journey-01': { stars: 3, best: 40 }, 'journey-02': { stars: 2, best: 70 } }, achievements: { first_void: { at: 5 } } };
  p.scheduleSave(theirs);
  assert.equal(await p.flushSave(), true);
  const key = Object.keys(h.store)[0], theirBytes = h.store[key];
  p.scheduleSave({ journey: { 'journey-01': { stars: 1, best: 50 } }, achievements: {} });
  assert.equal(await p.flushSave(), true);
  // The other device saves in between.
  h.otherDevice(key, theirBytes);
  const got = new Promise((resolve) => { p.onConflict = resolve; });
  p.scheduleSave({ journey: { 'journey-01': { stars: 1, best: 60 } }, achievements: {} });
  assert.equal(await p.flushSave(), false, 'the stale write is refused');
  const doc = await got;
  assert.deepEqual(doc.save, theirs);
  const merged = mergeSaves({ journey: { 'journey-01': { stars: 1, best: 60 } }, achievements: {} }, doc.save);
  assert.deepEqual(merged.journey, { 'journey-01': { stars: 3, best: 60 }, 'journey-02': { stars: 2, best: 70 } });
  assert.deepEqual(merged.achievements, { first_void: { at: 5 } });
  p.scheduleSave(merged);
  assert.equal(await p.flushSave(), true, 'the merged save lands on the version just read');
});
