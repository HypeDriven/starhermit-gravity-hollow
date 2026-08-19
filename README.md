# Gravity Hollow

A realtime collection arena: move a growing void through a lively miniature
plaza, consume smaller objects, and outscore rival voids before time expires.

## Run

```bash
npm install        # once (vendors three.js; already vendored in vendor/)
npm start          # serves on http://localhost:8080 (static + /api/v1/time + /ws rooms)
```

Any static file server works for solo play (`npx serve .`, `python3 -m http.server`).
`npm start` additionally provides server-time sync and authoritative WebSocket rooms.

## Play

- **Move:** WASD / arrows, drag on the plaza, or gamepad left stick.
- **Boost:** Shift / Space, the ⚡ tray button, or gamepad A (spends mass).
- **Pause:** Esc / P. **Undo:** Z (Practice only). **Hint:** H. **Camera reset:** C.
- Eat anything smaller than you (it brightens). Avoid embers. Outweigh a rival
  by 25% to swallow them. Rank by mass collected; ties break on objectives,
  clean play, then speed.

## Modes

- **Learn** — 5 interactive lessons; each rule must be performed.
- **Journey** — 40 authored stages across 5 themes, mastery stage every 5th.
- **Daily Hollow** — one immutable seed per UTC day (server-time synced).
- **Practice** — 3 difficulties, undo enabled, unrated.
- **Challenges** — 8 constrained rulesets (move limits, no boost, cramped court…).
- **Hosted Play** — local lobby with AI seats; real rooms when served by `server.js`.

## Architecture

| Module | Role |
|---|---|
| `src/rng.js` | deterministic seeded streams (rules / decor / AV) |
| `src/rules.js` | pure rules engine: legal-action queries, commands, fixed 30 Hz step, scoring, rankings, serialization, state hashing |
| `src/content.js` | versioned stages/themes/tutorials/daily + offline validators |
| `src/session.js` | sim loop, replay envelopes + verification, undo, persistence, achievements |
| `src/render.js` | Three.js scene: instanced props, void views, pooled particles, quality tiers, camera springs |
| `src/ui.js` | DOM shell: screens, HUD, settings, help cards, live regions |
| `src/audio.js` | procedural WebAudio: bus sliders, event sounds, adaptive music |
| `src/main.js` | bootstrap, app state machine, input (keyboard/pointer/gamepad) |
| `server.js` | static host, `/api/v1/time`, authoritative WS rooms with AI backfill |
| `starhermit.txt` | distribution manifest (`name`, `launch`, `server`) |

Determinism: same seed + same commands ⇒ identical state hashes. Replays record
schema/build/content version, seed, initial hash, ordered commands, periodic
hashes, and terminal result; `verifyReplay` re-simulates and compares.

## Tests

```bash
npm test                 # rules engine, content validators, replay verification
```

Headless smoke run (real browser, self-driving match):

```bash
google-chrome --headless=new --enable-unsafe-swiftshader \
  --virtual-time-budget=60000 "http://localhost:8080/?smoke"
```

Add `?smoke` to auto-play a practice match; check the console for
`SMOKE_OK` / `SMOKE_END` (draw calls, triangles, replay verification).
