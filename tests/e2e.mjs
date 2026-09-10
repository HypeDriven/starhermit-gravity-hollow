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
 * A stub /api/v1/time endpoint is served so boot clock-sync succeeds
 * offline; Hosted Play (real seats over /ws) requires server.js and is
 * out of scope — the game offers full local solo play without it.
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/time') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ epochMs: Date.now() }));
      return;
    }
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
      if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
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
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\nE2E FAIL:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nE2E PASS — gravity-hollow playable end-to-end on desktop and mobile, no page errors');
