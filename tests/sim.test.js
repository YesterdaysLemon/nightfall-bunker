import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim, roundHealth, roundCount } from '../src/shared/sim.js';
import { NavGrid } from '../src/shared/nav.js';
import { World, zombieHitTest } from '../src/shared/world.js';
import { WINDOWS, DOORS, LOFT_Y, MYSTERY_BOX, WALL_BUYS } from '../src/shared/map.js';
import { ZS, PS, chooseRegion } from '../src/shared/protocol.js';

test('round scaling', () => {
  assert.equal(roundHealth(1), 150);
  assert.equal(roundHealth(9), 950);
  assert.ok(roundHealth(10) > 950);
  assert.equal(roundCount(1, 1), 6);
  assert.ok(roundCount(5, 4) > roundCount(5, 1));
});

test('every window interior reaches the start room once all doors are open', () => {
  const nav = new NavGrid();
  for (const d of DOORS) nav.setDoorOpen(d.id);
  nav.computeFlow([[0, 0, 0]]);
  for (const w of WINDOWS) {
    const i = nav.locate(w.inside[0], w.inside[1], w.inside[2]);
    assert.ok(i >= 0, `window ${w.id} inside point has no cell`);
    assert.ok(Number.isFinite(nav.dist[i]), `window ${w.id} cannot reach the start room`);
  }
});

test('closed doors isolate the help room and loft', () => {
  const nav = new NavGrid();
  nav.computeFlow([[0, 0, 0]]);
  const help = WINDOWS.find((w) => w.zone === 'help');
  const loft = WINDOWS.find((w) => w.zone === 'loft');
  assert.ok(!Number.isFinite(nav.dist[nav.locate(...help.inside)]));
  assert.ok(!Number.isFinite(nav.dist[nav.locate(...loft.inside)]));
  nav.setDoorOpen('debrisA');
  nav.computeFlow([[0, 0, 0]]);
  assert.ok(Number.isFinite(nav.dist[nav.locate(...loft.inside)]), 'loft reachable via stairs A');
});

test('walking up stairs A reaches the loft floor', () => {
  const world = new World();
  world.setDoorOpen('debrisA');
  const s = { x: -1.5, y: 0, z: 5.1, vx: 4, vy: 0, vz: 0, onGround: true, height: 1.75 };
  for (let i = 0; i < 180; i++) world.moveCharacter(s, 1 / 60);
  assert.ok(s.y > LOFT_Y - 0.05, `ended at y=${s.y.toFixed(2)} x=${s.x.toFixed(2)}`);
});

test('debris blocks the stairs until bought', () => {
  const world = new World();
  const s = { x: -1.5, y: 0, z: 5.1, vx: 4, vy: 0, vz: 0, onGround: true, height: 1.75 };
  for (let i = 0; i < 180; i++) world.moveCharacter(s, 1 / 60);
  assert.ok(s.y < 0.5 && s.x < 0, `slipped past debris to x=${s.x.toFixed(2)} y=${s.y.toFixed(2)}`);
});

test('players cannot walk out of windows', () => {
  const world = new World();
  const w = WINDOWS[0];
  const s = { x: w.x, y: 0, z: w.z + 1.5, vx: 0, vy: 0, vz: -5, onGround: true, height: 1.75 };
  for (let i = 0; i < 120; i++) world.moveCharacter(s, 1 / 60);
  assert.ok(s.z > w.z, 'player passed through a window');
});

test('hitboxes', () => {
  const h = zombieHitTest(0, 1.63, 5, 0, 0, -1, 0, 0, 0, 50);
  assert.equal(h.part, 0);
  const b = zombieHitTest(0, 1.2, 5, 0, 0, -1, 0, 0, 0, 50);
  assert.equal(b.part, 1);
  assert.equal(zombieHitTest(3, 1.2, 5, 0, 0, -1, 0, 0, 0, 50), null);
});

function botGame({ players = 1, rounds = 3, shoot = true, maxSeconds = 900 }) {
  const sim = new GameSim({ seed: 1234 });
  for (let i = 0; i < players; i++) sim.addPlayer(`p${i}`, `Bot${i}`);
  const seen = new Set();
  let t = 0;
  while (sim.round <= rounds && sim.phase !== 'over' && t < maxSeconds) {
    for (const p of sim.players.values()) {
      sim.handle(p.id, { t: 'in', x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, f: 0 });
      if (!shoot || p.state === PS.DEAD) continue;
      for (const z of sim.zombies.values()) {
        if (z.state === ZS.CHASE || z.state === ZS.ATTACK || z.state === ZS.CLIMB) {
          if (Math.hypot(z.x - p.x, z.z - p.z) < 6) {
            sim.handle(p.id, { t: 'fire', w: p.cur, o: [p.x, 1.6, p.z], d: [0, 0, -1], h: [[z.id, 0]] });
            break;
          }
        }
      }
    }
    sim.step();
    t += 1 / 20;
    for (const e of sim.drainEvents()) seen.add(e[0]);
  }
  return { sim, seen, t };
}

test('a bot that shoots climbers survives rounds, and boards get torn', () => {
  const { sim, seen } = botGame({ rounds: 3 });
  assert.ok(sim.round >= 3, `only reached round ${sim.round} (phase ${sim.phase})`);
  assert.ok(seen.has('board'));
  assert.ok(seen.has('kill'));
  assert.ok(seen.has('rend'));
  const p = sim.players.get('p0');
  assert.ok(p.points > 500, 'earned points');
});

test('a bot that never shoots goes down and the game ends', () => {
  const { sim, seen } = botGame({ rounds: 5, shoot: false });
  assert.equal(sim.phase, 'over');
  assert.ok(seen.has('hurt'));
  assert.ok(seen.has('down'));
});

test('co-op: downed player is revived by a teammate holding use', () => {
  const sim = new GameSim({ seed: 7 });
  const a = sim.addPlayer('a', 'A');
  const b = sim.addPlayer('b', 'B');
  a.hp = 10;
  sim.hurtPlayer(a, 40, { x: 0, z: 0 });
  assert.equal(a.state, PS.DOWN);
  assert.equal(sim.phase, 'pre');
  b.x = a.x + 0.5; b.z = a.z;
  for (let i = 0; i < 70; i++) {
    sim.handle('b', { t: 'in', x: b.x, y: 0, z: b.z, yaw: 0, pitch: 0, f: 1 });
    sim.handle('a', { t: 'in', x: a.x, y: 0, z: a.z, yaw: 0, pitch: 0, f: 0 });
    sim.step();
  }
  assert.equal(a.state, PS.ALIVE);
});

test('purchases: wall buy, door, box', () => {
  const sim = new GameSim({ seed: 3 });
  const p = sim.addPlayer('p', 'P');
  p.points = 5000;
  const kar = WALL_BUYS.find((b) => b.weapon === 'kar98k');
  Object.assign(p, { x: kar.pos[0], y: 0, z: kar.pos[2] + 1 });
  sim.handle('p', { t: 'buy', k: 'wall', id: kar.id });
  assert.deepEqual(p.weapons, ['m1911', 'kar98k']);
  const door = DOORS[0];
  Object.assign(p, { x: door.use[0][0], y: 0, z: door.use[0][2] });
  sim.handle('p', { t: 'buy', k: 'door', id: door.id });
  assert.ok(sim.zones.has('help'));
  sim.openDoor('debrisA');
  Object.assign(p, { x: MYSTERY_BOX.pos[0], y: LOFT_Y, z: MYSTERY_BOX.pos[2] - 1 });
  sim.handle('p', { t: 'buy', k: 'box' });
  assert.equal(sim.box.state, 'rolling');
  for (let i = 0; i < 100; i++) sim.step();
  assert.equal(sim.box.state, 'ready');
  sim.handle('p', { t: 'buy', k: 'boxTake' });
  assert.equal(p.weapons.length, 2);
  assert.ok(!p.weapons.includes('kar98k') || p.cur === 'kar98k');
});

test('region choice minimises the worst ping', () => {
  const r = chooseRegion([{ weur: 20, enam: 90 }, { weur: 110, enam: 40 }], ['weur', 'enam']);
  assert.equal(r.region, 'enam');
});

test('a thrown grenade explodes and kills a nearby zombie', () => {
  const sim = new GameSim({ seed: 11 });
  const p = sim.addPlayer('p', 'P');
  sim.phase = 'round'; sim.toSpawn = 0;
  sim.zombies.set(99, { id: 99, cls: 0, speed: 0, hp: 150, maxHp: 150, x: 0, y: 0, z: -3, yaw: 0, state: ZS.CHASE, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0, cool: 99 });
  sim.handle('p', { t: 'nade', o: [0, 1.5, -1], v: [0, 2, -3] });
  assert.equal(p.grenades, 1);
  const seen = [];
  for (let i = 0; i < 70; i++) { sim.step(); seen.push(...sim.drainEvents().map((e) => e[0])); }
  assert.ok(seen.includes('boom'), 'grenade exploded');
  assert.ok(!sim.zombies.has(99), 'zombie killed by the blast');
  assert.ok(p.points > 500, 'owner got points');
});

// --- Hound rounds -------------------------------------------------------------------------
import { houndCount, houndHealth, bossHealth } from '../src/shared/sim.js';
import { EGG } from '../src/shared/map.js';
import { ZC } from '../src/shared/protocol.js';
import { houndHitTest, enemyHitTest } from '../src/shared/world.js';

function runUntil(sim, pred, maxTicks = 4000, perTick = () => {}) {
  const seen = [];
  for (let i = 0; i < maxTicks && !pred(seen); i++) {
    perTick();
    sim.step();
    seen.push(...sim.drainEvents());
  }
  return seen;
}

test('hound hitboxes follow the hound yaw', () => {
  // Facing +x (yaw = pi/2): the head is ~0.6 m toward +x at 0.62 m up.
  const head = houndHitTest(0.6, 0.62, 5, 0, 0, -1, 0, 0, 0, Math.PI / 2, 50);
  assert.equal(head.part, 0);
  const body = houndHitTest(-0.3, 0.5, 5, 0, 0, -1, 0, 0, 0, Math.PI / 2, 50);
  assert.equal(body.part, 1);
  assert.equal(houndHitTest(0, 1.6, 5, 0, 0, -1, 0, 0, 0, 0, 50), null, 'a hound is not head-high');
  assert.ok(enemyHitTest(ZC.WALKER, 0, 1.63, 5, 0, 0, -1, 0, 0, 0, 0, 50), 'zombies keep humanoid boxes');
});

test('hound rounds: scheduled, spawn inside near players, last hound drops max ammo', () => {
  assert.ok(houndCount(6, 1) >= 8 && houndCount(6, 4) > houndCount(6, 1));
  assert.ok(houndHealth(6) < 650 && houndHealth(1) >= 150);
  const sim = new GameSim({ seed: 42, firstHoundRound: 1 });
  const p = sim.addPlayer('p', 'P');
  const seen = runUntil(sim, (ev) => ev.some((e) => e[0] === 'strike'), 400);
  assert.ok(seen.some((e) => e[0] === 'hounds' && e[1] === 1), 'round 1 announced as a hound round');
  assert.ok(sim.houndRound);
  const hounds = [...sim.zombies.values()].filter((z) => z.cls === ZC.HOUND);
  assert.ok(hounds.length >= 1, 'a hound spawned');
  for (const h of hounds) {
    assert.ok(h.x > -6 && h.x < 8 && h.z > -6 && h.z < 6, `hound inside the start room at ${h.x.toFixed(1)},${h.z.toFixed(1)}`);
    const d = Math.hypot(h.x - p.x, h.z - p.z);
    assert.ok(d > 3 && d < 16, `spawned ${d.toFixed(1)} m away`);
    assert.equal(h.state, ZS.WARP);
  }
  // Kill every hound as it arrives until the pack is gone.
  const all = runUntil(sim, () => sim.phase === 'break', 6000, () => {
    for (const z of [...sim.zombies.values()]) if (z.state !== ZS.WARP) sim.killZombie(z, 'p', 'head', [0, 0, 1]);
  });
  assert.equal(sim.phase, 'break');
  assert.ok(all.some((e) => e[0] === 'rend' && e[2] === 1), 'round end flagged as a hound round');
  const drops = all.filter((e) => e[0] === 'pu');
  assert.equal(drops.length, 1, 'exactly one drop');
  assert.equal(drops[0][2], 'maxammo');
  assert.equal(sim.houndRound, false);
  assert.ok(sim.nextHoundRound >= 5 && sim.nextHoundRound <= 6, `next hound round ${sim.nextHoundRound}`);
});

test('hounds chase and bite a player who stands still', () => {
  const sim = new GameSim({ seed: 5, firstHoundRound: 1 });
  sim.addPlayer('p', 'P');
  const seen = runUntil(sim, (ev) => ev.some((e) => e[0] === 'hurt'), 2400, () => sim.handle('p', { t: 'in', x: -1.5, y: 0, z: 1.5, yaw: 0, pitch: 0, f: 0 }));
  assert.ok(seen.some((e) => e[0] === 'hurt'), 'a hound reached and bit the player');
});

// --- The Kintsugi easter egg -------------------------------------------------------------------
function shootCup(sim, pid, i) {
  const p = sim.players.get(pid);
  const c = EGG.cups[i];
  const o = [p.x, p.y + 1.5, p.z];
  const d = [c.pos[0] - o[0], c.pos[1] + 0.05 - o[1], c.pos[2] - o[2]];
  sim.handle(pid, { t: 'cup', i, o, d });
}

test('easter egg: cups need a real line of sight, then the figurine wakes her', () => {
  const sim = new GameSim({ seed: 9 });
  const p = sim.addPlayer('p', 'P');
  sim.openDoor('helpDoor'); sim.openDoor('debrisA');
  // A shot from the far side of the help-room wall does not count.
  Object.assign(p, { x: -12, y: 0, z: 0 });
  shootCup(sim, 'p', 0);
  assert.equal(sim.egg.cups[0], false, 'no shooting through walls');
  // From the start room it does.
  Object.assign(p, { x: 4, y: 0, z: -3 });
  shootCup(sim, 'p', 0);
  assert.equal(sim.egg.cups[0], true);
  // Outside cup through the east window; loft cup from the loft.
  Object.assign(p, { x: 6.8, y: 0, z: -1 });
  shootCup(sim, 'p', 2);
  assert.equal(sim.egg.cups[2], true, 'courtyard cup is visible through the east window');
  Object.assign(p, { x: -2, y: LOFT_Y, z: -2 });
  shootCup(sim, 'p', 1);
  assert.equal(sim.egg.stage, 'ready');
  // Touching the figurine from across the room does nothing; next to it wakes her.
  Object.assign(p, { x: -8, y: 0, z: 0 });
  sim.handle('p', { t: 'egg' });
  assert.equal(sim.egg.stage, 'ready');
  Object.assign(p, { x: -14.3, y: 0, z: 4.6 });
  sim.handle('p', { t: 'egg' });
  assert.equal(sim.egg.stage, 'awake');
  runUntil(sim, () => !!sim.boss, 200);
  assert.ok(sim.boss, 'boss spawned');
  assert.equal(sim.boss.cls, ZC.KINTSUGI);
  assert.equal(sim.boss.hp, bossHealth(sim.round, 1));
});

test('boss: slow when watched, fast when not, immune while shattered, drops gold leaf', () => {
  const sim = new GameSim({ seed: 21 });
  const p = sim.addPlayer('p', 'P');
  sim.openDoor('helpDoor');
  sim.phase = 'round'; sim.toSpawn = 0;
  sim.spawnBoss();
  const k = sim.boss;
  k.state = ZS.CHASE;
  // Stand in the start room doorway looking straight at her, then turn around.
  Object.assign(p, { x: -4, y: 0, z: -0.2 });
  const look = (away) => {
    const yaw = Math.atan2(-(k.x - p.x), -(k.z - p.z)) + (away ? Math.PI : 0);
    sim.handle('p', { t: 'in', x: p.x, y: 0, z: p.z, yaw, pitch: -0.05, f: 0 });
  };
  look(false); sim.step();
  assert.equal(k.watched, true, 'seen while looked at');
  assert.ok(k.speed < 2);
  look(true); sim.step();
  assert.equal(k.watched, false);
  assert.ok(k.speed > 4);
  // Big damage breaks a stage and makes her shatter; shattered she takes no damage.
  sim.damageZombie(k, k.maxHp * 0.3, p, 'body', [0, 0, 1]);
  assert.equal(k.stage, 1);
  assert.equal(k.state, ZS.SHATTER);
  const hp = k.hp;
  sim.damageZombie(k, 500, p, 'body', [0, 0, 1]);
  assert.equal(k.hp, hp, 'invulnerable while shattered');
  // She re-forms behind the player.
  runUntil(sim, () => k.state !== ZS.SHATTER, 60, () => look(false));
  assert.equal(k.state, ZS.REFORM);
  assert.ok(Math.hypot(k.x - p.x, k.z - p.z) < 2.6, 're-formed next to the player');
  // Insta-kill and nukes don't work on her.
  sim.insta = 30;
  k.state = ZS.CHASE;
  sim.damageZombie(k, 10, p, 'body', [0, 0, 1]);
  assert.ok(k.hp > 0);
  sim.applyPowerup({ id: 1, type: 'nuke' }, p);
  assert.ok(sim.zombies.has(k.id), 'nuke spares the boss');
  // Finish her: gold leaf drops, grabbing it gives the Arc Pistol.
  const events = [];
  sim.insta = 0;
  k.state = ZS.CHASE;
  sim.damageZombie(k, k.hp + 1, p, 'head', [0, 0, 1]);
  events.push(...sim.drainEvents());
  assert.equal(sim.egg.stage, 'done');
  const pu = sim.powerups.find((u) => u.type === 'goldleaf');
  assert.ok(pu, 'gold leaf dropped');
  Object.assign(p, { x: pu.x, y: pu.y, z: pu.z });
  sim.step();
  assert.ok(p.weapons.includes('arcpistol'), 'Arc Pistol granted');
});
