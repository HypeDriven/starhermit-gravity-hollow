# Gravity Hollow — Game Design Document (running spec)

Realtime collection arena: steer a hungry black **hollow** across a miniature night plaza, swallow anything smaller than you, dodge embers, outweigh rivals by a quarter to eat them, and bank the most **mass collected** before the clock runs out. This document describes the shipped game as it behaves today (present tense). Anything not yet built is confined to the final "Design intent not yet implemented" list.

## 1. Overview

| | |
|---|---|
| Pitch | Grow the hollow. Outscore the plaza. |
| Genre | Realtime collection arena (single-screen, timed, mass-based ranking) |
| Players | 1 human vs 0–7 deterministic AI rivals (`maxVoids` 8, `rules.js` `createMatch`) |
| Session | 45 s–5 min per match (content `durationSec`); Learn lessons end when the last step is performed |
| Platforms | Desktop and mobile browsers with WebGL; keyboard, mouse/touch drag, gamepad |
| Rendering | Three.js r160 (`vendor/three.module.js`, r160 addons under `vendor/three/addons/`, importmap in `index.html`) perspective scene with optional post-processing; all controls have DOM equivalents |
| Persistence | `localStorage` (`gravity-hollow:save:v1`, `:settings:v1`, `:replays:v1`) is the offline cache; hosted (launch token) mirrors the save document to the platform cloud slot |
| Host | `server.js` (static + `/api/v1/time` + authoritative `/ws` rooms), declared in `starhermit.txt` |

File map:

| Path | Role |
|---|---|
| `index.html` | DOM shell: canvas, 10 screens, HUD, tray, live regions; loads `src/main.js` |
| `styles.css` | Palette tokens, responsive HUD/tray/panels, reduced-motion, key-art rules |
| `src/rng.js` | mulberry32 stream (`RngStream`, serializable state), FNV-1a `hashString` |
| `src/rules.js` | Pure engine: `createMatch`, `queryActions`, `applyCommand`, `step` (30 Hz), scoring, `rankings`, `hashState` |
| `src/content.js` | Themes, 40 Journey stages, 8 challenges, 3 practice stages, 5 lessons, daily generator, validators |
| `src/session.js` | Fixed-step loop, replay envelope + `verifyReplay`, undo, save/settings persistence, achievements |
| `src/platform.js` | StarHermit layer: launch-token read/strip + refresh, account nickname, cloud-save mirror (stored zip), read-only leaderboard, sync status |
| `src/render.js` | Three.js scene: instanced props, void views, pooled particles, atmosphere, graphics settings (`setGraphics`/`graphicsInfo`), post chain, adaptive resolution, spring camera |
| `src/gfx.js` | Pure graphics quality model: presets, categories, `detectPreset`, `resolve`, `choosePreset`, `presetTier`, `describe` |
| `src/gfx-ui.js` | Settings → Graphics section builder and its localized strings (9 locales) |
| `vendor/three/addons/` | r160 EffectComposer, Render/Shader/Output/GTAO/UnrealBloom/SMAA passes, FXAA shader, RoomEnvironment (+ their imports) |
| `src/ui.js` | Screen manager, focus restoration, HUD, setup/results/help/settings builders, toasts, captions |
| `src/audio.js` | WebAudio buses, authored Opus one-shots + ambience beds with synth fallbacks, adaptive music |
| `src/main.js` | `App` state machine, input (keys/pointer/gamepad), `TutorialRun`, smoke autopilot, platform sign-in wiring |
| `server.js` | Node host: static files, time endpoint, WebSocket rooms with AI backfill and reconnect |
| `sfx/*.opus`, `sfx/manifest.txt` | 28 authored clips and the canonical event binding table (§9) |
| `assets/key-art.webp`, `assets/results-*.webp` | Title backdrop and results illustrations (§8) |
| `coverart.png`, `icon.png`, `favicon.svg` | Platform cover (1200×675), icon, tab icon |
| `tests/rules.test.mjs`, `tests/session.test.mjs`, `tests/gfx.test.mjs`, `tests/e2e.mjs` | `npm test` (155 assertions + 10 `node --test` graphics cases) and the Playwright playthrough |
| `starhermit.txt` | `name=Gravity Hollow`, `launch=index.html`, `server=server.js`, `cover=coverart.png` |

## 2. Vision and design pillars

1. **Appetite is the only stat.** Everything flows from mass: radius (`0.55·√mass`), speed (falls with the fourth root of mass), what you may eat (≤ half your mass), whether you may boost (mass > 14), whether a rival may eat you (they need 1.25× your mass). Rules in: a single number the player can read on the HUD and on every void label. Rules out: power-ups, hit points, upgrades, cosmetics that change hitboxes.
2. **Dimmer than you is dinner.** Legality is always visible on the pavement: edible props pulse bright, inedible ones sit at 42 % brightness, embers glow orange and never brighten, a protected void's ring blinks. Hints and tutorials use the same `queryActions` the input layer uses. Rules out: hidden thresholds, hover-only information, audio-only cues.
3. **The plaza is a diorama.** One authored 52° tilt camera, a tabletop-scale plaza with fountain, planters and arcade blocks, five themed palettes, instanced faceted props. Rules in: readable silhouettes (icosahedron crumb → dodecahedron boulder → octahedron gem → tetrahedron ember). Rules out: free camera, first-person, particle storms that hide props.
4. **Same seed, same match.** Every stage is data with a seed; the rules stream lives inside the state; replays re-simulate and compare hashes; the daily is immutable per UTC day. Rules out: `Math.random` in rules, wall-clock in the engine, client-claimed scores.
5. **Spending, not gifts.** Boost burns 0.25 mass per tick, embers take 3, dying keeps only 60 %. Growth is earned by lines through the plaza, not bursts. Rules out: free dashes, invulnerability pickups, rubber-banding for the AI.

## 3. Player experience

**Target player.** Someone who likes short arena rounds with a clear score, on a phone or a laptop, and wants a fair daily to compare with friends by hand.

**First 60 seconds.** Boot shows a progress bar (rules validation → clock sync → renderer). The title is one tap from play: *Play → Learn* is badged "start here" until all five lessons are done (`main.js` `showModes`). Lesson 1 ("Drift") starts with no countdown and a banner: *"You are a hollow — a small hungry void. Move with WASD, arrow keys, or drag on the plaza."* The step completes after 45 ticks of movement, then three yellow marker rings appear to visit. Each new mechanic (motes, chunk/boulder thresholds, embers, boost, rivals) gets its own lesson with a banner, a hint line and a *Skip lesson* button. Outside Learn, the Help overlay (title and pause menu) generates rule cards from the current key bindings.

**Session shape.** Title → mode → setup card (duration, rivals, boost rule, ranked flag, undo, objectives) → 3-2-1 countdown → 45–300 s of steering → results dialog with standings, score breakdown, objectives, replay hash → *Next* (next lesson / next Journey stage / home), *Retry*, *Home*.

**Emotional beat.** The moment a rival's label reads a quarter less than yours and their body brightens: the hunted becomes the hunter. The mirror beat — a bigger ring sliding into view — is the game's tension.

## 4. Core loop and rules contract (`src/rules.js`)

**Entities.** Arena is a square of half-size `arenaHalf` (26–50) with axis-aligned rectangular obstacles (`fountain`, `planter`, `arcade`). Props: `crumb` (mass 1), `chunk` (3), `boulder` (8), `gem` (15, flagged `gem`), `ember` (4, `hazard`, never edible). Voids: `{id, name, ai, x, y, vx, vy, mass, startMass, r, alive, respawnTicks, protectTicks, input, moveTicksUsed, boostsUsed, propMass, gemMass, rivalMass, gemsEaten, rivalsEaten, deaths, invalid}`. Void 0 is always the local player.

**Timebase.** `TICK_RATE = 30`; `step(state)` advances one tick. Phases: `countdown` (`countdownSec`, default 3; 0 in Learn) → `active` → `ended`.

**Commands** (`applyCommand`). `{id, voidId, seq, type:'move', dir:[dx,dy], boost}` or `{type:'noop'}`. Validation order: unknown void → `no_such_void`; same `id` as the last accepted → `{ok, deduped}`; unknown type → `unknown_command` (+1 invalid); non-finite or |component| > 100 → `dir_out_of_range` (+1 invalid); boost requested while `!canBoost` → boost dropped, `boostRejected`, +1 invalid; movement while `!canMove` during `active` → rejected with the `moveReason`, +1 invalid; during countdown intent is buffered silently. Accepted commands store intent only; the next tick consumes it.

**Legal-action query** (`queryActions`) returns `canMove/moveReason` (`countdown`, `not_active`, `respawning`, `move_limit`), `canBoost/boostReason` (`boost_disabled`, `boost_limit`, `too_light`), `edible[]` (props with mass ≤ 0.5·mass within reach + 8, rivals you outweigh by 1.25×), `hazards[]` (embers within reach + 4, bigger rivals within `r+r+6`), `moveTicksLeft`, `boostsLeft`. Hints (`main.js` `doHint`), the HUD and the tutorial all consume this.

**Resolution order per active tick.** (1) `aiThink` for AI voids: flee any void that can eat them within `r+10`, else retarget every `(1.6−skill)·15+5` ticks to the nearest edible prop (or rival if skill > 0.5), boost only while fleeing with mass > 28. (2) Movement in id order: dead voids count down `respawnTicks` and `respawn`; protection ticks decay; direction is clamped to magnitude 100; `speed = max(4.05, 9·(startMass/max(startMass,mass))^0.25)`; boost (×1.6) applies when intent.boost, mass > 14, boost rule allows, moving, and not move-limited — it drains 0.25 mass/tick to a floor of 14 and increments `boostsUsed` on each new burst; with `moveLimit` set, moving ticks are counted and further movement is zeroed (`move_limit` event); `collide` clamps to the rim and pushes out of obstacles along the shallower axis. (3) Prop consumption: an ember within `0.9·r` on an unprotected void takes 3 mass (floor 5) and grants a 0.5 s mercy window (`burn`); an edible prop within `r` is removed, mass added, `eat` or `eat_gem` emitted. (4) Void vs void, pairs in id order: if `a.mass > 1.25·b.mass`, `b` unprotected and distance < `0.95·a.r`, `a` gains `round(0.5·b.mass)` as `rivalMass`, `b` dies (`deaths++`, `respawnTicks = 3 s`, intent cleared), `eat_void`. (5) Goals for void 0: `mass`, `gems`, `score` (= mass collected), `rivals` progress and complete on reaching `target` (`goal` event); `survive` is evaluated at the end. (6) Every 12th tick `fillProps` refills to `propTarget` using `propWeights`, never inside a void's radius + clearance. (7) Terminal: `tick ≥ durationTicks` → `time_expired`; or with a `moveLimit`, the player alive and out of moves → `moves_exhausted`. Learn lessons end when `TutorialRun.advance` sets `lesson_complete` (`main.js`).

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

| Action | Keyboard (rebindable, `settings.bindings`) | Pointer / touch | Gamepad |
|---|---|---|---|
| Steer | W A S D / arrows (held; diagonals normalised) | drag anywhere on the canvas: direction from the player's projected screen position to the pointer, 24 px dead zone | left stick, 0.18 dead zone |
| Boost | Shift / Space | ⚡ tray button (hold, or toggle when *Hold-to-boost* is off) | A or RT |
| Pause / resume | Esc / P | ⏸ HUD button, *Resume* | Start |
| Undo (Practice) | Z | ↩ tray button | — |
| Hint | H | ? tray button | — |
| Camera reset | C | ◎ tray button | — |
| Rebind | Settings → *Keyboard bindings* → *rebind* → press a key (Esc cancels) | | |

**Input pipeline** (`main.js` `startRenderLoop`/`computeInput`): every animation frame while `matchFlow === 'playing'`, not paused and the tab is visible, the current intent is computed; a move command is submitted only when `dx/dy/boost` differ from `lastSent` (command ids are `local-<stage>-<seq>`). `beginMatch` resets `lastSent`, boost toggle and held state. Keys clear on window blur; pointer capture is released on `pointerup`/`pointercancel`/`lostpointercapture`.

**Locking.** During countdown intent is buffered, not rejected. Pause key is ignored while Settings/Help are open. `pauseMatch` is a no-op unless a match is running and not terminal; `resumeMatch` only acts from the pause screen. Rejected commands with a reason other than `not_active`/`cannot_move` are announced to the live region.

**Feedback per input.** Menu buttons: `ui_confirm`/`ui_back`. Steering: body squash along velocity, boost trail particles, `boost` whoosh on each burst. Eating: particle burst (mint for gems), `eat`/`eat_boulder`/`eat_gem`, haptics 8–15 ms. Burn: orange burst, shake 0.5, `burn`, haptic 25 ms. Being swallowed: `swallowed`, assertive announcement; swallowing: white burst, shake 1.0, `eat_void`, haptic 40 ms. Hint: `hint` + 4.2 s toast. Undo unavailable: `invalid` + toast.

## 7. Screens and UI flow (`src/ui.js`)

`boot → title → modes → setup → (HUD + countdown) → playing ↔ pause → results → title`, with `settings` and `help` as overlays that return focus to their opener (`overlay()/back()`), `journey` and `profile` reachable from the title, and `compat` shown when WebGL fails. `App.matchFlow` is `title | playing | results`. Backgrounding a solo match pauses it (`Session` visibility handler) and the pause screen shows "Paused because the tab was hidden" plus an away summary.

**Desktop (≥ 1024 px).** HUD: left rail (stage name, objectives), centre (timer, live standings), right rail (mass/collected, moves/boosts left, ⏸). Panels max 560 px (780 px wide variants), 70ch line length. Tray centred at the bottom.

**Large screens (> 1600×1000).** The shared `ui-scale.js` sets `--ui-scale` (`min(w/1600, h/1000)`, capped at 2.5; exactly 1 at 1600×1000 and below) and every DOM layer over the unzoomed full-viewport canvas — screens/panels, HUD, tray, tutorial banner, countdown, toasts, captions, fps meter and void labels — is CSS-zoomed by it, so the 3840×2160 layout is the ~1778×1000 layout magnified; vw/vh lengths inside are divided by the scale and void-label positions are divided by `UIScale.value`.

**Lesson banner.** Sits 8 px below whichever HUD cards it horizontally overlaps (`ui.placeTutorialBanner`, re-run with each HUD update), so it never covers the timer, standings, rails or ⏸; in portrait it spans the width between the safe-area gutters. The mode-select panel takes its full max width so mode and challenge cards lay out two per row.

**Compact / tablet (< 1024 px).** Rails widen to 38 vw; the live standings strip is hidden.

**Portrait mobile (≤ 700 px).** Timer row first and centred, objective rail below-left, score rail right; panels 96 vw; mode cards two per row; Journey grid five per row; tray in the bottom thumb zone above `safe-area-inset-bottom`; left-handed setting docks it left.

**Landscape mobile (height ≤ 500 px).** HUD becomes a 200 px column on the left; tray becomes a vertical column on the right with 48 px buttons; panels 94 vh; title and results illustrations are hidden below 560 px height.

**Never cut off.** Play button, timer, ⏸, ⚡, results *Next/Retry/Home*. All screens scroll (`overflow-y: auto`) and pad by `env(safe-area-inset-*)`.

## 8. Art direction

**Palette (styles.css tokens).** `--bg #0b100d`, `--panel rgba(16,24,20,.92)`, `--panel-border #2c5240`, `--text #e8f0ea`, `--dim #9db3a6`, `--accent #9fe6a0`, `--accent-2 #64f2c0`, `--danger #ff7a5c`, `--focus #ffe066`; primary buttons `#2c6b45 → #1f4d33`; high contrast swaps to `#00ff88` on `rgba(0,0,0,.96)`. Theme palettes (`content.js` `THEMES`): Verdant Court sky `#0c1a12`, ground `#1c3327`, lines `#2c5240`, accent `#9fe6a0`, gem `#64f2c0`, ember `#ff7a3c`; Ember Arcade `#1d0f0a / #33201a / accent #ffb25e / gem #64d8f2`; Tideglass Promenade `#0a1420 / #16283a / accent #7ee0e6 / gem #f2e664`; Dusk Bazaar `#160f22 / #251a38 / accent #e69fd8 / gem #9ff264`; Frost Meridian `#0d141c / #1e2c38 / accent #a0d8f2 / gem #f2b064`. Rival ring colours come from `hashColor` with default and deuteranopia/protanopia/tritanopia sets; the player's ring is white.

**Hero.** The player's hollow: a clear-coated jet-black flattened sphere (`MeshPhysicalMaterial`, y-scale 0.72) with a white base ring and a dim inner disc, sitting on a hand-laid pavement texture (`groundTexture`, seeded wobble per theme). Key art (`assets/key-art.webp`) and the cover render the same subject: a marble-sized black sphere with a glowing white ring on a mossy green diorama plaza with a mint fountain.

**Shape language.** Faceted props by kind (icosahedron, larger icosahedron, dodecahedron, spinning octahedron gem, spinning tetrahedron ember); rounded planters with icosahedron bushes; cylinder fountain with an emissive accent pool; rim boxes around the plaza.

**Typography.** `system-ui` stack; logo `clamp(2rem, 6vw, 3.2rem)` in an accent gradient; tabular numerals on timer, standings and breakdown; 20 px base with *Larger text*.

**Lighting and camera.** ACES tone mapping, exposure 1.18, sRGB output; hemisphere fill + ambient + one warm directional key at (30, 55, 18) whose PCF-soft shadow frustum is fitted to the plaza plus rim (`arenaHalf + 6`); fog from 90 to 260 units. With *Detail* on, a PMREM `RoomEnvironment` is the scene environment so the clear-coated hollow, gems and fountain water pick up reflections. Camera fov 38, tilt 52°, distance `max(46, 1.55·arenaHalf)`, trails the player by 22 % through a critically damped spring (k 42, c 12), shake amplitude 0.35 decaying at 6/s.

**Motion.** Gems bob (±0.18) and spin; embers flicker; edible props pulse 0.85–1.0; protected rings blink at 10 Hz; boost trail every third frame; particle bursts are event-tiered (6 crumb, 14 gem, 12 burn, 26 goal, 30 rival). Reduced motion (setting or `prefers-reduced-motion`) disables particles, trails and shake and freezes motes, swirls and water shimmer; CSS animations collapse to 10 ms.

**Graphics.** *Detail* (detailed) adds a 1024² running-bond slab pavement with per-slab tone variation, grit, moss in the joints and a matching bump map; faceted clear-coated props; cut-glass gems; hot emissive embers; hedges built from leafy mounds; a stone lip, spout column and bowl on the fountain; masonry caps on arcade blocks; an accent light strip on the rim's inner lip; and per-hollow contact shadows. *Atmosphere* adds drifting light motes over the plaza, a slowly turning accretion swirl around each hollow (faster while boosting, tinted by ownership colour) and a shimmer on fountain water; all of it holds still under reduced motion. Particles use a soft additive sprite. Optional post-processing (`EffectComposer`): GTAO contact darkening, bloom on linear HDR with a threshold (2.0) above lit surfaces so only embers, gems and the player's white ring glow (their emissive runs hotter only while bloom is active), tone mapping via `OutputPass`, a colour grade (gentle S-curve, +10 % saturation, cool shadows / warm highlights, lifted blacks) with vignette, and FXAA or SMAA; MSAA renders into a 4-sample target. The composer only runs when a post effect is on, so Low renders directly as before.

The Settings panel's **Graphics** section (`gfx-ui.js`) offers Quality — *Auto (detected: <tier>)*, Low, Balanced, High, Ultra — where Auto comes from the unmasked WebGL renderer string (SwiftShader/llvmpipe → Low, discrete GPUs and Apple M → High, else Balanced; phones and tablets never above Balanced); a render scale slider (50–200 % of the preset's scale); one select per category, each defaulting to "From preset (<tier>)": shadows off/low/medium/high (1024²/2048²/4096²), ambient occlusion off/on/high, bloom, colour grade, anti-aliasing off/FXAA/SMAA/MSAA, particles off/low/high (0/400/1200 pool), detail plain/detailed, atmosphere off/on; *Adaptive resolution* (default on: averages 90 frames, steps the scale down 0.1 to a floor of 0.6 above 26 ms and back up 0.05 below 14 ms); *Show frame rate* (a bottom-left readout above the tray, never over controls); and a summary line "GPU · cost · W×H px". Presets: Low = DPR cap 1, nothing optional (canvas MSAA only); Balanced = DPR cap 1.5, 1024² shadows, bloom, grade, FXAA, 400 particles, detailed, atmosphere; High = DPR cap 2, 2048² shadows, AO, SMAA, 1200 particles; Ultra = 4096² shadows, full AO, MSAA, 125 % scale. Choosing a preset clears overrides; every change applies live (shadow maps and materials recompile, the post chain rebuilds, detail/particle changes rebuild the scene) and is saved in `settings.graphics` with the other settings (legacy `quality` values migrate). Canvas MSAA follows the anti-aliasing setting in force at start-up. If the post chain cannot be built the game renders without it and the panel says so. `body` and the canvas carry `data-gfx-preset` and `data-gfx-post`.

**Visual assets the design calls for.** Title key art (shipped), results win and defeat illustrations (shipped), cover art derived from the key art (shipped), procedural everything else; no TRELLIS model (the hero is a primitive sphere by design) and no character animation (no humanoid).

## 9. Audio direction (`src/audio.js`)

**Mix.** Four gain buses — music 0.7, effects 0.9, ambience 0.5, voice 0.8 — under a master that mutes as a whole. The AudioContext is created on the first pointer/key gesture. Authored Opus clips are fetched lazily on first use and cached; until decoded (or if a fetch fails) the synthesized fallback for the same event plays, so every cue exists offline. Countdown, go, fanfares, warnings and lesson chords sit on the voice bus so they can be levelled separately from impacts. Music is a procedural plucked pentatonic pattern per theme (260 ms grid) whose density rises from 0.3 to 0.9 across the match. Ambience is a looping authored bed per theme on the ambience bus (gain 0.6), replaced by filtered noise while the bed is loading. Captions (`#captions`) mirror meaningful cues when enabled.

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

The shipped build is **English only**: every string is inline in `index.html`, `src/ui.js`, `src/main.js` and `src/content.js` (lesson text, mode cards, help cards, goal text, results headlines). The exceptions are the StarHermit account strings (`platform-i18n.js`) and the Settings → Graphics section, whose strings (`gfx-ui.js`) exist in en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT and are picked from `navigator.languages`; there is no language selector. Layout already tolerates ~30 % expansion (panels scroll, buttons wrap, `.title-row` buttons flex with a 96 px minimum, HUD rails cap at 30–38 vw). The nine target locales (en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT) are listed under *Design intent not yet implemented*.

## 11. Accessibility

- **Keyboard-only path.** Every screen's first control is focused on show; `[data-back]`, Esc on overlays, and the pause/undo/hint/camera bindings cover the whole loop; Tab order follows DOM order; focus returns to the overlay opener and never lands in a hidden screen (`restoreFocus`). Focus ring: 3 px `#ffe066` with 2 px offset.
- **Live regions.** `#sr-live` (polite) receives toasts, hints, "Gem consumed", rejections; `#sr-assertive` receives stage start, "Go!", being swallowed, results headline + total. `#hud-objective` is `role=status`; the timer is `role=timer` with `aria-live=off`. Countdown is `aria-live=assertive`. Pause, results, settings and help are `role=dialog aria-modal`.
- **Captions** for audio cues (toggle, default on) and a *Voice cues* slider.
- **Colour.** Ownership is ring colour + label + shape; palettes for deuteranopia, protanopia and tritanopia; high-contrast theme; embers differ from props by shape (tetrahedron) and flicker, not just orange.
- **Motion.** Reduced-motion setting or media query removes particles, trails and camera shake; layout transitions collapse.
- **Targets.** Buttons ≥ 44 × 44 px; tray buttons 64 px (48 px in landscape mobile) with 12 px gaps; range inputs 110 px wide.
- **Options.** Larger text, left-handed tray, hold-vs-toggle boost, timing assistance flag, haptics toggle, key rebinding, replay tutorial, WebGL compatibility notice preserving progress.

## 12. StarHermit integration

All platform traffic goes through the shared client `starhermit-sdk.js` (loaded by `index.html` before the modules); `src/platform.js` wraps it and `connectPlatform()` calls `StarHermit.init()` at boot. Without a launch token the game makes no network request.

| Platform feature | Status in this build |
|---|---|
| Distribution manifest (`starhermit.txt`: `name`, `launch`, `owner`, `server`, `version`, `cover`, one `control.<action>` line per keyboard action) | used |
| Launch token | used when hosted — the SDK reads `#game_token=<jwt>[&session_id=]` (library launch) or `#access_token=<jwt>` (sign-in return), strips it, takes `sub` / `game_scope`, sends Bearer on every same-origin call and renews the token. If renewal is refused the game toasts that progress keeps saving on this device, drops to local play and re-offers sign-in |
| Sign-in | **Sign in with StarHermit** on the title, shown only on `<slug>.starhermit.com` without a token |
| Identity / profile | used when hosted — profile nickname (`Player <id>` fallback, never `/api/v1/me`) as the profile name on the title, profile and results boards; the local free-text name is the offline fallback (`main.js` `signIn`, `ui.js` `buildProfile`) |
| Invite link | **Invite a friend** on the title when signed in copies the SDK share link with a toast |
| Cloud saves | used when hosted — the save document mirrors to slot `game:<slug>` (`/api/v1/me/cloud-saves/game:<slug>`): slot info checked at boot, remote-preferred load, an empty slot is seeded from local, ~2 s debounce + `pagehide`/hidden flush, sync status on title/profile; localStorage stays the offline cache |
| Settings KV | used when hosted — volumes, mute, graphics, reduced motion, high contrast, larger text, palette, left-handed, hold-to-boost, timing assist, haptics, camera sway and captions are patched when Settings change; platform values win at boot |
| Controls | keydown is routed by `KeyboardEvent.code` through `settings.bindings`, which signed in come from `StarHermit.loadBindings` (platform rebinding wins); Settings → *Keyboard bindings* shows them and a rebind is saved with `PUT /controls` |
| Leaderboards | read-only when hosted — `GET /api/v1/games/{slug}` → `leaderboardId`, then the board's entries (nicknames resolved) on the Daily setup card; solo scores are never submitted, daily/challenge records stay local |
| Server time | not used — daily boundaries use the local UTC clock |
| Server script (`server=server.js`) | shipped as a Node host (static files, `/api/v1/time`, local rooms on `/ws`), not a Jint game script |
| Platform achievements | not used — the 7 achievements are local and part of the cloud-saved document; no script-owned unlock path |
| Sessions, matchmaking, platform invites, chat, voice, realtime rooms, replays | not used — Hosted Play is an honest local lobby with AI seats; no `WebSocket` is opened by shipped client code |

Account-surface strings (sign-in, invite, toasts, sign-out notice) are localized in all nine locales (`src/platform-i18n.js`). Conventions followed from the platform wiki: same-origin `/api` paths, no credentials in local storage, launch token read once and stripped, nickname (never username) from the profile route, cloud slot `game:<slug>`.

## 13. Technical architecture

- **Ownership.** `Session` owns the rules state; only `Rules.applyCommand` mutates intent and only `Rules.step` advances. `Renderer.syncSnapshot(prev, curr, alpha, events)` reads snapshots and never writes. `UI` holds no simulation state.
- **Loop.** `Session.start` accumulates rAF delta (clamped to 250 ms) and steps at 30 Hz with an 8-step spiral guard; `App.startRenderLoop` polls input, submits intent changes, syncs the renderer and renders every frame; the DOM HUD refreshes every 12th frame.
- **Determinism and replay.** Replay envelope: `{schema 1, build '1.0.0', contentVersion, seed, stageId, initialHash, startedAt, commands [[step, seq, dx, dy, boost]], hashes every 60 steps, result {reason, finalHash, rankings}}`. `verifyReplay` re-creates the match, replays commands by step and compares intermediate and final hashes; the results screen shows "Replay verified · <hash>" or the mismatch reason. The last 8 replays are kept in `localStorage`.
- **Persistence.** Save, settings and replays are `{v:1, data, checksum}` documents; a bad checksum or corrupt JSON falls back to defaults without throwing.
- **Content validation.** `validateAll` runs at boot (warnings only) and in tests: identity, duration ≤ 900 s, arena 20–60, known theme, gem-goal reachability, obstacle axis blocking, ≤ 7 rivals.
- **Renderer budgets.** Props are 5 `InstancedMesh` draws (capacity `propTarget + 40`); one `Points` particle pool; per-void 3 meshes (+ contact shadow and swirl with detail); one `Points` draw for atmosphere motes; scene disposal on stage change and detail/particle change; context loss/restore rebuilds. `?smoke` logs `SMOKE_OK` with draw calls and triangles at tick 300 and `SMOKE_END` at the end.
- **Server.** `startMatch` re-keys clients by void id; `cleanup` hands abandoned voids to AI and records a reconnect token; a started room survives its last human until the match ends.
- **How the e2e drives the UI.** `tests/e2e.mjs` serves the folder on `PORT` (or an ephemeral port) with mocked StarHermit `/api` routes, and in headless Chrome clicks real buttons: settings, Graphics (Auto → Low on the software GPU, Ultra, High, a bloom override, frame-rate toggle, reload persistence, back to Auto clearing overrides), help, journey grid, Practice relaxed (keyboard steering with Shift boost, hint, undo, pause/resume/leave) and the full 45 s Sprint Hollow match to the results dialog, at 1280×800 and 390×844 with touch; those passes must make no `/api` request. A signed-in pass (390×844, `#game_token=`) checks the token left the URL, the nickname, the synced music volume, sign-in hidden, Invite a friend copying the share link, Settings showing a platform key binding and saving a rebind (`PUT /controls`), and the `game:<slug>` save PUT. `npm test` also runs `tests/platform.test.mjs` (adapter on the real SDK with a stubbed fetch: token read, nickname, `game:<slug>` round-trip, settings/bindings apply and sync, sign-out, zero requests standalone).

## 14. Testing and acceptance criteria

`npm test` = `tests/rules.test.mjs` (150 assertions) + `tests/session.test.mjs` (5) + `tests/gfx.test.mjs` (10 `node --test` cases: GPU detection incl. mobile cap, resolve with presets/overrides/scale clamp, preset clears overrides, summary, legacy migration, panel locales): creation/serialization round-trip, deterministic replay (identical hash streams and rng state), seed divergence, legal actions and every invalid reason, consumption thresholds and growth, ember shrink and mercy, void-eats-void and respawn, terminal state and rankings, tie-break order, obstacle containment, malformed-command fuzz (no NaN, no hang), content validators over all stages, golden Journey sessions with real AI, snapshot-resume mid-match, replay verification and tamper detection, replay verification with a recorded rejected command. `npm run test:e2e` must print `E2E PASS` with zero page errors and zero console errors or warnings.

QA bar as checkable statements: (1) a new player sees instructions within the first lesson banner and every later mechanic has a lesson and a help card; (2) every mode card, setting, tray button and results button is reachable and functional in the browser; (3) no console errors on boot, during play, or on results (the e2e fails on any); (4) at 1280×800, 390×844 portrait and ≤ 500 px-high landscape no HUD element, tray button, panel button or text is clipped; (5) all match results are produced by the rules engine, never by the UI.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 63 KB) | title backdrop | FLUX.2 klein, seed 9501, 1536×864 → webp q82 | generated in this pass, wired |
| `assets/results-win.webp` (1024×576, 42 KB) | results illustration, 1st place / lesson complete | FLUX.2 klein, seed 9502 | generated in this pass, wired |
| `assets/results-defeat.webp` (1024×576, 20 KB) | results illustration, not 1st | FLUX.2 klein, seed 9503 | generated in this pass, wired |
| `coverart.png` (1200×675, 329 KB) | platform cover | key art + title/tagline typeset with ffmpeg drawtext, 256-colour PNG | replaced in this pass (previous file was a generic placeholder) |
| `icon.png` (256×256), `favicon.svg` | platform icon, tab icon | hand-authored SVG/PNG | shipped |
| `sfx/*.opus` — 18 original clips | events in §9 | MOSS-SoundEffect v2.0 | shipped |
| `sfx/clock-warning`, `move-limit-stop`, `eat-boulder`, `lesson-complete`, `swallowed` (.opus) | new one-shots in §9 | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired with synth fallbacks |
| `sfx/amb-garden`, `amb-forge`, `amb-shore`, `amb-market`, `amb-tundra` (.opus, 8 s) | theme ambience beds | MOSS-SoundEffect v2.0, 100 steps | generated in this pass, wired (loop on ambience bus, noise fallback) |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | canonical binding table / generator entries / generated summary | — | shipped |
| Ground, props, voids, obstacles, particles | all in-game geometry and textures | procedural (`render.js`) | shipped |
| 3D hero model, character animation | — | — | not required by the design |

## 16. Known limitations

- Command de-duplication remembers only the previous command id per void (`rules.js` `applyCommand`), so an older id replayed after a different command is re-applied; harmless because a move only sets intent.
- The client's Hosted Play is a local lobby with AI seats; server.js's `/ws` rooms are exercised only by external probes. Platform realtime rooms (host-routed) are future work.
- Daily and challenge results are stored locally; there is no shared board, and `dailyExcluded` is read from the save but never written by any code path.
- The title's "Journey n / 40" and "stages cleared" count any stage with a record, including 0-star attempts; `journey_20` correctly requires stars.
- English only (see §10).
- `#hud-objective` is a polite live region re-rendered at ~5 Hz; screen readers may re-announce the stage name during play.
- Ambience beds decode after the first gesture, so the first seconds of the first match on a theme use the filtered-noise fallback, and the bed starts when decoding finishes.
- Headless Chrome blocks the AudioContext before a gesture, so audio is not covered by the e2e beyond the absence of errors.
- The AI does not use obstacles or boost tactically; skill only changes retarget cadence and rival hunting.

## Design intent not yet implemented

- Localization into en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT with a string table and language selection from the platform profile or `navigator.language`.
- Platform realtime rooms for Hosted Play (host-routed: rooms API lobby/matchmaking + `/ws/v1/realtime` transport carrying the existing move/snapshot messages); until then Hosted Play stays an honest local lobby with AI seats.
- Score submission to the platform leaderboard (read-only board today; solo scores stay client-simulated and locally recorded).
- Marking a defective daily as excluded from ranking (the flag is honoured but never set).

## Browser interference

`browser-guard.js` (loaded from `index.html`) suppresses browser UI that gets in the way of play: the right-click context menu, the iOS long-press callout, copy / cut / paste, and page text selection. Text fields (inputs, textareas, selects, contenteditable) keep normal selection, context menu and clipboard behaviour.
