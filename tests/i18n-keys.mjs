// Key extraction for the i18n coverage test (also handy for listing keys): every
// T('…') / N('…') in native/*.ts and the shared src/*.js modules, and the content's
// names and texts (challenges, lessons, achievements).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { challenges, tutorials } from '../src/content.js';
import { ACHIEVEMENTS } from '../src/session.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const ternary = /(?<![\w.$])T\([^'"\n()]*?\?\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*:\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const files = [
    ...readdirSync(join(ROOT, 'native')).filter((f) => f.endsWith('.ts')).map((f) => join(ROOT, 'native', f)),
    join(ROOT, 'src', 'session.js'),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    for (const m of src.matchAll(ternary)) { keys.add(unescape(m[1] ?? m[2])); keys.add(unescape(m[3] ?? m[4])); }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const c of challenges()) add(c.name, c.description);
  for (const l of tutorials()) { add(l.name); for (const s of l.steps) add(s.text, s.hint); }
  for (const a of Object.values(ACHIEVEMENTS)) add(a.name, a.desc);
  add('Local lobby with AI seats. Realtime rooms are planned for a later build.');
  return keys;
}

// Not prose: the logo and the player label stand as they are.
const NOT_TEXT = new Set(['Gravity Hollow']);
export const ALL = new Set([...sourceKeys(), ...contentKeys()].filter((k) => /[A-Za-z]/.test(k) && !NOT_TEXT.has(k)));

/** The string tables (src/i18n/strings.js, strings-content.js) as the engine loads them. */
export function loadTables() {
  const ctx = vm.createContext({});
  for (const f of ['src/i18n/strings.js', 'src/i18n/strings-content.js']) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx);
  return vm.runInContext('globalThis.GH_STRINGS', ctx);
}
