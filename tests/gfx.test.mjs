// Graphics quality model (src/gfx.js) + panel locale picking. Run: node --test tests/gfx.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPreset, resolve, choosePreset, presetTier, describe, migrateQuality, CATEGORIES, PRESETS,
  LEVELS, BUDGETS, MAX_MOTES, budget, particleBudget, detectLevel, presetForLevel,
} from '../src/gfx.js';
// src/gpu-level.js is a classic script in the page; imported here it sets globalThis.StarHermitGpu.
await import('../src/gpu-level.js');

test('hardware level picks the Auto preset (StarHermit gpu-level.js)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectLevel('NVIDIA GeForce RTX 5090'), 20);
  assert.equal(detectLevel('SwiftShader'), 0);
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(9), 'balanced');
  assert.equal(presetForLevel(16), 'high');
});

test('phones and tablets are Balanced at most (software stays low)', () => {
  assert.ok(['low', 'balanced'].includes(detectPreset('Adreno (TM) 740', { mobile: true })));
  assert.equal(detectPreset('NVIDIA GeForce RTX 4090', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'ground', 'segments', 'motes', 'sparks', 'hudBlur', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(k in BUDGETS[p], `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) {
    const a = BUDGETS[PRESETS[i - 1]], b = BUDGETS[PRESETS[i]];
    for (const k of ['ground', 'segments', 'motes', 'sparks', 'bloomRes', 'aoRes']) assert.ok(b[k] >= a[k], `${PRESETS[i]}.${k}`);
  }
  assert.equal(BUDGETS.low.material, 'lambert');
  assert.equal(BUDGETS.balanced.hudBlur, false);
  assert.equal(BUDGETS.high.hudBlur, true);
  assert.deepEqual(budget('high', 10), BUDGETS.high);
  assert.ok(budget('high', 14).motes > BUDGETS.high.motes);
  assert.ok(budget('ultra', 20).motes <= Math.min(MAX_MOTES, BUDGETS.ultra.motes * 2));
  assert.ok(budget('ultra', 2).sparks < BUDGETS.ultra.sparks);
  assert.equal(particleBudget('off', BUDGETS.ultra), 0);
  assert.equal(particleBudget('high', BUDGETS.high), 1200);
  assert.deepEqual(resolve({ preset: 'low' }, 'low', 0).budget, BUDGETS.low);
  assert.equal(resolve({}, 'ultra', 20).level, 20);
});

test('resolve: auto uses the detected preset', () => {
  const r = resolve({}, 'high');
  assert.equal(r.auto, true);
  assert.equal(r.preset, 'high');
  for (const cat of Object.keys(CATEGORIES)) assert.equal(r[cat], presetTier('high', cat));
  assert.equal(resolve(undefined, 'nonsense').preset, 'balanced');
});

test('resolve: explicit preset, overrides and invalid overrides', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'bogus' }, 'ultra');
  assert.equal(r.auto, false);
  assert.equal(r.preset, 'low');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'off'); // invalid tier falls back to the preset
  assert.equal(r.post, true);     // bloom needs the post chain
  const low = resolve({ preset: 'low' }, 'high');
  assert.equal(low.post, false);  // Low renders directly, no composer
  assert.equal(low.dprCap, 1);
  assert.equal(low.particles, 'off');
});

test('resolve: render scale clamps to 50–200 % and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'high', render_scale: 'x' }).scale, 1);
  assert.equal(resolve({ preset: 'ultra', render_scale: 2 }).scale, 2.5);
});

test('adaptive defaults on, show_fps defaults off', () => {
  assert.equal(resolve({}, 'low').adaptive, true);
  assert.equal(resolve({ adaptive: false }, 'low').adaptive, false);
  assert.equal(resolve({}, 'low').showFps, false);
  assert.equal(resolve({ show_fps: true }, 'low').showFps, true);
});

test('choosing a preset clears overrides but keeps scale / adaptive / fps', () => {
  const s = choosePreset({ preset: 'high', bloom: 'off', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'ultra');
  assert.deepEqual(s, { preset: 'ultra', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.equal(choosePreset({}, 'auto').preset, 'auto');
  for (const p of PRESETS) assert.equal(choosePreset({ shadows: 'off' }, p).shadows, undefined);
});

test('describe gives a cost summary with pixels', () => {
  const d = describe(resolve({ preset: 'high' }), [1280, 800]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /SMAA/);
  assert.match(d, /1280×800 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('legacy quality setting migrates', () => {
  assert.deepEqual(migrateQuality('medium'), { preset: 'balanced' });
  assert.deepEqual(migrateQuality('high'), { preset: 'high' });
  assert.deepEqual(migrateQuality('auto'), {});
});

test('panel locale picking covers every target locale', async () => {
  const { pickLocale, LOCALES, graphicsStrings } = await import('../src/gfx-ui.js');
  for (const l of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    assert.ok(LOCALES.includes(l), l);
    const T = graphicsStrings(l);
    for (const cat of Object.keys(CATEGORIES)) assert.ok(T.cats[cat], `${l} ${cat}`);
    for (const tiers of Object.values(CATEGORIES)) for (const t of tiers) assert.ok(T.tiers[t], `${l} tier ${t}`);
    for (const p of PRESETS) assert.ok(T.presets[p], `${l} preset ${p}`);
  }
  assert.equal(pickLocale(['es-MX']), 'es-419');
  assert.equal(pickLocale(['es-ES']), 'es-ES');
  assert.equal(pickLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickLocale(['fr']), 'fr-FR');
  assert.equal(pickLocale(['en-AU']), 'en-GB');
  assert.equal(pickLocale(['pt-PT']), 'pt-BR');
  assert.equal(pickLocale(['ja-JP']), 'en-US');
});
