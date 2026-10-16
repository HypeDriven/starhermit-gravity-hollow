// Localization coverage: every English key the UI shows — index.html markup,
// prose literals the screens, toasts, captions and statuses pass as text,
// T('…') / N('…') keys, and content shown through T(variable) (challenges,
// lessons, achievements) — is translated in every locale (en-GB → en-US,
// es-ES → es-419, fr-CA → fr-FR inherit) with intact placeholders; no prose
// template literal bypasses T(); the language follows sh-language.js and
// switches live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTables, codeKeys, proseLiterals, proseTemplates, markupKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { challenges, tutorials } from '../src/content.js';
import { ACHIEVEMENTS } from '../src/session.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const FILES = ['src/i18n/strings.js', 'src/i18n/strings-content.js'];
const UI = ['src/ui.js', 'src/main.js'];
const CODE = [...UI, 'src/audio.js', 'src/session.js', 'src/platform.js'];

export function usedKeys() {
  const keys = new Set(markupKeys(read('index.html')));
  for (const f of CODE) codeKeys(read(f)).forEach((k) => keys.add(k));
  // The logo, rival names, the default guest name's id and key names are not prose here.
  const NOT_TEXT = new Set(['Gravity Hollow', '&amp;', '&gt;', '&lt;', '&quot;', '(prefers-reduced-motion: reduce)', 'var(--danger)', 'locked', 'mastery', 'Pip', 'Sorrel', 'Bram', 'Nettle', 'Cobb', 'Wren', 'Tansy', 'Hollis', 'You', 'Replay', 'Space', 'Shift', 'fatal']);
  for (const f of UI) proseLiterals(read(f)).filter((k) => !/^[a-z]+[A-Z]\w*$/.test(k) && !NOT_TEXT.has(k) && !/^\[|WebGL unavailable|SMOKE_/.test(k)).forEach((k) => keys.add(k));
  for (const c of challenges()) { keys.add(c.name); keys.add(c.description); }
  for (const l of tutorials()) { keys.add(l.name); for (const s of l.steps) { keys.add(s.text); if (s.hint) keys.add(s.hint); } }
  for (const a of Object.values(ACHIEVEMENTS)) { keys.add(a.name); keys.add(a.desc); }
  keys.delete('Gravity Hollow');
  return [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
}

test('every used key is translated in every locale; placeholders intact', () => {
  assert.deepEqual(audit(loadTables(ROOT, FILES, 'GH_STRINGS'), usedKeys()), []);
});

test('no prose template literal bypasses T()', () => {
  const bad = CODE.flatMap((f) => proseTemplates(read(f)).map((t) => `${f}: ${t}`))
    .filter((t) => !/: hash@step…$/.test(t)); // replay-check reason codes
  assert.deepEqual(bad, []);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { files: ['sh-language.js', ...FILES, 'src/i18n/i18n.js'], global: 'GHI18N', event: 'gh-language', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Play'), 'Spielen');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  I18N.language.setChoice('es-ES');
  assert.equal(I18N.T('Stage {n}', { n: 4 }), 'Etapa 4');
});

test('graphics and platform strings cover all nine locales', async () => {
  const { platformStrings } = await import('../src/platform-i18n.js');
  const { graphicsStrings } = await import('../src/gfx-ui.js');
  for (const l of LOCALES) {
    for (const k of Object.keys(platformStrings('en-US'))) assert.ok(platformStrings(l)[k], `${l} ${k}`);
    assert.ok(graphicsStrings(l).graphics, l);
  }
});
