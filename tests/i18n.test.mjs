// Every player-facing string exists in all nine locales (node --test): the five full
// tables (es-419, de-DE, fr-FR, pt-BR, it-IT) carry every key with the same
// placeholders; en-GB, es-ES and fr-CA list only their differences; no table keeps keys
// that are no longer used; the account strings (src/platform-i18n.js) cover every locale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL, loadTables } from './i18n-keys.mjs';
import { platformStrings, PLATFORM_LOCALES } from '../src/platform-i18n.js';

const FULL = ['es-419', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT'];
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const tables = loadTables();
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the key set is non-trivial', () => { assert.ok(ALL.size > 250, `only ${ALL.size} keys`); });

for (const locale of FULL) {
  test(`${locale}: every key is translated with the same placeholders`, () => {
    const dict = tables[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    const bad = [...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k));
    assert.deepEqual(bad, [], `placeholder mismatch in ${locale}`);
  });
}

test('regional tables only refine their parents and keep placeholders', () => {
  for (const [l, parent] of Object.entries(PARENT)) {
    for (const [k, v] of Object.entries(tables[l] ?? {})) {
      assert.ok(ALL.has(k), `${l}: stray key ${k}`);
      assert.equal(placeholders(v), placeholders(k), `${l}: ${k}`);
    }
    if (parent !== 'en-US') assert.ok(tables[parent], parent);
  }
});

test('no full table carries keys that no longer exist', () => {
  for (const locale of FULL) {
    const stray = Object.keys(tables[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('the account strings cover all nine locales', () => {
  assert.equal(PLATFORM_LOCALES.length, 9);
  for (const l of PLATFORM_LOCALES) for (const k of Object.keys(platformStrings('en-US'))) assert.ok(platformStrings(l)[k], `${l} ${k}`);
});
