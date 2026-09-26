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
Real WWII weapon names are fine; the wonder weapon is the original Arc Pistol.

## Layout

- `src/shared/` — runtime-agnostic game core used by browser, Worker and Node:
  `map.js` (single source of level data), `world.js` (AABB collision, raycasts,
  hitboxes), `nav.js` (2-level grid + flow field), `sim.js` (authoritative
  rules), `weapons.js`, `protocol.js` (constants, region choice).
- `src/net/rooms.js` — transport-agnostic `MatchRoom` / `PartyRoom`.
- `src/client/` — renderer and UI. Everything visual/audio is procedural
  (`render/textures.js`, `render/weapons3d.js`, `render/chalk.js`, `audio.js`).
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
- Enemy classes and states live in `protocol.js` (`ZC`, `ZS`). Hounds use
  `houndHitTest` (yaw-aware). Client renderers: `render/hounds.js`,
  `render/kintsugi.js`, and `render/egg.js` for the props.

## Netcode decisions

- Server-authoritative zombies, points, purchases and health at 20 Hz; clients
  own their movement (speed-clamped) and claim hits, validated for range, rate
  and weapon ownership. Snapshots are compact JSON with events piggybacked.
- Solo runs the real `MatchRoom` in the page (no server needed).
- Lobby placement: each player times round trips to a Durable Object beacon
  pinned in every location hint; on start the party creates the match object
  with the `locationHint` that minimises the worst player's latency.

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
- `node scripts/mp-smoke.mjs --url <site>` — two headless browsers create and
  join a lobby, start a match and check they see each other (works on prod).
- `npm run build:worker` — bundles the Worker to `dist-worker/index.js`.

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

## Deployment

- Site: Deploy Manager app `zombies` → `https://zombies.alirezaafshan.com`,
  repo `YesterdaysLemon/nightfall-bunker` (`main`), container port 8080,
  loopback 3290 (candidate 3291), health `/healthz` (reports the build SHA).
  Pushes to `main` run CI and then the signed Deploy Manager webhook.
- Edge: Worker `nightfall-edge` on route `zombies.alirezaafshan.com/net/*`
  (config in `wrangler.jsonc`). No Cloudflare API token is stored for CI, so
  Worker releases are uploaded separately (the connected Cloudflare API tool or
  `wrangler deploy` with an authorised token); the site and Worker share the
  protocol in `src/shared/protocol.js` — bump `PROTOCOL` when it changes and
  deploy both.

## Acceptance

- `npm test` and `npm run check` pass; `npm run smoke` clears round 1 with no
  console errors.
- Live: `/healthz` SHA matches the deployed commit; `/net/health` answers from
  the edge; a two-browser lobby reaches a match.
