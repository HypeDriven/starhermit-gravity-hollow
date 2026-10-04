/**
 * Gravity Hollow — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the REAL visible UI in headless Chrome (playwright-core + system
 * Chrome): boot → title → settings/help/journey screens → Practice match
 * (keyboard steering, boost, hint, undo, pause/resume, leave) → full
 * "Sprint Hollow" challenge match played to the results screen → home.
 * Two passes: desktop 1280x800 and mobile 390x844 (hasTouch).
 *
 * Self-contained: embeds a minimal static server on an ephemeral port
 * (server.js is the StarHermit authoritative host and is NOT used here).
 * StarHermit /api routes are mocked for a final signed-in pass; the solo
 * passes must make no /api request. Hosted Play (real seats over /ws)
 * requires server.js and is out of scope.
 *
 * Run: npm run test:e2e
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg; codecs=opus', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.ts': 'text/typescript', '.md': 'text/markdown',
  '.txt': 'text/plain; charset=utf-8',
};
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;
const SHOT = (stage, pass) => `/tmp/gravity-hollow-e2e-${stage}-${pass}.png`;

const apiLog = [];
function platformMock(req, res, p) {
  apiLog.push(`${req.method} ${p}`);
  const json = (b, st = 200) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (p.endsWith('/profile')) return json({ username: 'raw', nickname: 'Event Horizon' });
  if (p.endsWith('/games/hollow-test/settings') && req.method === 'GET') return json({ settings: { music: 0.35 } });
  if (p.endsWith('/games/hollow-test/settings')) return json({ settings: {} });
  if (p.endsWith('/games/hollow-test/controls')) return json(req.method === 'GET' ? { actions: [{ action: 'hint', codes: ['KeyG'] }] } : {});
  if (p.endsWith('/cloud-saves/game:hollow-test/info')) return json({ exists: false });
  if (p.endsWith('/cloud-saves/game:hollow-test')) return json({});
  return json({ error: 'not found' }, 404);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return platformMock(req, res, decodeURIComponent(url.pathname));
    const path = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!path.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

let browser;
const failures = [];
try {
  // PORT pins the embedded server (CI port ranges); otherwise an ephemeral port
  await new Promise((resolve) => server.listen(Number(process.env.PORT) || 0, '127.0.0.1', resolve));
  const BASE = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  });

  for (const pass of [
    { name: 'desktop', viewport: { width: 1280, height: 800 }, hasTouch: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, hasTouch: true },
  ]) {
    const context = await browser.newContext({ viewport: pass.viewport, hasTouch: pass.hasTouch });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`);
    });

    const step = async (name, fn) => {
      await fn();
      console.log(`ok - [${pass.name}] ${name}`);
    };
    const visible = (sel) => page.waitForSelector(`${sel}:not(.hidden)`, { timeout: 15000 });
    const hidden = (sel) => page.waitForSelector(`${sel}.hidden`, { state: 'attached', timeout: 15000 });

    // Steer the hollow with real held key presses, in a rotating pattern.
    // Space is avoided for boost (it would re-activate the focused Start
    // button); ShiftLeft is the boost binding with no activation side effect.
    const steer = async (seconds) => {
      const dirs = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
      const end = Date.now() + seconds * 1000;
      let i = 0;
      while (Date.now() < end) {
        const key = dirs[i++ % dirs.length];
        await page.keyboard.down(key);
        if (i % 4 === 0) await page.keyboard.down('ShiftLeft');
        await page.waitForTimeout(800);
        await page.keyboard.up('ShiftLeft');
        await page.keyboard.up(key);
      }
    };

    try {
      await step('load → boot → title', async () => {
        await page.goto(BASE, { waitUntil: 'load' });
        await visible('#screen-title');
        if (await page.locator('#btn-play').isHidden()) throw new Error('Play button not visible');
        await page.screenshot({ path: SHOT('title', pass.name) });
      });

      await step('settings open/close', async () => {
        await page.click('#btn-settings');
        await visible('#screen-settings');
        await page.screenshot({ path: SHOT('settings', pass.name) });
        await page.click('#btn-settings-close');
        await hidden('#screen-settings');
        await visible('#screen-title');
      });

      await step('graphics: presets, override, persistence across reload', async () => {
        const attr = () => page.evaluate(() => ({
          body: document.body.dataset.gfxPreset, canvas: document.getElementById('game-canvas').dataset.gfxPreset,
          post: document.body.dataset.gfxPost,
        }));
        await page.click('#btn-settings');
        await visible('#screen-settings');
        // Auto on a software renderer resolves to Low: no post chain
        let a = await attr();
        if (a.body !== 'low' || a.canvas !== 'low' || a.post !== 'off') throw new Error(`auto should resolve to low: ${JSON.stringify(a)}`);
        const autoLabel = await page.locator('#set-quality option[value="auto"]').textContent();
        if (!/Low/.test(autoLabel)) throw new Error(`auto label lacks detected tier: "${autoLabel}"`);
        await page.locator('#gfx-section').scrollIntoViewIfNeeded();
        await page.selectOption('#set-quality', 'ultra');
        await page.waitForTimeout(1500); // render a few Ultra frames (console must stay clean)
        a = await attr();
        if (a.body !== 'ultra' || a.post !== 'on') throw new Error(`ultra not applied: ${JSON.stringify(a)}`);
        await page.selectOption('#set-quality', 'high');
        a = await attr();
        if (a.body !== 'high') throw new Error(`high not applied: ${JSON.stringify(a)}`);
        const fromPreset = await page.locator('#gfx-shadows option[value="preset"]').textContent();
        if (!/Medium/.test(fromPreset)) throw new Error(`"From preset" label not updated: "${fromPreset}"`);
        await page.selectOption('#gfx-bloom', 'off');
        await page.waitForTimeout(1200);
        const summary = await page.textContent('#gfx-summary');
        if (/bloom/.test(summary) || !/2048² shadows/.test(summary) || !/\d+×\d+ px/.test(summary)) throw new Error(`summary wrong: "${summary}"`);
        await page.check('#gfx-fps');
        await visible('#fps-meter:not([hidden])');
        await page.screenshot({ path: SHOT('graphics', pass.name) });
        // survives reload
        await page.reload({ waitUntil: 'load' });
        await visible('#screen-title');
        a = await attr();
        if (a.body !== 'high') throw new Error(`preset lost on reload: ${JSON.stringify(a)}`);
        await page.click('#btn-settings');
        await visible('#screen-settings');
        if (await page.inputValue('#gfx-bloom') !== 'off') throw new Error('bloom override lost on reload');
        if (await page.inputValue('#set-quality') !== 'high') throw new Error('quality select lost on reload');
        // back to Auto: clears overrides, keeps the rest of the run fast (Low)
        await page.locator('#gfx-section').scrollIntoViewIfNeeded();
        await page.uncheck('#gfx-fps');
        await page.selectOption('#set-quality', 'auto');
        a = await attr();
        if (a.body !== 'low') throw new Error(`auto not restored: ${JSON.stringify(a)}`);
        if (await page.inputValue('#gfx-bloom') !== 'preset') throw new Error('preset did not clear overrides');
        await page.click('#btn-settings-close');
        await visible('#screen-title');
      });

      await step('help open/close', async () => {
        await page.click('#btn-help');
        await visible('#screen-help');
        const cards = await page.locator('#help-cards .mode-card').count();
        if (cards < 5) throw new Error(`expected help cards, got ${cards}`);
        await page.click('#btn-help-close');
        await hidden('#screen-help');
      });

      await step('journey map shows 40 stages', async () => {
        await page.click('#btn-journey');
        await visible('#screen-journey');
        const cells = await page.locator('.journey-cell').count();
        if (cells !== 40) throw new Error(`expected 40 journey stages, got ${cells}`);
        await page.screenshot({ path: SHOT('journey', pass.name) });
        await page.click('#screen-journey [data-back]');
        await visible('#screen-title');
      });

      await step('play → practice (relaxed) → setup → start', async () => {
        await page.click('#btn-play');
        await visible('#screen-modes');
        await page.locator('#mode-cards .mode-card', { hasText: 'Practice' }).first().click();
        await page.locator('#mode-cards .mode-card', { hasText: 'Practice — relaxed' }).click();
        await visible('#screen-setup');
        await page.screenshot({ path: SHOT('setup-practice', pass.name) });
        await page.click('#btn-start-match');
        await visible('#hud');
        await page.waitForTimeout(4500); // 3s countdown + HUD warm-up
        const timer = await page.textContent('#hud-timer');
        if (!/^\d+:\d\d$/.test(timer.trim())) throw new Error(`HUD timer not running: "${timer}"`);
      });

      await step('practice: steer with keyboard, boost, hint, undo', async () => {
        await steer(6);
        const mass = await page.textContent('#hud-score');
        if (!/Mass/.test(mass)) throw new Error('HUD score not updating');
        await page.screenshot({ path: SHOT('practice-play', pass.name) });
        await page.click('#btn-hint');
        await page.waitForSelector('#toasts .toast', { timeout: 5000 });
        if (await page.locator('#btn-undo').isHidden()) throw new Error('undo hidden in practice');
        await page.click('#btn-undo'); // allowed in practice; may toast "Nothing to undo"
      });

      await step('practice: pause → resume → leave', async () => {
        await page.click('#btn-pause');
        await visible('#screen-pause');
        await page.screenshot({ path: SHOT('pause', pass.name) });
        await page.click('#btn-resume');
        await hidden('#screen-pause');
        await steer(2);
        await page.click('#btn-pause');
        await visible('#screen-pause');
        await page.click('#btn-leave');
        await visible('#screen-title');
      });

      await step('sprint challenge: full 45s match to results', async () => {
        await page.click('#btn-play');
        await visible('#screen-modes');
        await page.locator('#mode-cards .mode-card', { hasText: 'Challenges' }).click();
        await page.locator('#mode-cards .mode-card', { hasText: 'Sprint Hollow' }).click();
        await visible('#screen-setup');
        await page.click('#btn-start-match');
        await visible('#hud');
        // Steer until the results screen appears (match is 45s + countdown).
        const dirs = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
        const deadline = Date.now() + 90000;
        let i = 0, done = false, shotTaken = false;
        while (Date.now() < deadline) {
          if (await page.locator('#screen-results:not(.hidden)').count()) { done = true; break; }
          const key = dirs[i++ % dirs.length];
          await page.keyboard.down(key);
          await page.waitForTimeout(900);
          await page.keyboard.up(key);
          if (!shotTaken && i > 8) { shotTaken = true; await page.screenshot({ path: SHOT('sprint-play', pass.name) }); }
        }
        if (!done) throw new Error('results screen never appeared');
      });

      await step('results screen with standings and breakdown', async () => {
        const headline = await page.textContent('#results-headline');
        const standings = await page.locator('#results-standings li').count();
        if (!standings) throw new Error('no standings rows');
        const replay = await page.textContent('#results-replay');
        console.log(`  headline: "${headline.trim()}" · standings: ${standings} · replay: "${replay.trim()}"`);
        if (!/Replay verified|not ranked|mismatch/i.test(replay)) throw new Error(`unexpected replay line: "${replay}"`);
        await page.screenshot({ path: SHOT('results', pass.name) });
        await page.click('#btn-results-home');
        await visible('#screen-title');
      });

      if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
    } catch (e) {
      failures.push(`[${pass.name}] ${e.message}`);
      try { await page.screenshot({ path: SHOT('failure', pass.name) }); } catch {}
      if (errors.length) console.log(`page errors so far [${pass.name}]:\n${errors.join('\n')}`);
    } finally {
      await context.close();
    }
  }
  if (apiLog.length) failures.push(`solo passes made platform calls: ${apiLog.join(', ')}`);

  // Signed-in launch: nickname, synced music volume, platform key binding in
  // Settings, invite link from the visible title button, cloud slot seeded.
  {
    const BASE = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !browserNoise.test(m.text())) errors.push(`console ${m.type()}: ${m.text()}`); });
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
    });
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = 'h.' + b64u({ sub: 'void-12345678', game_scope: 'hollow-test', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';
    try {
      await page.goto(`${BASE}/#game_token=${token}`, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 20000 });
      if (new URL(page.url()).hash) throw new Error('launch token left in the URL');
      if ((await page.textContent('#profile-sub')).trim() !== 'Event Horizon') throw new Error('nickname not shown');
      if (await page.locator('#btn-signin').isVisible()) throw new Error('sign-in shown while signed in');
      const music = await page.evaluate(() => JSON.parse(localStorage.getItem('gravity-hollow:settings:v1')).data.music);
      if (music !== 0.35) throw new Error('platform settings not applied: ' + music);
      await page.click('#btn-invite');
      await page.waitForFunction(() => window.__copied.length === 1);
      const link = await page.evaluate(() => window.__copied[0]);
      if (!/\/game-invite\/void-12345678\/hollow-test$/.test(link)) throw new Error('bad invite link ' + link);
      await page.screenshot({ path: SHOT('title', 'signed-in') });
      await page.click('#btn-settings');
      await page.click('#btn-rebind');
      if (!/hint\s*G\s*rebind/.test(await page.textContent("#bind-editor"))) throw new Error('settings do not show the platform binding');
      await page.locator('#bind-editor .bind-row', { hasText: 'camera' }).locator('button').click();
      await page.keyboard.press('KeyV');
      for (let i = 0; i < 30 && !apiLog.includes('PUT /api/v1/games/hollow-test/controls'); i++) await page.waitForTimeout(100);
      if (!apiLog.includes('PUT /api/v1/games/hollow-test/controls')) throw new Error('rebind not saved to the platform: ' + apiLog.join(', '));
      for (let i = 0; i < 40 && !apiLog.includes('PUT /api/v1/me/cloud-saves/game:hollow-test'); i++) await page.waitForTimeout(100);
      if (!apiLog.includes('PUT /api/v1/me/cloud-saves/game:hollow-test')) throw new Error('cloud slot not seeded');
      if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
      console.log('ok - [signed-in] nickname, synced settings, platform binding + rebind, invite link, cloud seed');
    } catch (e) {
      failures.push(`[signed-in] ${e.message}`);
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nE2E FAIL:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nE2E PASS — gravity-hollow playable end-to-end on desktop and mobile, no page errors');
