# Known Issues — Gravity Hollow

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on `worker186` (HauhauCS Q3_K_P, 16k ctx),
alongside the game's own unit tests, headless-Chrome runs and raw-socket probing of the hosted-play
WebSocket protocol.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`node tests/rules.test.mjs && node tests/session.test.mjs`) | 150/150 + 3/3 pass, 0 failures |
| `node --check` on all modules (`src/*.js`, `server.js`, `tests/*.mjs`) | clean |
| `tests/e2e.mjs` (`npm run test:e2e`) | E2E PASS — desktop + mobile, no page errors |
| Raw-socket WebSocket probe (PONG framing, fragmentation, reconnect, rate limit) | 11/11 pass |
| Headless-Chrome boot + play-through (served on :39403) | Boots to title, starts the Drift tutorial, HUD and coaching text update; only console error is a `404 /favicon.ico` |
| Corrupt-`localStorage` sweep (8 corruptions × 3 keys, reload each time) | PASS — no page errors, game still renders every time |
| Rapid-input + resize stress (90 key presses, 40 clicks, 5 viewport changes, 8 pause toggles) | PASS — 0 console errors |
| API fuzzing (`/api/v1/*`, malformed bodies, malformed percent-escapes) | server stayed up |

## Resolved defects

All five confirmed defects were reproduced against the running server (port 39403) and fixed on
2026-09-04. Fixes are confined to `server.js`; the rules engine and client modules were unchanged.

### ~~1. WebSocket PONG is double-framed~~ — RESOLVED

- **Fix:** `server.js:80` — `wsSend` now accepts an explicit `opcode` (defaulting to binary/text as
  before). The ping handler (`server.js:229`) now calls `wsSend(sock, m.payload, 0xA)` to emit a real
  PONG control frame instead of wrapping a pre-built pong buffer as a BINARY frame.
- **Verify:** raw PING `"ping"` → frame `opcode=0xa (PONG) len=4 bytes=70696e67`; no BINARY `0x8a`
  frame. Probe T1 passed.

### ~~2. Fragmented WebSocket messages are silently discarded~~ — RESOLVED

- **Fix:** `server.js:92-122` — `wsDecode` now reassembles RFC 6455 continuation frames (§5.4) and
  carries reassembly state across cases/chunks via a `frag` accumulator returned from `wsDecode` and
  stored on the client (`server.js:220`, `server.js:236`).
- **Verify:** a `join` message split `FIN=0,op=1` + `FIN=1,op=0` now yields the normal
  `{"op":"joined",...}` response. Probe T2 passed.

### ~~3. No reconnect path~~ — RESOLVED

- **Fix:** added a reconnect path keyed by an optional `token` on `join`:
  - `server.js:136` — rooms carry a `reconnects` map.
  - `server.js:145-171` — `cleanup` records an abandoned live-match seat (`{token, name, voidId}`)
    and, when the leaver is the last client of a *started* match, keeps the room and its timer alive
    so the seat can be rejoined; the room is torn down only once the match ends.
  - `server.js:160-175` — `join` into a started room now reclaims the abandoned void when the
    `token` matches, rebinds the void to the human (`ai = false`), and sends
    `{op:"reconnected", seat, room, voidId}` + a binary state snapshot + `{op:"away", tick, seconds}`.
    A wrong/missing token is still rejected with `match_in_progress`.
- **Verify:** drop after `started`, rejoin with the same `token` → `reconnected` seat/void 0, `away`
  summary, and a binary snapshot; a different token cannot hijack the seat. Probe T3/T3b passed.

### ~~4. The lobby roster always reports every seat as alive~~ — RESOLVED

- **Fix:** `server.js:143` — `roster` now reports `alive` from the authoritative engine:
  `alive: room.state && c.voidId >= 0 ? room.state.voids[c.voidId]?.alive ?? true : true`.
- **Verify:** probe roster during an active match reflects `state.voids[voidId].alive`; before start
  the field defaults to `true`.

### ~~5. Rate limiter allows one more message than documented~~ — RESOLVED

- **Fix:** `server.js:246` — the check is now `if (client.rate.length >= 120)` so exactly 120
  messages per 10s window are accepted and the 121st is rejected.
- **Verify:** 120 accepted in-window messages + 1 more → `{"error":"rate_limited"}`. Probe T5 passed.

## Suspected — not confirmed

### 1. Command de-duplication remembers only the previous id

- **File:** `src/rules.js:223` — `if (cmd.id != null && cmd.id === v.input.lastCmdId) return { ok: true, deduped: true };`
- **Concern:** `spec.md` §5 asks to "Reject duplicates idempotently by command ID". Only the most recent
  id is retained, so an older id replayed after a different command is re-applied. The server derives
  ids from a client-controlled sequence number (`id: \`ws-${client.seat}-${msg.seq}\``,
  `server.js:266`), so a client can re-send `seq` values it has already used.
- **Why unconfirmed:** a `move` command only sets movement intent that the next tick would overwrite
  anyway, so no incorrect outcome could be produced; whether the weaker guarantee is acceptable here is
  a design call.

### 2. Unbounded WebSocket frame length declaration

- **File:** `server.js:100` — `else if (len === 127) { … len = Number(buf.readBigUInt64BE(p)); p += 8; }`
- **Concern:** there is no cap on the declared payload length, and `client.buf` is only checked
  (`> 65536`) *after* the concat, so a client can keep the connection buffering toward that bound
  repeatedly. There is also no rejection of unmasked client frames, which RFC 6455 requires.
- **Why unconfirmed:** the 64 KB buffer check does bound memory per connection, so no exhaustion could
  be demonstrated.

### 3. Malformed percent-escape returns 500 rather than 400

- **File:** `server.js:52` — `let path = normalize(decodeURIComponent(url.pathname));` inside the
  handler's `try`/`catch`
- **Concern:** `GET /%E0%A4%A` throws `URIError`, which the outer catch turns into
  `500 {"error":"internal"}`. A malformed request path is a client error and should be 400/404.
- **Why unconfirmed:** the process survives (unlike three sibling games in this batch), so this is a
  status-code nit rather than a fault; whether it matters depends on the host's error handling.

### 4. Dead traversal guard, and a cache header that never fires on Windows

- **File:** `server.js:53` — `if (path.includes('..')) { res.writeHead(403); res.end(); return; }`, and
  `server.js:59` — `const immutable = /\.(js|css|png|svg)$/.test(file) && path.includes('/vendor/');`
- **Concern:** `normalize()` on the line above already collapses every `..` segment, so the 403 branch
  is unreachable — the real safety comes from `join(ROOT, …)` with `ROOT` carrying a trailing separator.
  Separately, on Windows `normalize` yields backslashes, so the `'/vendor/'` test never matches and
  vendored assets lose their `immutable` caching.
- **Why unconfirmed:** neither produces incorrect behaviour on this platform; the traversal guard being
  dead is a robustness smell rather than a live hole (a raw `GET /../fleet-signals/spec.md` correctly
  returned 404).

## Checked, no defects found

- **Rules engine** (`src/rules.js`): 150 assertions covering deterministic replay, seed divergence,
  legal actions and invalid reasons, consumption and growth, the ember hazard, void-eats-void and
  respawn, terminal state and rankings, tie-break order, obstacle collision containment, malformed
  command fuzzing, content validators, golden journey sessions with real AI, and interrupted/resumed
  sessions — all pass.
- **Tie-break ordering** (`src/rules.js:434`): sorts by `massCollected`, then `goalDone`, then
  `invalid`, then `elapsed`, then `id` — this matches `spec.md` §2 ("Ties use, in order: primary
  objective completion, fewer invalid actions, lower authoritative elapsed time, then stable session
  identifier") with mass playing the role of the score.
- **Movement input validation** (`src/rules.js:228-232`): the model review claimed the server forwards
  unclamped `dir` values; that is a **false positive** — the engine rejects non-numeric, non-finite and
  out-of-range values with `dir_out_of_range` and counts them as invalid, exactly as the server comment
  ("authoritative validation happens inside the rules engine") asserts.
- **Corrupt / absent `localStorage`:** 24 reload cycles with `gravity-hollow:save:v1`,
  `:settings:v1` and `:replays:v1` set to `''`, `'{'`, `'null'`, `'[]'`, `'"x"'`, `'{"v":999999}'`,
  `' garbage'` and `'{"version":-1,"data":null}'` all booted cleanly with no page errors.
- **Static file handling:** `ROOT` comes from `fileURLToPath(new URL('.', …))` and so carries a
  trailing separator; `decodeURIComponent` is inside the handler's `try`/`catch`, so a malformed
  percent-escape returns 500 rather than killing the process (three sibling games in this batch crash
  on that input).

## Not tested

- **Score submission / leaderboard validation is not applicable here.** The only HTTP API route is
  `GET /api/v1/time`; everything under `/api/` else returns 404, and the client only ever calls
  `/api/v1/time` (`src/main.js:135`). Results come from the server's own simulation
  (`Rules.rankings(room.state)`), so there is no submission path a client could abuse — but equally
  there is no durable leaderboard.
- **Multi-client hosted matches.** Only single-client rooms with AI backfill were driven over raw
  WebSocket; seat mapping for 2-8 humans was reviewed statically only.
- **Three.js render correctness** (`src/render.js`): only checked for absence of runtime errors under
  SwiftShader.
- **Audio** (`src/audio.js`): headless Chrome blocks the AudioContext before a user gesture.
