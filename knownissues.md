# Known Issues — Gravity Hollow

QA pass 2026-08-20. Static review driven by Qwen3.8 27B on `worker186` (HauhauCS Q3_K_P, 16k ctx),
alongside the game's own unit tests, headless-Chrome runs and raw-socket probing of the hosted-play
WebSocket protocol.

## Test results

| Check | Result |
| --- | --- |
| `npm test` (`node tests/rules.test.mjs && node tests/session.test.mjs`) | 150/150 + 3/3 pass, 0 failures |
| `node --check` on all modules (`src/*.js`, `server.js`, `tests/*.mjs`) | clean |
| `tests/e2e.mjs` | not present |
| Headless-Chrome boot + play-through (served on :39403) | Boots to title, starts the Drift tutorial, HUD and coaching text update; only console error is a `404 /favicon.ico` |
| Corrupt-`localStorage` sweep (8 corruptions × 3 keys, reload each time) | PASS — no page errors, game still renders every time |
| Rapid-input + resize stress (90 key presses, 40 clicks, 5 viewport changes, 8 pause toggles) | PASS — 0 console errors |
| API fuzzing (`/api/v1/*`, malformed bodies, malformed percent-escapes) | server stayed up |

## Confirmed defects

All three were reproduced on the wire against the running server on port 39403.

### 1. WebSocket PONG is double-framed — clients receive a BINARY message instead of a pong

- **File:** `server.js:222` (the `sock.on('data')` handler) together with `wsSend` at `server.js:79`
- **Trigger:** any client that sends a WebSocket PING control frame.
- **Behaviour:**

  ```js
  if (m.type === 'ping') { wsSend(sock, Buffer.concat([Buffer.from([0x8A, m.payload.length]), m.payload])); continue; }
  ```

  The argument is already a complete pong frame, but `wsSend` unconditionally prepends its own header,
  and because the argument is a `Buffer` it chooses opcode 2:
  `header = Buffer.from([0x80 | (Buffer.isBuffer(data) ? 2 : 1), len])`. The peer therefore gets a
  binary data frame whose payload happens to begin with `0x8a`, and never gets a pong — keepalive
  timers on the client side will eventually tear the connection down.
- **Expected:** a real pong (opcode 0xA), as `glow-strikers/server.js` produces from the same kind of
  hand-rolled stack.
- **Evidence:** raw client sending a masked PING with payload `"ping"` —

  ```
  gravity-hollow :39403  -> frame opcode=0x2 (BINARY) len=6 bytes=8a0470696e67
  glow-strikers  :39402  -> frame opcode=0xa (PONG)   len=4 bytes=70696e67      (control)
  ```

### 2. Fragmented WebSocket messages are silently discarded

- **File:** `server.js:110` (`wsDecode`) — `else if (fin && (op === 1 || op === 2)) msgs.push(...)`
- **Trigger:** send any control message split across a first fragment (`FIN=0, opcode=1`) and a
  continuation (`FIN=1, opcode=0`) — legal RFC 6455 traffic that proxies and some clients produce.
- **Behaviour:** neither frame satisfies the push condition, and `off` advances past both, so the whole
  message vanishes. No error is returned to the client and nothing is logged. There is no continuation
  buffer anywhere in the file.
- **Expected:** RFC 6455 §5.4 requires continuation reassembly; the server's own protocol documentation
  (`server.js:9-18`) lists these as ordinary client→server frames.
- **Evidence:** identical `join` message, sent two ways —

  ```
  WHOLE      -> {"op":"joined","seat":0,"room":"qa1","host":true}
                {"op":"roster","seats":[{"seat":0,"name":"QA","alive":true}]}
  FRAGMENTED -> (no response at all)
  ```

  (`glow-strikers/server.js` has the same gap — `readFrame` returns `fin` but `handleFrame` ignores it.)

### 3. No reconnect path — a dropped player cannot return to an in-progress match

- **File:** `server.js:239-252` (`case 'join'`) and `server.js:283` (`cleanup`)
- **Trigger:** join a room, start the match, lose the socket, reconnect.
- **Behaviour:** there is no `resume`/`reconnect`/`snapshot` op in the protocol at all. `join` rejects
  outright while a match runs (`if (room.started) { client.send({ op: 'error', error: 'match_in_progress' }); return; }`),
  and `cleanup` hands the abandoned void to the AI permanently
  (`if (room.state && client.voidId >= 0) room.state.voids[client.voidId].ai = true;` — commented
  "the void stays in the match as an AI seat (abandonment policy)"). If the leaver was the last client,
  the room and its match are destroyed instead.
- **Expected:** the file's own header advertises "reconnect snapshots" (`server.js:5-6`) and `spec.md`
  §2 requires "Hosted play: private invitations and appropriate public matching, with **reconnect** and
  authoritative results"; §5 adds that "the returning client receives a fresh snapshot and a concise
  'while you were away' summary".
- **Evidence:** live server —

  ```
  A       <- {"op":"joined","seat":0,"room":"qa-recon-301","host":true}
  A       <- {"op":"started","seat":0}
  (socket dropped, immediate rejoin)
  A-again <- {"op":"error","error":"match_in_progress"}

  (socket dropped, 3 s pause, rejoin — room had been destroyed)
  A-again <- {"op":"joined","seat":0,"room":"qa-recon-404","host":true}   # a brand-new empty lobby
  ```

### 4. The lobby roster always reports every seat as alive

- **File:** `server.js:141` — `return [...room.clients.values()].map(c => ({ seat: c.seat, name: c.name, alive: true }));`
- **Trigger:** any `roster` broadcast after a void has been eaten or has left.
- **Behaviour:** `alive` is a literal, so it never reflects `state.voids[i].alive` or an abandoned seat.
  Clients cannot distinguish a live rival from an eliminated or AI-taken one from the roster frame.
- **Expected:** the field exists precisely to carry that state; the engine tracks it
  (`src/rules.js` void `alive` / `deaths` / `respawnTicks`).
- **Evidence:** the literal as quoted; live roster frame during an active match —
  `{"op":"roster","seats":[{"seat":0,"name":"A","alive":true}]}`.

### 5. Rate limiter allows one more message than documented

- **File:** `server.js:236-238` (`handleMessage`)
- **Behaviour:**

  ```js
  // rate limit: 120 messages per 10s
  client.rate = client.rate.filter(t => now - t < 10000);
  if (client.rate.length > 120) { client.send({ op: 'error', error: 'rate_limited' }); return; }
  client.rate.push(now);
  ```

  The check runs before the push and uses `>`, so the 121st message in a window is still accepted.
- **Expected:** `>=` (or check after pushing), to match the stated 120.
- **Evidence:** source as quoted. Low severity — a one-message overshoot — but it is a real off-by-one.

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
