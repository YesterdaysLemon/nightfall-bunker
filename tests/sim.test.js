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
