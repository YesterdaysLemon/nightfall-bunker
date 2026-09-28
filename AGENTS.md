<!-- al-stack:project:start -->
## Al-stack project

Project: nightfall-bunker. Profile: web. Status: experimental.

Co-op round-based zombie survival FPS in Three.js (up to 4 players) with edge-placed Cloudflare Durable Object lobbies; site deployed via Deploy Manager at zombies.alirezaafshan.com

`al-stack.toml` records this project's setup and dependencies. Work from the checkout selected for the task; other branches/worktrees are optional history. Use `al-stack register .` once when starting work here. Local registration does not change the project's lifecycle.

Project commands:
- dev: `npm run dev`
- test: `npm test`
- check: `npm run check`
- build: `npm run build`
- worker: `npm run build:worker`
- start: `npm start`

Edit project guidance outside this managed section. Use `al-stack configure` for its fields and `al-stack check .` for setup checks. Run the actual project checks for behavioral validation.
<!-- al-stack:project:end -->

# Nightfall Bunker

Round-based co-op zombie survival FPS (1–4 players) in Three.js, a homage to
the classic first "zombies" map: a boarded-up airfield bunker at night, chalk
wall-buys, a mystery box, debris to clear, and rounds tallied in red chalk.
Keep it an original homage: no Call of Duty names, logos, audio or map names.
Real WWII weapon names are fine; the wonder weapons are the original Arc Pistol
and Leyden Rifle.

## Layout

`docs/EXTENDING.md` has the recipes for adding an enemy, gun, power-up,
encounter, setting or map, and for re-theming. Content is data in registries,
and the tests check each registry is complete.

- `src/shared/` — the runtime-agnostic game core, used by the browser, the Worker and Node:
  - `sim.js`: the authoritative rules. Special content plugs in as encounters (hooks listed at its top).
  - `encounters/`: `hounds.js` (hound rounds) and `kintsugi.js` (the easter egg and boss).
  - `enemies.js`: per-class data (hit volumes, speeds, melee, AI, look).
  - `weapons.js`: each gun's price, box weight, grip, reload and projectile.
  - `powerups.js`.
  - `map.js`: the bunker's level data, also as one `BUNKER` object in `MAPS`.
  - `world.js`: AABB collision, raycasts, data-driven hit volumes.
  - `nav.js`: a two-level grid and flow field.
  - Rules, world and nav all take a map. Also `rounds.js`, `rng.js` (the one
    seeded generator), `wire.js` and `protocol.js`.
- `src/net/rooms.js` — transport-agnostic `MatchRoom` / `PartyRoom`.
- `src/client/` — renderer and UI. Everything visual and audible is procedural
  (`render/textures.js`, `render/weapons3d.js`, `render/chalk.js`, `audio.js`).
  - `game.js`: routes server events to handler groups in `events.js`.
  - `enemy-looks.js`: each enemy family's sounds and effects.
  - `text.js`: the words players read.
  - `settings.js` / `settings-ui.js`: settings, key bindings and the settings sheet.
- `worker/index.js` — Cloudflare Worker + Durable Objects (`Party`, `Match`,
  `Beacon`, `Directory`) serving `/net/*` on the game hostname.
- `server/index.mjs` — VPS container: static `dist/`, `/healthz`, and an
  in-memory single-region copy of the `/net` API (dev + fallback origin).

## Special rounds and secrets

- **Hound rounds.** The first comes at round 5–7, then every 4–5 rounds. They
  use a separate RNG stream (`houndRng`), so zombie randomness never shifts.
  - Fog rolls in and the bulbs dim.
  - Hounds warp in on a lightning strike on the target player's floor, in an
    unlocked zone 4.5–10 m from a player, with at most 2 + 2 × players alive at
    once.
  - They bite for 25, die in a few shots, and burst into flame.
  - They are drawn at `HOUND_SCALE` (1.3, `enemies.js`) times the model. Their hit
    volumes (skull, snout, ears, body, legs) scale with it and are padded to be
    forgiving; a test keeps every vertex of the standing model inside them.
    Aim assist, splash and the spawn and death effects use `HOUND_MID`.
  - The last hound always drops a Max Ammo, and random drops are off for the round.
- **Kintsugi easter egg.** Break three gold-mended teacups (`EGG.cups` in
  `map.js`): by the radio, on the loft desk, and on a courtyard post seen
  through the east window. Then touch the glowing figurine on the help-room
  cabinet.
  - She is the porcelain boss (`ZC.KINTSUGI`): slow while any player looks at
    her, fast when nobody does.
  - She shatters and re-forms behind a player every 8–13 s, and at each 25%
    health stage.
  - She is invulnerable while shattered, immune to insta-kill and nukes, and
    takes half splash damage.
  - Killing her drops Gold Leaf: the Arc Pistol for the grabber, and +1000
    points and full grenades for everyone.
- Enemy classes and states live in `protocol.js` (`ZC`, `ZS`), and their data in
  `enemies.js`. Client renderers: `render/hounds.js`, `render/kintsugi.js`,
  and `render/egg.js` for the props.

## Guns

- **Leyden Rifle** (`leyden`, box only): chain lightning (`chain` in `weapons.js`).
  - The bolt hits the enemy nearest the aim line (the client forgives aim by
    `chain.aim`). Then it forks: each hop leaves from whichever struck enemy is
    nearest a fresh one it can see within `reach`, for up to `hops` enemies.
  - Hops land `delay` s apart (`GameSim.arcs`). It kills anything but a boss,
    which takes `bossDamage`. Kills are `KILL.SHOCK`: the body fries, then drops.
  - The `chain` event carries the whole path. Three jars hold three shots and go
    dark as they are spent; reloading swaps the jar rack and cranks it up.
- **Animation:** `render/reloads.js` holds every reload style and after-shot cycle
  as keyframes over progress, played by `render/viewmodel.js`.
  - Styles: mag, pistol, stripper-clip bolt, shell-by-shell pump, break action,
    rocket and jar.
  - Both hands leave the gun, cases eject, recoil is a spring, and an empty
    pistol locks its slide.
  - `game.js` plays the style's sound cues. `tests/reloads.test.js` checks every
    gun has a style.
- **Dev builds and `?test`:** `?give=<gun id>` (e.g. `?give=leyden`) hands you that
  gun when a solo game starts.

## Settings and accessibility

- The settings sheet opens from the menu and the pause menu. It docks right so
  the game shows behind it, and changes apply live. Its tabs:
  - **Video:** TV effect strength 0–100, where 0 is off and a weaker effect
    also renders more lines; brightness; field of view; graphics quality.
  - **Audio:** master and music volume, 3D audio, sound captions.
  - **Controls:** sensitivity, invert, toggle aim/sprint/crouch, and key
    rebinding (`Input.setBindings` maps physical keys onto the codes the game checks).
  - **Accessibility:**
    - text and HUD size (rem-based, `--ui`)
    - high-contrast HUD
    - crosshair size, colour and dot
    - reduce flashing (softer lightning, explosions, white-outs and bulb flicker; no hound warp flicker)
    - reduce motion (no shake or bob, less sway)
    - sound captions with direction arrows
  - **Touch:** touch-device options.
- Reduce flashing and reduce motion default on when the OS asks for reduced motion.
- Settings are stored in `nb_settings`. The old `retro` on/off migrates to `crt`.

## Netcode decisions

- Server-authoritative zombies, points, purchases and health at 20 Hz; clients
  own their movement (speed-clamped) and claim hits, validated for range, rate
  and weapon ownership. Snapshots are compact JSON with events piggybacked.
- Solo runs the real `MatchRoom` in the page (no server needed).
- Lobby placement: each player times round trips to a Durable Object beacon
  pinned in every location hint; on start the party creates the match object
  with the `locationHint` that minimises the worst player's latency.
  - Probing (`probeRegions`, `src/client/net.js`) makes a quick parallel pass,
    then re-measures the closest three one at a time.
  - Neighbouring beacons can sit only 10–20 ms apart, and parallel probes jitter
    by more than that (`tests/probe.test.js`).
  - `REGIONS` lists only hints where Durable Objects run. Cloudflare has none in
    South America, Africa or the Middle East, so `sam`, `afr` and `me` spawned
    elsewhere (South America lands in Eastern North America) and showed the wrong
    place; they were removed.

## Commands

- `npm run dev` — Vite on :5173; `/net` proxies to `npm start` (:8080), or to
  `wrangler dev` with `NB_NET=http://127.0.0.1:8787`.
- `npm test` — node:test suites (sim rules, collision, nav, rooms over the
  Node server). `NB_EDGE_URL=<url> node --test tests/edge.test.js` checks the
  Worker (local `wrangler dev --persist-to "$LOCALAPPDATA/nbw"`; the long
  scratch path breaks workerd's SQLite otherwise).
- `npm run build && npm run smoke` — headless, muted Chromium plays round 1 and
  writes screenshots to `output/smoke/`. Use this (or `?mute&test` in a browser)
  instead of driving someone's visible browser.
- `npm run touch-smoke` — headless phone (844x390, multi-touch via CDP): stick,
  look, both thumbs, fire, context buy, auto-fire + aim assist, portrait prompt.
  Touch controls live in `src/client/touch.js` and feed the shared `Input`.
- `npm run ios-smoke` — WebKit (Safari engine) as an iPhone: install tip, web
  app manifest + icons, canvas fits the visible height (dvh), touch controls.
  iPhone Safari cannot fullscreen a page; Add to Home Screen (manifest
  `display: fullscreen`) is the fullscreen path. `npm run icons` redraws icons.
- `npm run hounds-smoke` — headless, muted: forces a hound round (fog,
  lightning, hounds, the Max Ammo drop). Then it plays the Kintsugi easter egg
  end to end: aimed shots break the three teacups, the figurine wakes her, and
  she shatters, re-forms and dies, dropping the Gold Leaf. Screenshots go to
  `output/hounds/`. It drives the in-page sim through `window.__game.conn.room.sim`
  (`?test` only).
- `npm run audio-check` — silent: renders the audio engine offline and asserts
  direction (HRTF), distance falloff, wall occlusion and moving zombie voices.
- `node scripts/guns-smoke.mjs [--only kar98k,leyden]` (after a build) — headless,
  muted:
  - a contact sheet of every gun's reload, frozen at eight points
    (`output/guns/reloads.png`)
  - the Leyden Rifle firing down a row of zombies: the chain must kill them all
    and a spent jar must go dark.
- `node scripts/mp-smoke.mjs --url <site>` — two headless browsers create and
  join a lobby, start a match and check they see each other (works on prod).
- `npm run build:worker` — bundles the Worker to `dist-worker/index.js`.

## The 1997 look (current art direction)

- The owner chose the Polygon Ghoul (late-90s console) direction for the whole
  game. `art/STYLE.md` is the world bible: sharp faceted low-poly, painted-light
  texture pages, shared palette ramps, and the export format. Every new
  character or prop follows it.
- **Characters** are exported from Blender as `public/models/<id>.json` + `.png`
  (+ optional `_glow.png`). They are loaded at boot by
  `src/client/render/models.js` (`loadModels`, `buildJoints`). Missing models
  fall back to the procedural art.
  - The horde (`zombies.js`, one instanced batch per model): `ghoul` (`z_ps1c.py`)
    plus three that each borrow something the owner liked.
    - `mended` (`z_mended.py`): a mechanic with Kintsugi's gold-mended porcelain.
    - `stoker` (`z_stoker.py`): an ember-cracked brute.
    - `gasser` (`z_gasser.py`): a gas-mask runner in the Rotted style's green.
    - `render/zombie-models.js` weights each per class (Mended mostly walk,
      Stoker jog, Gasser run). The pick comes from the zombie's id, so it is
      cosmetic and every client agrees.
    - Glow pages light the seams, embers and eyes. Model meta names the parts
      that go with the head on a headshot.
  - `hound`: `z_hound.py`, used by `hounds.js`.
  - `kintsugi`: boss, figurine and teacup; `z_kintsugi.py`, used by `kintsugi.js` and `egg.js`.
- **Render** (`src/client/render/retro.js`, setting "1997 TV look", on by default):
  - The scene renders into a small target: 240, 300 or 360 lines by quality,
    shrinking under load.
  - The TV pass presents it: crisp rows with scanlines, soft columns and
    composite colour bleed, ACES tone mapping, a world colour grade, and 15-bit
    colour with an ordered dither.
  - World textures swap to quarter-size small-palette versions (blended when
    magnified, crisp when minified). Gun materials go flat-shaded.
  - Particle sizes follow the render height.

## Art direction (zombie style explorations)

- `art/zombies/` holds code-built Blender 5.2 models of the zombie in six styles:
  plush, toon, rot, ps1, ink and porcelain. `art/zombies/README.md` covers the
  pipeline. `kit.py` is the shared toolkit: skin-modifier bodies, sculpting by
  code, and baked cloth and soft-body sims. Each style is a `z_<id>.py` script.
- `node art/zombies/blend.mjs z_<id>.py --preview|--final` renders headless
  (Blender at `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`).
  Final runs queue for the GPU. Output lands in the git-ignored
  `output/art/zombies/<id>/`.
- `node art/zombies/concepts.mjs [id]` draws concept sheets with the Codex CLI
  image tool. The user's `creative-media` skill has the Codex and Blender notes.
- `node art/zombies/build-gallery.mjs [--record]` builds the "Zombie Lineup"
  gallery page, published as a claude.ai Artifact
  (https://claude.ai/artifact/QMNp8ZByC5QbjcUuiizqwt). The owner's verdicts and notes
  live in that artifact's db: `picks/<id>` and `mix/current`. Read them before the
  next design round.
  `--record` copies the hero renders into `art/zombies/renders/`.

## Model Workshop (the owner's model editor)

- A claude.ai Artifact (https://claude.ai/artifact/CrK7J1ghGBWK6jZQjZZW27) that
  loads `public/models/*` for Spore-style editing. Its five modes:
  - **Mold:** push/pull, swell, smooth, and scroll-to-size.
  - **Rig:** pose with the game's own animations, or move joints.
  - **Tris:** move vertices, delete triangles, or poke points.
  - **Parts:** snap on spikes, horns, fins, blobs, boxes and teeth.
  - **Paint:** texture notes, tints and page adjustments.
- Source: `art/lab/workshop.html` and `art/lab/editops.mjs` (the replayable edit
  engine, tested in `tests/editops.test.js`). `node art/lab/build-lab.mjs` builds
  `output/lab/`. Republish that page with the model files as supporting files.
- The owner's edits live in the artifact's db, one document per model:
  `labs/<id>` = `{ rev, ops, notes, tints, page }`. Treat the notes as art direction.
- **Baking.** `node art/lab/bake.mjs <id> <doc.json> --rev <tag>` replays a document's
  ops into the game model, exactly as the page previewed them.
  - It sets `meta.revs[id]` / `meta.rev` and records the ops in `art/lab/edits/`.
  - The page sets aside ops whose `rev` no longer matches the model (kept in
    `stale`, not applied).
  - Page adjustments are not baked yet, and tints are preview only.
- The ghoul and hound are at rev `lab1`, the owner's first sculpt. The hound's
  shared legs are now explicit `.L`/`.R` parts.

## Loading, caching and sessions

Measured on 2026-09-27 (cold start, this PC's GPU): the menu's first frames went from 3.2 s to 2.2 s.

- **Caching.** Models load as `/models/<file>?v=<content hash>`. The hashes come
  from the `virtual:model-versions` plugin in `vite.config.js`; dev builds load
  unversioned.
  - `server/index.mjs` caches versioned models and `/assets/` for a year, immutable.
  - Everything else revalidates, answering 304 when unchanged.
  - Cloudflare Tiered Cache (Smart topology) is on for the whole `alirezaafshan.com` zone.
  - Cloudflare does not cache JSON at the edge by default. A cache rule for
    `/models/*` would need the owner's OK, since it is a zone setting.
- **What the menu waits for.** Only the four horde models.
  - Hounds, the Kintsugi set and the survivor avatar load alongside and are
    swapped in by `Game.useModels`.
  - The hound and boss renderers are built lazily (`Zombies.drawer`), from the
    procedural fallback if one is needed before its model arrives.
- **Shader warm-up** (`Game.warmup`, `compileFor`). Shaders compile in parallel
  (`compileAsync`) before the first frame, for the render target the frames
  really draw into.
  - With the TV look on, that is the small offscreen target, and its shader
    variants differ from the screen's. Compiling for the screen used to double
    every compile.
  - There is no environment map: every material is Lambert, Phong or unlit. The
    PMREM it had cost half a second and did nothing.
- **Fonts** are self-hosted (`src/client/fonts/`, hashed into `/assets/`; licences
  in `public/fonts/`). The CSP allows only 'self'.
- **Leaving a match** (`Game.stop`) silences everything it started (`AudioEngine.silence`):
  - voices, ambience, the radio, boss music, and the heartbeat and muffle
  - the game-over timer

  At game over the world goes quiet behind the sting. `npm run smoke` checks
  that nothing leaks into the menu.
- **Multiplayer "errors."** The Durable Object analytics count a WebSocket ended
  by a player leaving as an error (`clientDisconnected`, 7–24 a day). The
  Worker itself reports none; this is normal.

## Deployment

- VPS routing: Caddy keeps one file per site. This site's is
  `/etc/caddy/sites/zombies.alirezaafshan.com.caddy`, imported by `/etc/caddy/Caddyfile`,
  with history in git at `/etc/caddy`. Edit only that file, then validate, commit and
  reload; never restore a whole-config backup.
- Site: Deploy Manager app `zombies` → `https://zombies.alirezaafshan.com`,
  repo `YesterdaysLemon/nightfall-bunker` (`main`), container port 8080,
  loopback 3290 (candidate 3291), health `/healthz` (reports the build SHA).
  Pushes to `main` run CI and then the signed Deploy Manager webhook.
- Edge: Worker `nightfall-edge` on route `zombies.alirezaafshan.com/net/*`
  (config in `wrangler.jsonc`). The site and the Worker share the protocol in
  `src/shared/protocol.js`: bump `PROTOCOL` when the wire format changes.
  - **CD.** Pushes to `main` deploy it right after the site is live
    (`.github/workflows/deploy.yml`, `wrangler deploy`). This happens only when
    `worker/`, `src/net/`, `src/shared/` or `wrangler.jsonc` changed, because an
    upload restarts every live lobby and match. A manual run with `deploy_worker`
    forces it.
  - **Credentials.** The secret `CLOUDFLARE_API_TOKEN` (owner-created) and the
    variable `CLOUDFLARE_ACCOUNT_ID`. Without them CI warns, and it fails if
    `PROTOCOL` changed.
  - **Verification.** CI then checks `/healthz` and `/net/health`, and runs
    `mp-smoke` against the live site.
  - **By hand** (no token): the Cloudflare connector, with the bundle inlined as
    checksummed chunks, because its sandbox can only reach the Cloudflare API.

## Acceptance

- `npm test` and `npm run check` pass; `npm run smoke` clears round 1 with no
  console errors.
- Live: `/healthz` SHA matches the deployed commit; `/net/health` answers from
  the edge; a two-browser lobby reaches a match.
