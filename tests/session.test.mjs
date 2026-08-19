// Replay-envelope verification test (node). Run: node tests/session.test.mjs
import { verifyReplay } from '../src/session.js';
import * as Rules from '../src/rules.js';
import { journeyStage } from '../src/content.js';

let passed = 0, failed = 0;
const ok = (c, n) => { if (c) passed++; else { failed++; console.error(`FAIL: ${n}`); } };

const stage = journeyStage(3);

// build a replay exactly the way Session records it
const state = Rules.createMatch({ ...stage, playerName: 'T' });
const replay = {
  schema: 1, build: '1.0.0', contentVersion: stage.version, seed: stage.seed, stageId: stage.id,
  initialHash: Rules.hashState(state), startedAt: 0, commands: [], hashes: [], result: null,
};
let seq = 0, tickCounter = 0;
const dirs = [[80, 20], [80, -40], [-60, 60], [0, 100], [-100, 0]];
while (!Rules.isTerminal(state)) {
  if (state.tick % 45 === 0) {
    const d = dirs[(state.tick / 45) % dirs.length | 0];
    const cmd = { id: `local-${stage.id}-${seq}`, voidId: 0, seq: seq++, type: 'move', dir: d, boost: state.tick % 90 === 0 };
    Rules.applyCommand(state, cmd);
    replay.commands.push([tickCounter, cmd.seq, d[0], d[1], cmd.boost ? 1 : 0]);
  }
  Rules.step(state);
  if (++tickCounter % 60 === 0) replay.hashes.push({ step: tickCounter, tick: state.tick, hash: Rules.hashState(state) });
}
replay.result = { reason: Rules.terminalReason(state), finalHash: Rules.hashState(state), rankings: [] };

const good = verifyReplay(replay, stage);
ok(good.ok, `replay verifies (${good.why ?? 'ok'})`);

// tampered replay must fail (mutate a late command that affects the outcome)
const bad = JSON.parse(JSON.stringify(replay));
bad.commands[bad.commands.length - 1][2] += 55;
const r2 = verifyReplay(bad, stage);
ok(!r2.ok, 'tampered command detected');

const bad2 = JSON.parse(JSON.stringify(replay));
bad2.result.finalHash = 'deadbeef';
const r3 = verifyReplay(bad2, stage);
ok(!r3.ok, 'tampered final hash detected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
