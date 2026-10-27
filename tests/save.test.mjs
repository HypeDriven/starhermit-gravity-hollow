// The save document on the engine (node --test): the browser build's cloud slot
// ({ v, save, savedAt }) and this build's engine save both read as the document;
// what is not one is refused; the merge keeps the best of two devices; the stored
// envelope round-trips through loadSave as native/platform.ts's localStorage shim
// serves it.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const S = await import('../src/session.js');

const blank = () => { store.clear(); return S.loadSave(); };
const doc = (over = {}) => ({ ...blank(), ...over });

test('the browser build cloud document reads as its save', () => {
  const old = { v: 1, save: doc({ journey: { 'journey-01': { stars: 2, best: 80 } }, sessionsPlayed: 4 }), savedAt: 1760000000000 };
  const d = S.parseSaveDoc(old, blank());
  assert.equal(d.journey['journey-01'].stars, 2);
  assert.equal(d.sessionsPlayed, 4);
  assert.deepEqual(d.tutorialsDone, {});
});

test('the engine save (the document itself) reads as is; junk is refused', () => {
  const d = S.parseSaveDoc(doc({ masteryXp: 12 }), blank());
  assert.equal(d.masteryXp, 12);
  assert.equal(S.parseSaveDoc(null, blank()), null);
  assert.equal(S.parseSaveDoc({ v: 1, data: 'x' }, blank()), null);
  assert.equal(S.parseSaveDoc('text', blank()), null);
});

test('merging a foreign cloud save with this device keeps the best of each', () => {
  const local = doc({ journey: { 'journey-01': { stars: 1, best: 50 } }, achievements: { first_void: { at: 20 } }, sessionsPlayed: 2 });
  const remote = S.parseSaveDoc({ v: 1, save: doc({ journey: { 'journey-01': { stars: 3, best: 40 }, 'journey-02': { stars: 1, best: 9 } }, achievements: { first_void: { at: 10 } }, sessionsPlayed: 5 }) }, blank());
  const m = S.mergeSaves(local, remote);
  assert.deepEqual(m.journey['journey-01'], { stars: 3, best: 50 });
  assert.ok(m.journey['journey-02']);
  assert.equal(m.achievements.first_void.at, 10);
  assert.equal(m.sessionsPlayed, 5);
});

test('the stored envelope round-trips through loadSave (the shim serves it)', () => {
  const d = doc({ masteryXp: 77, profile: { name: 'Ada', guest: true } });
  store.set('gravity-hollow:save:v1', S.envelopeJson(d));
  const back = S.loadSave();
  assert.equal(back.masteryXp, 77);
  assert.equal(back.profile.name, 'Ada');
  store.set('gravity-hollow:save:v1', S.envelopeJson(d).replace('77', '78'));
  assert.equal(S.loadSave().masteryXp, 0, 'a tampered document reads as absent');
});
