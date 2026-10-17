// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Practice — relaxed and steers the hollow with real held arrow keys plus boost (ShiftLeft), so
// props are swallowed, particles and boost trails fire and the atmosphere animates.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const visible = (page, sel) => page.waitForSelector(`${sel}:not(.hidden)`, { timeout: 20000 });

export async function setPreset(page, preset) {
  await visible(page, '#screen-title');
  await page.click('#btn-settings');
  await visible(page, '#screen-settings');
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#btn-settings-close');
  await visible(page, '#screen-title');
}

export async function start(page) {
  await page.click('#btn-play');
  await visible(page, '#screen-modes');
  await page.locator('#mode-cards .mode-card', { hasText: 'Practice' }).first().click();
  await page.locator('#mode-cards .mode-card', { hasText: 'Practice — relaxed' }).click();
  await visible(page, '#screen-setup');
  await page.click('#btn-start-match');
  await visible(page, '#hud');
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    const dirs = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
    let i = 0;
    while (!stopped) {
      try {
        const key = dirs[i++ % dirs.length];
        await page.keyboard.down(key);
        if (i % 2 === 0) await page.keyboard.down('ShiftLeft');
        await page.waitForTimeout(700);
        await page.keyboard.up('ShiftLeft');
        await page.keyboard.up(key);
      } catch { /* page closing */ }
    }
  })();
  await page.waitForTimeout(3500); // countdown
}
