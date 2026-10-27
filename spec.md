# Gravity Hollow — Game Design Document (running spec)

Realtime collection arena: steer a hungry black **hollow** across a miniature night plaza, swallow anything smaller than you, dodge embers, outweigh rivals by a quarter to eat them, and bank the most **mass collected** before the clock runs out. This document describes the shipped game as it behaves today (present tense). Anything not yet built is confined to the final "Design intent not yet implemented" list.

## 1. Overview

| | |
|---|---|
| Pitch | Grow the hollow. Outscore the plaza. |
| Genre | Realtime collection arena (single-screen, timed, mass-based ranking) |
| Players | 1 human vs 0–7 deterministic AI rivals (`maxVoids` 8, `rules.js` `createMatch`) |
| Session | 45 s–5 min per match (content `durationSec`); Learn lessons end when the last step is performed |
| Platforms | The StarHermit engine 1.17.1 (host API 1.19): natively in the StarHermit client and in browsers through the engine's web runtime (WebGPU, WebGL 2 fallback); keyboard, mouse/touch drag, gamepad |
| Rendering | `starhermit:scene` (three.js-like) perspective scene with the runtime's post chain (ambient occlusion, bloom, display-space grade, FXAA/SMAA/MSAA); menus and HUD on `starhermit:ui` (immediate mode) over the plaza |
| Persistence | The engine save (`starhermit:storage` `saves`: the save document, on the device and in the player's cloud slot), the game's options (`settings`), the last 8 replays (device `storage`) |
| Host | `score-script.js` is the platform script declared in `starhermit.txt` (`server=`); `server.js` (static + `/api/v1/time` + authoritative `/ws` rooms) is a local dev host left out of the package |

File map:

| Path | Role |
|---|---|
| `starhermit.txt` | Manifest: name, owner, server, cover, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.17.1`, `engine.minor=19`, capabilities `platform,storage,clipboard`, nine `control.*` actions with `engine.gamepad.*` defaults and two Options groups |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand |
| `native/main.ts` | Entry module: app state machine, match lifecycle on the 30 Hz fixed steps, event presentation, `TutorialRun`, input (actions, drag steering, tray boost), results, replay check, leaderboard posting, lifecycle |
| `native/screens.ts` | `starhermit:ui` screens, HUD, tray, lesson banner, void labels, countdown, pause/results dialogs, toasts, captions; layouts by window size |
| `native/render.ts` | The plaza on `starhermit:scene`: ground textures, obstacles, instanced props, void views, particles, motes, markers, spring camera, post settings per look |
| `native/quality.ts` | The browser build's presets and budgets keyed by the runtime's quality tier and level |
| `native/audio.ts` | Authored Opus one-shots and ambience beds on the runtime's buses, rendered music notes, captions |
| `native/platform.ts` | Save shim (`localStorage` → engine save + device storage), conflict merge, foreign-save migration, the game's options and their legacy import, player, invite link, platform clock, plaza standings, score posting |
| `native/i18n.ts`, `native/style.ts`, `native/game.ts` | Locale tables and `T()`; the style sheet and high-contrast tokens; typed facade over the shared JS modules |
| `native/verify-worker.js` | `starhermit:script` module worker running `verifyReplay` off the game's thread |
| `src/rng.js`, `src/rules.js`, `src/content.js` | Seeded streams, the pure rules engine (`createMatch`, `queryActions`, `applyCommand`, `step` at 30 Hz, scoring, `rankings`, `hashState`), content (themes, 40 Journey stages, 8 challenges, 3 practice stages, 5 lessons, daily generator, validators) — shared with the node tests unchanged |
| `src/session.js` | Session over the rules (command submission, undo, replay envelope, `verifyReplay`), save document (`loadSave`, `mergeSaves`, `parseSaveDoc`, `envelopeJson`), achievements, `recordResult` |
| `src/i18n/` | `strings.js` / `strings-content.js` tables (classic scripts on `globalThis.GH_STRINGS`), `t.js` helpers for the shared modules |
| `src/platform-i18n.js` | Account-surface strings (sign-in, invite, sign-out, leaderboard lines) in nine locales |
| `assets/ui-style.json` | `tools/ui-style.css` (class-based rewrite of the old `styles.css`) converted by `npm run css` |
| `assets/*.webp`, `sfx/*.opus`, `cover.jpg`, `icon.png` | Key art and results illustrations, 28 audio clips, platform cover and icon |
| `score-script.js` | Platform score script: range-checks a ranked round's total and posts it to the `high-score` board |
| `tests/`, `tools/` | Unit tests, engine checks and play scripts; package, CSS and browser-play tools (left out of the package) |

## 2. Vision and design pillars

1. **Appetite is the only stat.** Everything flows from mass: radius (`0.55·√mass`), speed (falls with the fourth root of mass), what you may eat (≤ half your mass), whether you may boost (mass > 14), whether a rival may eat you (they need 1.25× your mass). Rules in: a single number the player can read on the HUD and on every void label. Rules out: power-ups, hit points, upgrades, cosmetics that change hitboxes.
2. **Dimmer than you is dinner.** Legality is always visible on the pavement: edible props pulse bright, inedible ones sit at 42 % brightness, embers glow orange and never brighten, a protected void's ring blinks. Hints and tutorials use the same `queryActions` the input layer uses. Rules out: hidden thresholds, hover-only information, audio-only cues.
3. **The plaza is a diorama.** One authored 52° tilt camera, a tabletop-scale plaza with fountain, planters and arcade blocks, five themed palettes, instanced faceted props. Rules in: readable silhouettes (icosahedron crumb → dodecahedron boulder → octahedron gem → tetrahedron ember). Rules out: free camera, first-person, particle storms that hide props.
4. **Same seed, same match.** Every stage is data with a seed; the rules stream lives inside the state; replays re-simulate and compare hashes; the daily is immutable per UTC day. Rules out: `Math.random` in rules, wall-clock in the engine, client-claimed scores.
5. **Spending, not gifts.** Boost burns 0.25 mass per tick, embers take 3, dying keeps only 60 %. Growth is earned by lines through the plaza, not bursts. Rules out: free dashes, invulnerability pickups, rubber-banding for the AI.

## 3. Player experience

**Target player.** Someone who likes short arena rounds with a clear score, on a phone or a laptop, and wants a fair daily to compare with friends by hand.

**First 60 seconds.** The runtime starts straight on the title over the idle plaza. The title is one tap from play: *Play → Learn* is badged "start here" until all five lessons are done (`native/screens.ts` mode cards). Lesson 1 ("Drift") starts with no countdown and a banner: *"You are a hollow — a small hungry void. Move with WASD, arrow keys, or drag on the plaza."* The step completes after 45 ticks of movement, then three yellow marker rings appear to visit. Each new mechanic (motes, chunk/boulder thresholds, embers, boost, rivals) gets its own lesson with a banner, a hint line and a *Skip lesson* button. Outside Learn, the Help overlay (title and pause menu) generates rule cards from the current key bindings.

**Session shape.** Title → mode → setup card (duration, rivals, boost rule, ranked flag, undo, objectives) → 3-2-1 countdown → 45–300 s of steering → results dialog with standings, score breakdown, objectives, replay hash → *Next* (next lesson / next Journey stage / home), *Retry*, *Home*.

**Emotional beat.** The moment a rival's label reads a quarter less than yours and their body brightens: the hunted becomes the hunter. The mirror beat — a bigger ring sliding into view — is the game's tension.

## 4. Core loop and rules contract (`src/rules.js`)

**Entities.** Arena is a square of half-size `arenaHalf` (26–50) with axis-aligned rectangular obstacles (`fountain`, `planter`, `arcade`). Props: `crumb` (mass 1), `chunk` (3), `boulder` (8), `gem` (15, flagged `gem`), `ember` (4, `hazard`, never edible). Voids: `{id, name, ai, x, y, vx, vy, mass, startMass, r, alive, respawnTicks, protectTicks, input, moveTicksUsed, boostsUsed, propMass, gemMass, rivalMass, gemsEaten, rivalsEaten, deaths, invalid}`. Void 0 is always the local player.

**Timebase.** `TICK_RATE = 30`; `step(state)` advances one tick. Phases: `countdown` (`countdownSec`, default 3; 0 in Learn) → `active` → `ended`.

**Commands** (`applyCommand`). `{id, voidId, seq, type:'move', dir:[dx,dy], boost}` or `{type:'noop'}`. Validation order: unknown void → `no_such_void`; same `id` as the last accepted → `{ok, deduped}`; unknown type → `unknown_command` (+1 invalid); non-finite or |component| > 100 → `dir_out_of_range` (+1 invalid); boost requested while `!canBoost` → boost dropped, `boostRejected`, +1 invalid; movement while `!canMove` during `active` → rejected with the `moveReason`, +1 invalid; during countdown intent is buffered silently. Accepted commands store intent only; the next tick consumes it.

**Legal-action query** (`queryActions`) returns `canMove/moveReason` (`countdown`, `not_active`, `respawning`, `move_limit`), `canBoost/boostReason` (`boost_disabled`, `boost_limit`, `too_light`), `edible[]` (props with mass ≤ 0.5·mass within reach + 8, rivals you outweigh by 1.25×), `hazards[]` (embers within reach + 4, bigger rivals within `r+r+6`), `moveTicksLeft`, `boostsLeft`. Hints (`native/main.ts` `doHint`), the HUD and the tutorial all consume this.

**Resolution order per active tick.** (1) `aiThink` for AI voids: flee any void that can eat them within `r+10`, else retarget every `(1.6−skill)·15+5` ticks to the nearest edible prop (or rival if skill > 0.5), boost only while fleeing with mass > 28. (2) Movement in id order: dead voids count down `respawnTicks` and `respawn`; protection ticks decay; direction is clamped to magnitude 100; `speed = max(4.05, 9·(startMass/max(startMass,mass))^0.25)`; boost (×1.6) applies when intent.boost, mass > 14, boost rule allows, moving, and not move-limited — it drains 0.25 mass/tick to a floor of 14 and increments `boostsUsed` on each new burst; with `moveLimit` set, moving ticks are counted and further movement is zeroed (`move_limit` event); `collide` clamps to the rim and pushes out of obstacles along the shallower axis. (3) Prop consumption: an ember within `0.9·r` on an unprotected void takes 3 mass (floor 5) and grants a 0.5 s mercy window (`burn`); an edible prop within `r` is removed, mass added, `eat` or `eat_gem` emitted. (4) Void vs void, pairs in id order: if `a.mass > 1.25·b.mass`, `b` unprotected and distance < `0.95·a.r`, `a` gains `round(0.5·b.mass)` as `rivalMass`, `b` dies (`deaths++`, `respawnTicks = 3 s`, intent cleared), `eat_void`. (5) Goals for void 0: `mass`, `gems`, `score` (= mass collected), `rivals` progress and complete on reaching `target` (`goal` event); `survive` is evaluated at the end. (6) Every 12th tick `fillProps` refills to `propTarget` using `propWeights`, never inside a void's radius + clearance. (7) Terminal: `tick ≥ durationTicks` → `time_expired`; or with a `moveLimit`, the player alive and out of moves → `moves_exhausted`. Learn lessons end when `TutorialRun.advance` sets `lesson_complete` (`native/main.ts`).

**Spawn and respawn.** `makeVoid` picks a free spot with clearance 3 (60 tries); protection lasts 90 ticks. `respawn` keeps `max(startMass, round(0.6·mass))`, re-arms 3 s protection.

**Scoring** (`scoreBreakdown`, `massCollected`). `massCollected = propMass + gemMass + rivalMass`; `total = massCollected + survivalBonus(50 if deaths = 0) − 2·invalid`. Worked example: 20 crumbs + 6 chunks + 2 boulders = 54 props; 3 gems = 45; one rival swallowed at mass 60 → +30 rivals; zero deaths; 2 invalid actions → `massCollected 129`, `total 129 + 50 − 4 = 175`. The results dialog shows every component; standings and Journey stars rank on `massCollected`, the daily and challenge records store `total`.

**Rankings and tie-breaks** (`rankings`): higher `massCollected`; then primary objective done; then fewer invalid actions; then lower authoritative elapsed ticks (`elapsedActiveTicks − respawnTicks` for dead voids); then lower void id.

**RNG and seeding.** `RngStream` (mulberry32) state is stored in `state.rng` and restored around every step, so serialize → deserialize → step is bit-identical. Seeds come from `seedFromString` of stable keys (`gh:journey:v1:<n>`, `gh:daily:v1:<YYYY-MM-DD>`, `gh:challenge:v1:<id>`, `gh:learn:v1:<n>`); hosted local tables use `Date.now()`. Decoration (`groundTexture`) and audio pitch variants use separate streams and never touch rules.

**Hashing.** `hashState` projects tick, phase, rng, props (id, x, y rounded to 1e-3, mass, kind), void scoring fields, goals and elapsed ticks into FNV-1a hex.

**Undo** (`session.js`): Practice only (`undoAllowed`); a serialized snapshot is pushed per accepted command (stack of 40); `undo` pops to the previous snapshot, flags `undoUsed`, and the results line reads "Practice mode — replay not ranked". **Hints**: unlimited, no penalty.

## 5. Modes and progression

| Mode | Content | Rules that differ | Ranked |
|---|---|---|---|
| Learn | `tutorials()`: 1 Drift, 2 Nibble, 3 Appetite, 4 Ember & Boost, 5 Rivals | 600 s cap, no countdown, arena 30, no obstacles, boost off until lesson 4, steps must be performed (`TutorialRun`) | no; completion stored in `tutorialsDone` |
| Journey | `journeyStage(1..40)`: 8 tiers of 5, every 5th a Mastery stage | see curve below | stars 0–3 |
| Daily Hollow | `dailyStage(utcDateKey)` from server-synced UTC date | 150 s, theme/arena/rivals/embers seeded by date, goal 4 gems | local record `{score, place}` |
| Practice | relaxed / standard / intense | 120 s; 0/1/2 rivals; 0/3/6 embers; undo on; `unrated` | no |
| Challenges | 8 fixed rulesets (Dusk Bazaar) | Sprint 45 s · No Boost Bout · Three Bursts (`boost:'limited'`, 3) · Measured Steps (25 s of movement, 300 s clock) · Gem Rush (gem weight 22, 3 rivals) · Ember Gauntlet (18 embers + survive) · Leviathan Tank (rivals ×3 / ×2.2 mass) · Cramped Court (half 26) | `{done, best}` |
| Hosted Play | Quick Match (4 seats, 120 s) / Big Table (8 seats, 180 s) | honest local lobby: AI fills every seat, Tideglass theme, no obstacles, no goals; cards say so; the client opens no WebSocket | no |

**Journey curve** (tier = ⌈i/5⌉): theme cycles verdant → ember → tide → dusk → frost; `arenaHalf = min(50, 34 + 2·tier)`; rivals `min(5, tier − 1 + mastery)` with skill `0.3 + 0.07·tier (+0–0.1)`; embers from tier 2 (`min(14, 3 + 2·tier)`); duration `100 + 5·tier` s (150 s on Mastery); boost off for stages 1–3. Concepts: 1–2 *collect* (score 60/80) → 3–4 *grow* (mass 90/100) → 5–6 *gems* (3–4 gems) → 7–9 *hazards* (score + zero deaths) → 10–14 *rivals* (swallow 1; 2 on stage 10) → 15–20 *combo* (gems + survive) → 21–30 *contest* (score + 1 rival) → 31–40 *mastery* (6 gems, 2 rivals, survive). Stage *n* unlocks when stage *n−1* has a record. Stars = won (1st place) + all objectives + zero deaths (`recordResult`). `masteryXp` accumulates mass collected.

**Achievements** (`session.js` `ACHIEVEMENTS`, idempotent `unlock`): `first_void`, `mechanic_master` (prop + gem + rival + boost in one match), `streak_3` (three distinct play days), `journey_20`, `mastery_clear`, `quiet_giant` (300+ mass, zero deaths), `long_table` (25 sessions). Unlocks toast and play `achievement` on the results screen.

## 6. Controls and interaction

Actions are declared in `starhermit.txt`; players rebind keys and gamepad buttons in the runtime's Options (Settings › *Keyboard bindings* opens the rebinding screen).

| Action | Keyboard | Pointer / touch | Gamepad |
|---|---|---|---|
| Steer (`up`/`down`/`left`/`right`) | W A S D / arrows (held; diagonals normalised) | press and drag anywhere on the plaza outside the HUD: direction from the player's projected screen position to the pointer, 24 logical px dead zone | left stick (analog) or D-pad |
| Boost | Shift / Space | ⚡ tray button (hold, or toggle when *Hold-to-boost* is off) | A (South) or RT |
| Pause / resume | Esc / P | the pause button (two bars) in the HUD, *Resume* | Start |
| Undo (Practice) | Z | ↩ tray button | X (West) |
| Hint | H | ? tray button | Y (North) |
| Camera reset | C | ◎ tray button | right stick press |

**Input pipeline** (`main.ts`): each 30 Hz fixed step while a match runs (not paused, no dialog, window shown) the intent is computed — `value(right) − value(left)`, `value(down) − value(up)` × 100, a drag replacing it, boost from the action, the held tray button or the toggle — and a move command is submitted only when `dx/dy/boost` differ from the last sent (ids `local-<stage>-<seq>`), then one rules step runs. Pointer and touch presses are queued and decided after the frame's UI is built: a press on a HUD rectangle belongs to the UI, elsewhere it starts a drag. While steering keys are held during play, UI focus is cleared so arrows do not walk the HUD.

**Locking.** During the countdown intent is buffered, not rejected. Pause is ignored on the frame a dialog opened; Escape on a list or page goes back. Rejected commands with a reason other than not active / cannot move / respawning / move limit are announced.

**Feedback per input.** Menu buttons: `ui_confirm`/`ui_back`. Steering: body squash along velocity, boost trail particles, `boost` whoosh per burst. Eating: particle burst, `eat`/`eat_boulder`/`eat_gem`, vibration 8–15 ms (runtime `vibrate`, off when the player turned vibration off). Burn: orange burst, shake 0.5, `burn`, 25 ms. Swallowed: `swallowed`, assertive announcement; swallowing: white burst, shake 1.0, `eat_void`, 40 ms. Hint: `hint` + 4.2 s toast. Undo unavailable: `invalid` + toast.

## 7. Screens and UI flow (`native/screens.ts`)

`title → modes → setup → (HUD + countdown) → playing ⇄ pause → results → title`, with Settings and Help opening over the title, a list or the pause menu and returning there; Journey and Profile reachable from the title. The plaza renders behind every screen (an idle Practice — Standard plaza behind the menus, dimmed). Hiding the window during solo play pauses the match with "Paused because the tab was hidden."; on return the pause line shows the away summary (mass, props left).

- **Title.** Key art (hidden below 560 px height), logo, tagline, **Play** (focused), Daily Hollow (with "new in Hh Mm" / "done · N pts"), Journey (n / 40) and Profile (name) cards, How to play, Settings, *Sign in with StarHermit* for guests, *Invite a friend* when signed in, the sync line.
- **Mode cards** (grid, ≥ 200 px cards): Learn, Journey, Daily Hollow, Practice (three difficulties), Challenges (eight), Hosted Play (Quick Match, Big Table); the first card is focused.
- **Setup card.** Stage name, description, duration, rivals, boost, ranked, undo, objectives; on the Daily Hollow the top ten of the `high-score` board (guests can read it) and the player's rank. Start / Back.
- **Journey** 40-cell grid (5 per row on phones), stars, mastery cells outlined, locked cells disabled. **Profile**: name (a text field for guests; the account's display name when signed in), sync line, stats, achievements. **Settings**: Captions, Colour palette, Left-handed tray, Hold-to-boost, *Keyboard bindings*, *Open Options*, Done, Replay tutorial. **Help**: nine rule cards built from the current key bindings.
- **HUD.** Desktop: left rail (stage, objectives), centre (timer, live standings ≥ 1024 px), right rail (mass/collected, moves/boosts left, pause). Portrait phones (≤ 700 px wide): timer centred on top, objectives rail left (60 %), score and pause right. Short landscape (≤ 500 px tall): one 200 px column at the left (timer + pause, stage, objectives, score) and the tray down the right with 48 px buttons. Tray: 64 px round buttons centred at the bottom (left-handed: bottom start). Name · mass labels float over each live void.
- **Lesson banner** below the HUD cards (beside the column in short landscape) with *Skip lesson*. **Countdown** 3-2-1 then GO (0.6 s). **Pause dialog**: Resume, Settings, Help, Restart, Leave match. **Results dialog** (scrolling body, pinned Next / Retry / Home): headline, illustration (hidden below 560 px height), standings, score breakdown, objectives, progress line, replay line, leaderboard line; two columns from 560 px.
- **Toasts** stack at the top end under the right rail in play, centred at the top over screens and dialogs; captions sit above the tray.

## 8. Art direction

**Palette (styles.css tokens).** `--bg #0b100d`, `--panel rgba(16,24,20,.92)`, `--panel-border #2c5240`, `--text #e8f0ea`, `--dim #9db3a6`, `--accent #9fe6a0`, `--accent-2 #64f2c0`, `--danger #ff7a5c`, `--focus #ffe066`; primary buttons `#2c6b45 → #1f4d33`; high contrast swaps to `#00ff88` on `rgba(0,0,0,.96)`. Theme palettes (`content.js` `THEMES`): Verdant Court sky `#0c1a12`, ground `#1c3327`, lines `#2c5240`, accent `#9fe6a0`, gem `#64f2c0`, ember `#ff7a3c`; Ember Arcade `#1d0f0a / #33201a / accent #ffb25e / gem #64d8f2`; Tideglass Promenade `#0a1420 / #16283a / accent #7ee0e6 / gem #f2e664`; Dusk Bazaar `#160f22 / #251a38 / accent #e69fd8 / gem #9ff264`; Frost Meridian `#0d141c / #1e2c38 / accent #a0d8f2 / gem #f2b064`. Rival ring colours come from `hashColor` with default and deuteranopia/protanopia/tritanopia sets; the player's ring is white.

**Hero.** The player's hollow: a clear-coated jet-black flattened sphere (`MeshPhysicalMaterial`, y-scale 0.72) with a white base ring and a dim inner disc, sitting on a hand-laid pavement texture (`groundTexture`, seeded wobble per theme). Key art (`assets/key-art.webp`) and the cover render the same subject: a marble-sized black sphere with a glowing white ring on a mossy green diorama plaza with a mint fountain.

**Shape language.** Faceted props by kind (icosahedron, larger icosahedron, dodecahedron, spinning octahedron gem, spinning tetrahedron ember); rounded planters with icosahedron bushes; cylinder fountain with an emissive accent pool; rim boxes around the plaza.

**Typography.** The runtime's `system-ui` faces; logo 48 px (32 px on narrow or short windows) in the accent colour (the old gradient text is a flat accent); tabular numerals on timer and breakdown; text size follows the runtime's text-size option.

**Lighting and camera.** ACES tone mapping, exposure 1.18; hemisphere fill + ambient + one warm directional key at (30, 55, 18), three.js intensities ÷ π (the engine's convention); the key's shadow follows the view out to 160 units; fog from 90 to 260 units. On detailed looks `RoomEnvironment(renderer)` through `PMREMGenerator` is the scene environment. Camera fov 38, tilt 52°, distance `max(46, 1.55·arenaHalf)`, trails the player through a critically damped spring (k 42, c 12) with a hard margin, shake amplitude 0.35 decaying at 6/s.

**Motion.** Gems bob and spin; embers flicker; edible props pulse 0.85–1.0; protected rings blink at 10 Hz; boost trail every third frame; particle bursts are event-tiered (6 crumb, 14 gem, 12 burn, 26 goal, 30 rival). The runtime's reduced-motion option disables particles, trails and shake and freezes motes, swirls and water shimmer.

**Graphics levels.** The runtime's Options › Graphics chooses the level (Auto by default) and owns render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout. The game maps the level's tier (`frame().quality`) to the browser build's presets (`native/quality.ts`): Low = no shadows, no post effects, MSAA, no particles, plain ground, Lambert materials; Balanced = 1024² shadows, bloom, grade, FXAA, 400 particles, detailed, atmosphere; High = 2048² shadows, AO, SMAA, 1200 particles, clear-coated physical hollows/gems/water; Ultra = 4096² shadows, full AO, MSAA, 2048 px pavement. *Detailed* adds the slab pavement with bump map, hedges, fountain details, masonry caps, the rim light strip, contact shadows; *atmosphere* adds motes, accretion swirls and water shimmer. Bloom uses threshold 2.0 so only embers, gems and the player's white ring glow (their emissive runs hotter while bloom is on); the grade is display space (contrast 0.1, saturation 1.1, cool shadows / warm highlights, vignette 0.28). Motes and sparks scale with the level within a tier (≤ 2×). A tier change that alters a budget rebuilds the plaza; the match keeps running.

| Tier | Materials | Clear-coat | Pavement | Round LOD | Motes | Sparks | Bloom / AO resolution |
|---|---|---|---|---|---|---|---|
| Low | Lambert | no | 256 px plain | ½ | 60 | — | — |
| Balanced | Standard | no | 1024 px detailed | ¾ | 120 | 0.75× | ½ / — |
| High | Standard | yes | 1024 px detailed | 1 | 180 | 1× | ½ / ½ |
| Ultra | Standard | yes | 2048 px detailed | 1.5 | 300 | 1.5× | full / full |

**Visual assets the design calls for.** Title key art (shipped), results win and defeat illustrations (shipped), cover art derived from the key art (shipped), procedural everything else; no TRELLIS model (the hero is a primitive sphere by design) and no character animation (no humanoid).

## 9. Audio direction (`native/audio.ts`)

**Mix.** The runtime's buses: music (the procedural plucked pattern: every 260 ms a triangle note from the theme's pentatonic scale with a chance that rises from 0.3 to 0.9 across the match, a low sine every eighth beat; notes rendered once into clips with the old oscillator envelope), effects (every one-shot and the looping theme ambience bed) and interface (menu cues); the old default levels (music 0.7, effects 0.9, ambience 0.5 × bed 0.6) are folded into each sound's gain. Volumes, mute and the voice limit are the runtime's Options. Clips load one at a time once the mixer runs (natively at once, in browsers after the first press); a clip still loading is silent (the browser build's synth fallbacks are not ported: a live synthesis graph breaks clip loads on the web runtime). Pause and a hidden window hold the music and bed. Captions (Settings › Captions, default on) show each captioned cue's text above the tray.

| Event id | File | Sound | Usage |
|---|---|---|---|
| `ui_move` | ui-move.opus | soft hollow-gourd tick | camera reset button |
| `ui_confirm` | ui-confirm.opus | warm rising marimba pluck | Play, mode cards, Start, Resume, Retry, Next |
| `ui_back` | ui-back.opus | muted falling woodblock | Back, Pause opened, Leave |
| `invalid` | invalid-buzz.opus | dull padded buzzer thunk | undo unavailable |
| `eat` | eat-morsel.opus | crisp seed-pod crunch + gulp | player eats a crumb or chunk |
| `eat_boulder` | eat-boulder.opus | deep gourd crunch, low gulp | player eats a boulder (mass ≥ 8; routed from `eat`) |
| `eat_gem` | eat-gem.opus | glass-bell chime with shimmer | player eats a gem; tutorial marker visited |
| `eat_void` | eat-void.opus | inward whoosh, resonant thud | a rival is swallowed by anyone |
| `swallowed` | swallowed.opus | inward gulp implosion, muffled boom | the player is swallowed |
| `burn` | ember-burn.opus | twig-snap sizzle | player touches an ember |
| `boost` | boost-whoosh.opus | canyon gust | each boost burst |
| `respawn` | respawn-bloom.opus | swelling bubble shimmer | player respawns |
| `goal` | goal-chime.opus | three ascending hand-bells | objective complete; tutorial step passed |
| `countdown` | countdown-tick.opus | dry clave click | 3-2-1 |
| `go` | go-signal.opus | whistle chirp | match becomes active |
| `clock_warning` | clock-warning.opus | low drum hit + tense shaker swell | once when < 15 s remain (timer turns red) |
| `move_limit` | move-limit-stop.opus | sandbag thud, then silence | Measured Steps: movement exhausted |
| `round_end` | round-end-fanfare.opus | four-note drum-and-bell fanfare | player finishes 1st |
| `defeat` | defeat-fall.opus | descending beanbag thumps | player finishes below 1st |
| `lesson_complete` | lesson-complete.opus | two-bell resolution + kalimba chord | last Learn step performed |
| `undo` | undo-rewind.opus | reversed tape warble | Practice undo |
| `hint` | hint-spark.opus | needle-on-silver ping | hint requested |
| `achievement` | achievement-unlock.opus | bell cascade + wooden clap | new achievement on results |
| `ambience_garden` | amb-garden.opus (8 s loop) | crickets, fountain trickle, leaves | Verdant Court bed |
| `ambience_forge` | amb-forge.opus (8 s loop) | coal crackle, cooling-metal ticks | Ember Arcade bed |
| `ambience_shore` | amb-shore.opus (8 s loop) | waves on smooth stone, wind | Tideglass Promenade bed |
| `ambience_market` | amb-market.opus (8 s loop) | distant murmurs, awnings, wind chime | Dusk Bazaar bed |
| `ambience_tundra` | amb-tundra.opus (8 s loop) | thin cold wind, ice creaks | Frost Meridian bed |

This table is the source of `sfx/manifest.txt` (`file | event id | description | usage`); `sfx/manifest.json` carries the generator prompts and `sfx/manifest.md` is regenerated by the tooling.

## 10. Localization

Every player-facing string exists in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT. English source text is the key: `src/i18n/strings.js` (interface) and `src/i18n/strings-content.js` (challenges, Learn lessons, achievements) hold rows of `[English, es-419, de-DE, fr-FR, pt-BR, it-IT]`; en-GB, es-ES and fr-CA list only their differences and otherwise inherit en-US, es-419 and fr-FR. Rival names, account names and typed names are not translated; the default guest name *Wanderer* is. Account strings are `src/platform-i18n.js`.

The language is the runtime's interface language (`preferences().language`: the player's choice in Options › Language, else the account's preferred language or the device's), mapped to the nearest shipped locale (`native/i18n.ts`); every string is drawn through `T()` each frame, so a change shows on the next frame, mid-match included. `tests/i18n.test.mjs` checks every key used in `native/*.ts`, `src/session.js` and the content exists in the five full tables with the same placeholders, that regional tables only refine their parents, that no table keeps unused keys, and that the account strings cover all nine locales.

## 11. Accessibility

- **Keyboard and gamepad.** Every screen focuses its main control (Play, the first mode card, Start, Resume, Next); Tab, arrows and the pad navigate the UI; Escape / East go back; focus ring 3 px `#ffe066`.
- **Screen readers.** The runtime's accessibility tree names every widget (tray buttons and the pause button carry names); announcements: stage start, countdown, "Go!", gems, burns, swallowing, respawns, hints, toasts, results headline + total.
- **Captions** for audio cues (default on).
- **Colour.** Ownership is ring colour + label + shape; rival palettes for deuteranopia, protanopia and tritanopia (Settings › Colour palette); the runtime's high-contrast option swaps the UI tokens (black panels, white text and borders, `#00ff88` accent).
- **Motion, text, vibration.** The runtime's reduced-motion, text-size, interface-size and vibration options apply.
- **Targets.** Buttons ≥ 44 × 44 logical px; tray buttons 64 px (48 px in short landscape) with 12 px (8 px) gaps.
- **Options.** Left-handed tray, hold-vs-toggle boost, key and pad rebinding (runtime), replay tutorial.

## 12. StarHermit integration

All platform traffic goes through the runtime (`starhermit:platform`, `starhermit:storage`); guests make no platform request beyond the clock and board reads.

| Platform feature | Status in this build |
|---|---|
| Manifest | `starhermit.txt` (§1); controls are rebindable in Options |
| Sign-in / identity | Guests see *Sign in with StarHermit* (`requestSignIn`, the runtime's Account dialog); signed in, the account's display name is the profile name; a signed-out session (`onSessionEnded`) toasts that progress keeps saving on this device |
| Invite link | *Invite a friend* on the title when signed in copies `inviteLink()` (fetched ahead) with a toast |
| Saves | The save document is the engine save (`saves.save`, debounced to the cloud slot when signed in); conflicts merge with `mergeSaves` (best journey stars and scores, every finished lesson, challenge and achievement with its earliest unlock, the better daily score per day, higher counters, every day played); a newer save from another device is merged in on arrival. The browser build's cloud slot (`game:<slug>`, `{v, save, savedAt}` from the JS SDK) shows as foreign: it is parsed (`parseSaveDoc`), merged with this device's progress and replaced once (`replaceForeign`). Guests' old browser `localStorage` progress does not carry over |
| Settings | The game's options (captions, palette, left-handed, hold-to-boost) are `settings` keys synced with the account; the browser build's settings KV values for those carry over once, then all its keys (volumes, graphics, language, timing assist, haptics, camera sway…) are removed (their runtime equivalents are the Options) |
| Leaderboards | One board, `high-score` (integer, 0–100,000). A finished Daily Hollow or Challenge round whose replay verifies posts its total (floored at 0) through `score-script.js` (a practice session whose socket carries `{type:'result', scores}`); the results show "Leaderboard rank: #N" (or posted / not posted). The board's top ten show on the Daily setup card for everyone |
| Server time | `serverNow()` gives the daily's UTC date and the "new in" countdown (the device clock until it answers) |
| Server script | `score-script.js` only range-checks and posts solo totals (user decision for solo boards); no match results come from the client otherwise |
| Platform achievements | not used — the 7 achievements live in the saved document |
| Realtime rooms | not used — Hosted Play is a local lobby with AI seats and is not recorded |

## 13. Technical architecture

- **Ownership.** `Session` owns the rules state; only `Rules.applyCommand` mutates intent and only `Rules.step` advances. `render.update(state, events, dt)` reads the state and never writes; screens hold no simulation state.
- **Loop.** `setFixedRate(30)`: each fixed step submits the intent and runs one `tickOnce()` while the match runs (paused, a dialog up or a hidden window stop it), then the lesson's per-step checks, the countdown cue, music intensity and the 15 s warning. `onRender` builds the UI, decides queued pointer presses, then updates the plaza. Checks run one fixed step per frame, so play scripts replay exactly.
- **Determinism and replay.** Replay envelope: `{schema 1, build '1.0.0', contentVersion, seed, stageId, initialHash, startedAt, commands [[step, seq, dx, dy, boost]], hashes every 60 steps, result}`. At the end of a match `native/verify-worker.js` (a module worker) runs `verifyReplay` off the game's thread; the results show "Verifying replay…", then "Replay verified · <hash>" or the mismatch; Practice rounds with undo show "Practice mode — replay not ranked"; lessons (ended by their steps, not the rules) are not checked. The last 8 replays are kept in device storage.
- **Persistence.** The session's documents are `{v:1, data, checksum}` envelopes in `localStorage`; `native/platform.ts` provides `localStorage`: the save key reads and writes the engine save, other keys device storage. A bad checksum falls back to defaults.
- **Content validation.** `validateAll` runs in tests: identity, duration ≤ 900 s, arena 20–60, known theme, gem-goal reachability, obstacle axis blocking, ≤ 7 rivals.
- **Performance.** Props are 5 `InstancedMesh` draws, one particle `Points` pool, per-void 3 meshes (+ contact shadow and swirl when detailed), one motes `Points`. Natively the game thread takes ~2.8 ms p50 / 4.4 ms p95 a frame in an 8-void Big Table match (render check).
- **Server.** `server.js` (dev only) keeps its authoritative `/ws` rooms with AI backfill; the client never opens them.

## 14. Testing and acceptance criteria

`npm test` = unit tests (`tests/rules.test.mjs` 150 assertions: creation/serialization, deterministic replay, seed divergence, legal actions and invalid reasons, consumption and growth, embers, void-eats-void and respawn, terminal state, rankings and tie-breaks, obstacle containment, command fuzz, content validators, golden Journey sessions, snapshot resume; `tests/session.test.mjs` 5: replay verification and tamper detection; `tests/save.test.mjs`: the old cloud document and the engine save read, junk refused, foreign merge, the stored envelope round-trip; `tests/i18n.test.mjs` §10) and `tests/native.mjs`: the web index matches the files, `tsc` (strict, no skipLibCheck), `starhermit check .` with zero warnings, and the play scripts in `tests/native/` as signed-out render checks — `screens.play` (title, modes, Practice setup, countdown, steering, pause), `menus.play` (Profile, Settings with a toggle, Help, Daily setup, a Practice match with Undo, Hint and the boost toggle, Leave match), `learn-drift.play` (lesson 1 by keys, Skip, lesson results, Next to lesson 2), `challenge-sprint.play` (Sprint Hollow to results with the verified replay, Retry), `journey-stage1.play` (Stage 1 to results, Next to the next setup card). `npm run test:browser` (`tools/browser-play.mjs`) plays the packaged loader in GPU Chrome at 1366×768, 390×844 @3× and 844×390 @3×: Play, Learn, steering by keys, mouse drag and touch drag, pause, Leave match, failing on any console error or warning.

QA bar: (1) a new player sees instructions within the first lesson banner and every mechanic has a lesson and a help card; (2) every mode card, setting, tray button and results button is reachable by pointer, keys and pad; (3) no console errors on start, during play or on results; (4) at desktop, portrait phone and short landscape no HUD element, tray button, dialog button or text is clipped; (5) all match results are produced by the rules engine.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 63 KB) | title backdrop | FLUX.2 klein, seed 9501, 1536×864 → webp q82 | generated in this pass, wired |
| `assets/results-win.webp` (1024×576, 42 KB) | results illustration, 1st place / lesson complete | FLUX.2 klein, seed 9502 | generated in this pass, wired |
| `assets/results-defeat.webp` (1024×576, 20 KB) | results illustration, not 1st | FLUX.2 klein, seed 9503 | generated in this pass, wired |
| `coverart.png` (1200×675, 329 KB) | platform cover | key art + title/tagline typeset with ffmpeg drawtext, 256-colour PNG | replaced in this pass (previous file was a generic placeholder) |
| `icon.png` (256×256) | platform icon | hand-authored PNG | shipped |
| `sfx/*.opus` — 18 original clips | events in §9 | MOSS-SoundEffect v2.0 | shipped |
| `sfx/clock-warning`, `move-limit-stop`, `eat-boulder`, `lesson-complete`, `swallowed` (.opus) | new one-shots in §9 | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired |
| `sfx/amb-garden`, `amb-forge`, `amb-shore`, `amb-market`, `amb-tundra` (.opus, 8 s) | theme ambience beds | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired (looping bed) |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | canonical binding table / generator entries / generated summary | — | shipped |
| Ground, props, voids, obstacles, particles | all in-game geometry and textures | procedural (`native/render.ts`) | shipped |
| 3D hero model, character animation | — | — | not required by the design |

## 16. Known limitations

- Command de-duplication remembers only the previous command id per void (`rules.js` `applyCommand`), so an older id replayed after a different command is re-applied; harmless because a move only sets intent.
- Hosted Play is a local lobby with AI seats and is not recorded; server.js's `/ws` rooms are dev-only. Platform realtime rooms (a room-bound session refereed by the server script) are future work.
- `dailyExcluded` is read from the save but never written by any code path.
- The title's "Journey n / 40" and "stages cleared" count any stage with a record, including 0-star attempts; `journey_20` correctly requires stars.
- Sounds whose clip is still loading are silent (no synth fallback on the engine); ambience starts when its bed has loaded.
- Guests' progress from the old browser build's `localStorage` cannot migrate (signed-in cloud saves do).
- The AI does not use obstacles or boost tactically; skill only changes retarget cadence and rival hunting.
- The browser build's per-category graphics overrides and its *Timing assistance* toggle (stored, never read) are not offered; the runtime's Options choose a graphics level.
- Drag steering can't be exercised by play scripts (they only tap); the browser check covers it.

## Design intent not yet implemented

- Platform realtime rooms for Hosted Play (host-routed: rooms API lobby/matchmaking + `/ws/v1/realtime` transport carrying the existing move/snapshot messages); until then Hosted Play stays an honest local lobby with AI seats.
- Marking a defective daily as excluded from ranking (the flag is honoured but never set).

## Runtime options

The StarHermit runtime's Options (F1, or Settings › *Open Options*) own sound (volumes, mute, voice limit), graphics (level, render scale, frame-rate limit and readout), language, controls (keys and pads), accessibility (reduced motion, high contrast, text and interface size, vibration), account and reporting; the browser build's shared panels (game-options.js, sh-language.js, ui-scale.js, browser-guard.js) are gone.
