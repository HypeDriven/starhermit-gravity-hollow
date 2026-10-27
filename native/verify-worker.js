// Replay verification off the game's thread (a starhermit:script module
// worker): src/session.js verifyReplay unchanged, which re-simulates the whole
// match from its seed and commands (thousands of rules steps: seconds in the
// native interpreter, longer than a frame may run).
// Message in: { id, replay, stage }. Message out: { id, ok, why }.
import { verifyReplay } from "../src/session.js";

globalThis.onmessage = (e) => {
  const d = e.data;
  let out;
  try { out = verifyReplay(d.replay, d.stage); } catch (err) { out = { ok: false, why: String(err && err.message || err) }; }
  postMessage({ id: d.id, ok: !!out.ok, why: out.why ?? null });
};
