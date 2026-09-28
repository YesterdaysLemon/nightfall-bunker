# Extending Nightfall Bunker

How to add content without touching the engine, and what the tests check for
you. Shared code (`src/shared/`) runs in the browser (solo), the Node server and
the Cloudflare Worker, so keep it plain JavaScript with no DOM or Three.js.
After changing shared rules, run `npm test`, `npm run check` and the smokes, and
deploy the site and the Worker together (see AGENTS.md).

## An enemy type

1. **Id:** add it to `ZC` in `src/shared/protocol.js`. If it needs new states, add
   them to `ZS` and bump `PROTOCOL`.
2. **Rules entry:** add it to `ENEMIES` in `src/shared/enemies.js`.
   - Hit volumes, as spheres and vertical capsules in model metres (parts: head, body, limbs).
   - Heights, wall radius, turn rate, melee, speed, points, corpse life.
   - Its `ai`: `'window'` (climbs in through windows), `'warp'` (appears inside) or
     a name an encounter provides.
   - Its `look`: the client family it uses.
3. **Look:** in `src/client/enemy-looks.js`, reuse a family (zombie, hound,
   kintsugi) or add one: its attack sound, hit effect and death (by the kill's
   `KILL` code: body, head, blast, nuke, shock).
   - A new look for the ordinary horde needs no rules at all. Export a model with
     the zombie rig and add it to `ZOMBIE_MODELS` in
     `src/client/render/zombie-models.js`, with its weight per class and its glow.
   - `main.js` loads every entry at boot; a missing file falls back to the ghoul.
4. **Renderer:** if it draws itself (not the zombie horde), register it in
   `Zombies.drawers` in `src/client/render/zombies.js`, keyed by its `look`.
   - Use `draw(z, dt, time)`, plus optionally `begin/end/hide`.
   - Its model loads in `src/client/main.js` (`loadModels`), and is built and
     edited through the Model Workshop (`art/lab/`).
5. **Spawning:** window zombies come from `GameSim.spawnZombie` (its class mix).
   Anything else spawns from an encounter (below).

`tests/enemies.test.js` fails until the entry is complete, its hit volumes are
well formed and its look exists.

## A gun

1. **Stats:** add an entry to `WEAPONS` in `src/shared/weapons.js`. The header
   there lists every field:
   - stats
   - `kind` and `sound`
   - `price` (sold on a wall) and `box` (mystery-box weight)
   - `grip` and `reloadStyle`
   - `projectile` for rockets and orbs, or `chain` for chain lightning (the Leyden
     Rifle)
2. **Model:** add a builder to `WEAPON_BUILDERS` in `src/client/render/weapons3d.js`.
   - Name its moving parts `mag`, `bolt`, `slide`, `pump` or `barrels` so the
     reloads can move them.
   - A part can ride on another (`B.part(name, pos, rot, order, parent)`), like
     the Leyden jar cores on their rack.
3. **Reload:** pick a style in `src/client/render/reloads.js`, or add one:
   - keyframes for the gun, its parts and both hands, over the reload's progress
   - props the left hand carries, and spent cases thrown out
   - sound cues (`AudioEngine.reload` stages)

   After-shot actions (bolt, pump, slide, crank) are `CYCLES` in the same file.
   `node scripts/guns-smoke.mjs --only <id>` renders a contact sheet to check it.
4. **Wall buy (optional):** place it on a wall in `WALL_BUYS` in the map. The
   chalk outline draws itself.
5. **New sound (optional):** a new sound recipe is a `GUNS` entry in `src/client/audio.js`.

`tests/weapons.test.js` checks that every gun has stats, a model, a sound and a
reload style (`tests/reloads.test.js` checks the choreography itself),
and that the box and the walls only offer priced, real guns. It also covers the
server's shot validation.

## A power-up

1. **Entry:** add it to `POWERUP_TYPES` in `src/shared/powerups.js` (name,
   whether it drops at random, duration).
2. **Effect:** add a case in `GameSim.applyPowerup`, or `applyPowerup` in an
   encounter if it belongs to one.
3. **Model:** add one in `buildPowerupModel` (`src/client/render/weapons3d.js`).

## A special round, secret or boss fight (an encounter)

Encounters are objects of optional hooks that the rules call. The two existing
ones are `src/shared/encounters/hounds.js` (hound rounds) and `kintsugi.js`
(the teacup, figurine and boss easter egg). The hook list is at the top of
`src/shared/sim.js`:

| Hooks | When the rules call them |
| --- | --- |
| `init` | set up its state on the sim |
| `handle` | a client message the encounter owns |
| `step` | every tick |
| `claimsRound` / `spawnStep` / `roundStarted` / `roundEnded` | take over a round's spawning |
| `ai` | named enemy AIs |
| `onDamaged` / `onKill` / `onBlast` / `applyPowerup` | damage, kills, explosions, power-ups |
| `snapshot` / `welcome` | fields clients receive |

Register it in `DEFAULT_ENCOUNTERS`. `new GameSim({ encounters: [...] })` picks
a different set, for example for another mode.

On the client, give its events a handler group in `src/client/events.js` (like
`HOUND_EVENTS`). Register the group in the `Game` constructor
(`eventTable(...)`), and put its strings in `src/client/text.js`.

## A setting

1. **Default:** add it to `DEFAULTS` in `src/client/settings.js`.
2. **UI:** add a row to `TABS` in `src/client/settings-ui.js`. Rows can be
   `range`, `check`, `segment` or `swatches`, with a label and help text.
3. **Game effect:** read it in `Game.applySettings` (`src/client/game.js`).
4. **Page effect:** page-wide effects (CSS classes, `--ui`) go in `applyPage`.

A rebindable key is an entry in `ACTIONS` (`settings.js`). The game checks the
action's default code, and the player's binding is mapped onto it in `Input`.

## A map (current state)

The rules are ready for more than one map; the renderers are not yet.

**Ready:**
- `src/shared/map.js` exports the bunker both as named constants and as one
  object, `BUNKER`, registered in `MAPS`.
- `new GameSim({ map })`, `new World(map)` and `new NavGrid(map)` take that
  object, and `tests/maps.test.js` checks every map in `MAPS`: required data, a
  nav path from every window to the players, and one round of rules.

**To add a second map:**
1. **Shape:** write a module exporting an object of the same shape as `BUNKER`,
   and add it to `MAPS`.
2. **Navigation limits:** it must fit the current grid's limits: two floors (the
   ground and `LOFT_Y`), with stairs that climb along x. Generalising `nav.js` is
   the first job for a very different layout.
3. **Rendering:** the client still draws the bunker from its named exports. Pass
   the map into these, which is the main remaining job:
   - `Level`, `Exterior`, `EggProps` and `SceneRig` (lights and fog)
   - the handful of `game.js` references
4. **Choosing it:**
   - a host-only lobby choice sent to the party (`src/net/rooms.js`)
   - `createMatch(region, { code, map })` in the Worker and Node server
   - `map` in the `welcome` message
   - a `PROTOCOL` bump

## A different theme

The engine no longer assumes zombies in the places that matter. A re-theme swaps
content modules:

- **Words:** `src/client/text.js` (and names in `enemies.js`, `weapons.js`,
  `powerups.js`), plus the page copy in `index.html` and
  `public/manifest.webmanifest`.
- **Enemies:** `enemies.js` data, `enemy-looks.js`, and the renderers and models.
- **Guns:** `weapons.js`, their builders and sounds.
- **Special content:** encounters (`src/shared/encounters/`) and their client event groups.
- **Look:** CSS tokens at the top of `src/client/style.css`; `src/client/render/textures.js`
  (procedural textures) and the art pipeline (`art/STYLE.md`, `art/zombies/`, `art/lab/`).
- **Sound:** recipes in `src/client/audio.js`. It is one large file and the
  biggest remaining themed piece; splitting it by family (guns, enemies, music)
  would be the next step.
