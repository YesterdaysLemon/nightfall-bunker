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
   - `projectile` for rockets, orbs and grenades (with `cripple` and `stun` for what a
     blast does to survivors), `chain` for chain lightning (the Leyden Rifle) or
     `cone` for a blast of air (the Gale Cannon)
   - a name for its Forge upgrade in `UPGRADES` (the `<id>_up` copy is generated:
     double damage, bigger magazine, the Forge camo)
2. **Model:** add a builder to `WEAPON_BUILDERS` in `src/client/render/weapons3d.js`,
   or in its own file under `src/client/render/guns/` as `(B, M, K) => length` (K is
   the kit weapons3d passes in; `coldwar.js` is the example).
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
   chalk outline draws itself. A map's box can offer its own guns (`BOX_POOL`).
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

Register it in `ENCOUNTERS` (`src/shared/sim.js`) and name it in a map's
`encounters` list (the bunker runs hounds and the Kintsugi egg; the palace runs
hounds and its machines). `new GameSim({ encounters: [...] })` picks a different
set, for example for another mode.

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

## A map

Two maps exist: the Airfield Bunker (`src/shared/map.js`) and the Aurora Picture
Palace (`src/shared/maps/palace.js`). Each is one object in `MAPS`, made with
`defineMap` from `src/shared/mapkit.js` (which also has the building blocks:
`box`, `wallRun`, `slabWithHoles`, `makeWindows`, `stairBoxes`, `rampHeight`).

1. **Rules data** (`src/shared/maps/<id>.js`):
   - `buildStaticBoxes()`: every wall, floor and prop as tagged boxes. Floors are the
     tags in `FLOOR_TAGS` (`floor0`, `floor`, `slab`, `step`, `stage`, `landing`);
     everything else blocks.
   - `NAV_LEVELS` (floor heights) and `NAV_REGIONS` (per level, the rectangles people
     walk). The navigation grid finds each spot's floor from the boxes; stairs are
     `STAIRS` flights along x or z and join floors by themselves.
   - `WINDOWS` (`makeWindows`), `SPAWNS` outside them, `DOORS` (with the zones they
     open), `ZONES` and `zoneAt`, `WALL_BUYS`, `BOX_SPOTS` (the box moves between
     them when there are several), `PLAYER_SPAWNS`, `LIGHTS` (any number; lamps
     marked `power` wait for the breaker), `navBounds`, `playBounds`, `worldBounds`.
   - Optional: `BOX_POOL`, `encounters`, machines (`POWER`, `PERKS`, `FORGE`,
     `TELEPORT`, `TRAPS`, run by the `machines` encounter), `RADIO`, `EGG`, `fog`,
     `attract` (the menu camera).
2. **Register it** in `MAPS` (`src/shared/map.js`). `tests/maps.test.js` then checks
   it: required data, every window reaching the players, every wall buy, box spot and
   machine reachable, closed doors keeping zones shut, and a round of rules.
3. **Dressing** (`src/client/render/maps/<id>.js`, registered in `maps/index.js`):
   `{ build(level, batch), after(level), door(level, d), exterior(level), update }`.
   The shared `Level` draws windows and boards, doors and debris, wall buys and the
   box; the dressing draws everything else and hangs a fixture on each lamp
   (`level.rig.bulbs[i].bulb`). `bunker.js` and `palace.js` are the examples.
4. **Choosing it:** the menu and the lobby list `MAPS` by itself (name and `blurb`).
   The host's pick travels party -> `createMatch(region, { code, map })` -> the match
   -> `welcome.map`, and the client builds that map (`Game.setMap`).

## A perk

1. **Entry:** add it to `PERKS` in `src/shared/perks.js`: name, cost, colour, blurb and
   its effect field (`hp`, `reviveMult`, `reloadMult`, `rateMult`, or a new one read
   where it matters).
2. **Machine and icon:** a look in `PERK_LOOKS` (`src/client/render/machines.js`) and a
   symbol in `PERK_SYMBOLS` (`src/client/perk-icons.js`); a jingle in `audio.js`.
3. **Place it** in a map's `PERKS`. `tests/perks.test.js` checks all of it.

## A machine or trap

The `machines` encounter (`src/shared/encounters/machines.js`) owns the breaker, perks,
the Forge, the teleporter and the Spark Gates: its `handle` takes the `buy` messages,
its `step` runs them, `welcome` tells late joiners. On the client, `MachineProps`
(`src/client/render/machine-props.js`) places the models, `MACHINE_EVENTS`
(`events.js`) follows the server, and `Game.machineTarget` shows the prompts.
`tests/machines.test.js` and `scripts/palace-smoke.mjs` exercise them.

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
