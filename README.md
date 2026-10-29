# Gravity Hollow

A realtime collection arena: move a growing void through a lively miniature
plaza, consume smaller objects, and outscore rival voids before time expires.
A StarHermit engine script game (engine 1.26.1, host API 1.28): played
natively by the StarHermit client and in browsers by the engine's web runtime.

## Run

```bash
export STARHERMIT=~/sh/runtime/1.26.1/starhermit-1.26.1-linux-x86_64/starhermit
$STARHERMIT .            # play natively (a window)
npm run package          # rewrite the web loader index.html + starhermit-files.json after every change
npm run serve            # serve the folder (static + /api/v1/time) for the browser build
```

## Play

- **Move:** WASD / arrows, drag on the plaza, or the gamepad's left stick / D-pad.
- **Boost:** Shift / Space, the ⚡ tray button, or gamepad A / RT (spends mass).
- **Pause:** Esc / P / Start. **Undo:** Z (Practice only). **Hint:** H. **Camera reset:** C.
  Keys and pad buttons are rebindable in the runtime's Options.
- Eat anything smaller than you (it brightens). Avoid embers. Outweigh a rival
  by 25% to swallow them. Rank by mass collected; ties break on objectives,
  clean play, then speed.

## Modes

- **Learn** — 5 interactive lessons; each rule must be performed.
- **Journey** — 40 authored stages across 5 themes, mastery stage every 5th.
- **Daily Hollow** — one immutable seed per UTC day (platform clock).
- **Practice** — 3 difficulties, undo enabled, unrated.
- **Challenges** — 8 constrained rulesets (move limits, no boost, cramped court…).
- **Hosted Play** — local lobby with AI seats (labelled as such; platform realtime rooms are planned).
- **Signed in** — the account's name, the save in the cloud slot (merged across devices), ranked
  Daily Hollow and Challenge totals posted to the `high-score` board through `score-script.js`.

## Architecture

| Module | Role |
|---|---|
| `src/rng.js` | deterministic seeded streams |
| `src/rules.js` | pure rules engine: legal-action queries, commands, fixed 30 Hz step, scoring, rankings, serialization, state hashing |
| `src/content.js` | versioned stages/themes/tutorials/daily + offline validators |
| `src/session.js` | session over the rules, replay envelopes + verification, undo, save document, achievements |
| `native/main.ts` | engine entry: app state machine, match on the runtime's 30 Hz fixed steps, input, lessons, results |
| `native/screens.ts` | menus, HUD, tray, dialogs on `starhermit:ui` |
| `native/render.ts` | the plaza on `starhermit:scene` |
| `native/audio.ts` | authored clips, ambience beds, rendered music on the runtime's buses |
| `native/platform.ts` | engine save + migration of the old cloud save, game options, player, leaderboard |
| `native/verify-worker.js` | replay verification on a script worker |
| `server.js` | dev host: static files, `/api/v1/time`, authoritative WS rooms with AI backfill (not packaged) |

Determinism: same seed + same commands ⇒ identical state hashes. Replays record
schema/build/content version, seed, initial hash, ordered commands, periodic
hashes, and terminal result; `verifyReplay` re-simulates and compares.

## Tests

```bash
npm test                 # unit tests (rules, replay, save, i18n) + engine checks (tsc, starhermit check, play scripts)
npm run test:browser     # the packaged loader in GPU Chrome: desktop, phone, landscape
```

See `spec.md` for the full running spec.
