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

## Review pass 2026-09-07 — defects found and fixed

Reproduced against a running host (port 39411) and headless Chrome, then fixed. `npm test`
(150 + 3), `npm run test:e2e` (desktop + mobile) and a 15-check raw-socket/HTTP probe all pass
afterwards.

### 1. Seat ids and void ids diverge after pre-match churn, so a reconnect evicts another player

- **File:** `server.js` — `startMatch`, `handleMessage` case `'join'`.
- **Repro:** A, B, C join a room; A leaves before the match starts, so the remaining clients hold
  seats 1 and 2 while `startMatch` binds them to void ids 0 and 1. The reconnect path sets
  `client.seat = voidId`, so C rejoining as void 1 takes key 1 in `room.clients` — B's key —
  and B is silently dropped from the room. Probed: B received **0** further state frames after
  C reconnected.
- **Fix:** `startMatch` now re-keys `room.clients` by void id (`c.seat = i`) and resets `hostId`
  to seat 0, making the 1:1 mapping the reconnect path already assumed actually hold.
- **Verify:** same scenario now yields `{"op":"reconnected","seat":1,"voidId":1}` for C and
  **+6** state frames for B in the following 400 ms.

### 2. An abandoned void coasts on stale intent when the last human leaves

- **File:** `server.js:347` — `cleanup`.
- **Concern:** the `ai = true` handover lived in the `else` branch, so it was skipped exactly when
  the departing client was the last one — the branch that deliberately keeps the match running for
  a reconnect. The void kept its final movement intent for the rest of the match.
- **Fix:** the handover now runs before the client-count branch and also zeroes `input`.

### 3. Malformed percent-escape returned 500 (was: suspected)

- **Fix:** `server.js:55` — `decodeURIComponent` has its own `try`/`catch` returning **400**.
- **Verify:** `GET /%E0%A4%A` → `400` (was `500`).

### 4. Unbounded frame length, unbounded reassembly, unmasked client frames (was: suspected)

- **Fix:** `server.js:81` adds `MAX_FRAME = 65536`; `wsDecode` rejects unmasked client frames
  (RFC 6455 §5.1) and any declared or reassembled length past that bound by returning a `fatal`
  flag, which the data handler turns into a clean close. Continuation reassembly is now bounded —
  previously `frag.data` could grow without limit because the per-chunk 64 KB check drains each time.
- **Verify:** an unmasked frame and a frame declaring 10 MB each close the connection; normal PING,
  fragmented `join` and ordinary play are unaffected.

### 5. Dead traversal guard and a Windows-only cache-header miss (was: suspected)

- **Fix:** the unreachable `path.includes('..')` check is replaced by a containment check on the
  joined path; the `immutable` test now reads `url.pathname` rather than the OS path, so vendored
  assets keep their long cache on Windows too.

### 6. The HUD pause button soft-locks the results screen

- **File:** `src/main.js` — `pauseMatch`, `finishMatch`.
- **Repro:** the HUD stayed visible under the modal results dialog. Clicking ⏸ there showed the
  pause overlay (`Session.pause` no-ops on a terminal state, but the UI did not); Resume then
  called `showNone()`, hiding results *and* pause and leaving an empty screen. Playwright confirmed
  `#btn-retry` became unclickable ("element is not visible").
- **Fix:** `pauseMatch` is a no-op unless a match is actually running, `resumeMatch` only acts from
  the pause screen, and `finishMatch` hides the HUD so nothing live sits behind an `aria-modal` dialog.

### 7. Restart leaves a held movement key inert

- **File:** `src/main.js` — `beginMatch`.
- **Repro:** hold →, pause, Restart. `lastSent` still held `{dx:100}` from the previous match while
  the new void started at zero intent, so the "only submit when intent changes" check never fired.
  Measured: the player label stayed at exactly `970.559px` for the whole post-restart sample.
- **Fix:** `beginMatch` resets `lastSent`, `boostToggle`, `boostHeld` and the boost button's active
  state. Measured after the fix: `1158.6px → 1207.8px`.

### 8. Focus and key handling around the settings/help overlays

- **Files:** `src/ui.js` — `overlay`/`back`/`restoreFocus`, `buildBindEditor`; `src/main.js` — keydown.
- **Repro:** `show()` overwrites `lastFocus` on every transition, so closing Settings restored focus
  to a control inside the now-hidden overlay; measured focus landed on `#btn-play` instead of the
  `#btn-settings` opener. Separately, the key-capture during a rebind did not stop propagation, so
  pressing Escape to cancel also reached the UI's own Escape handler and closed the whole panel
  (Playwright: `#btn-settings-close` gone), and the pause binding could re-open pause from behind an
  overlay.
- **Fix:** the opener is captured in `overlay()` and restored in `back()`, `restoreFocus` refuses
  hidden targets, the rebind capture calls `stopPropagation` / cancels on Escape / allows only one
  pending capture, and the pause key is ignored while settings or help is open.

## Suspected — not confirmed

(Items 2–4 of this section were confirmed and fixed on 2026-09-07 — see the review pass above.)

### 1. Command de-duplication remembers only the previous id

- **File:** `src/rules.js:223` — `if (cmd.id != null && cmd.id === v.input.lastCmdId) return { ok: true, deduped: true };`
- **Concern:** `spec.md` §5 asks to "Reject duplicates idempotently by command ID". Only the most recent
  id is retained, so an older id replayed after a different command is re-applied. The server derives
  ids from a client-controlled sequence number (`id: \`ws-${client.seat}-${msg.seq}\``,
  `server.js:266`), so a client can re-send `seq` values it has already used.
- **Why unconfirmed:** a `move` command only sets movement intent that the next tick would overwrite
  anyway, so no incorrect outcome could be produced; whether the weaker guarantee is acceptable here is
  a design call.

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
