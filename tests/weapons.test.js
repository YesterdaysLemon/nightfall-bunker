// Every gun is complete (stats, model, sound, where it is sold), and the
// server's shot validation holds: fire rate, ownership, range, pellets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS, WEAPON_IDS, BOX_POOL, WALL_PRICES, START_WEAPON, reloadStyle, shotInterval } from '../src/shared/weapons.js';
import { WALL_BUYS } from '../src/shared/map.js';
import { GameSim } from '../src/shared/sim.js';
import { ZS, ZC, KILL } from '../src/shared/protocol.js';
import { WEAPON_BUILDERS } from '../src/client/render/weapons3d.js';
import { GUN_SOUNDS } from '../src/client/audio.js';
import { RELOADS } from '../src/client/render/reloads.js';

const NUMBERS = ['damage', 'headMult', 'rpm', 'mag', 'reserve', 'reload', 'spread', 'aimSpread', 'range', 'pellets', 'kick', 'adsFov', 'moveMult'];
const KINDS = ['pistol', 'bolt', 'rifle', 'smg', 'shotgun', 'lmg', 'rocket', 'wonder'];

test('every weapon has stats, a model, a sound and valid options', () => {
  for (const id of WEAPON_IDS) {
    const W = WEAPONS[id];
    assert.ok(W.name, `${id}.name`);
    assert.ok(KINDS.includes(W.kind), `${id}.kind`);
    for (const k of NUMBERS) assert.ok(Number.isFinite(W[k]) && W[k] > 0, `${id}.${k} is a positive number`);
    assert.ok(WEAPON_BUILDERS[id], `${id} has a model builder in weapons3d.js`);
    assert.ok(GUN_SOUNDS.includes(W.sound), `${id}.sound "${W.sound}" is a recipe in audio.js`);
    assert.ok(RELOADS[reloadStyle(W)], `${id} reload style "${reloadStyle(W)}" is choreographed in reloads.js`);
    assert.ok(!W.grip || ['rail', 'post', 'cup'].includes(W.grip), `${id}.grip`);
    if (W.projectile) {
      const P = W.projectile;
      for (const k of ['speed', 'radius', 'gravity', 'shake']) assert.ok(Number.isFinite(P[k]), `${id}.projectile.${k}`);
      assert.ok(['rocket', 'orb', 'grenade'].includes(P.look) && ['fire', 'arc'].includes(P.blast), `${id}.projectile look and blast`);
    }
    if (W.chain) {
      for (const k of ['hops', 'reach', 'delay', 'aim', 'bossDamage']) assert.ok(Number.isFinite(W.chain[k]) && W.chain[k] >= 0, `${id}.chain.${k}`);
      assert.ok(!W.projectile, `${id} is either chain lightning or a projectile`);
    }
  }
  assert.ok(WEAPONS[START_WEAPON], 'the start weapon exists');
});

test('the box and the walls only offer real, priced weapons', () => {
  for (const [id, w] of Object.entries(BOX_POOL)) assert.ok(WEAPONS[id] && w > 0, `box: ${id}`);
  for (const wb of WALL_BUYS) assert.ok(Number.isFinite(WALL_PRICES[wb.weapon]), `wall buy ${wb.id} (${wb.weapon}) has a price`);
});

// A sim with one player standing near a zombie in the open.
function range() {
  const sim = new GameSim({ seed: 7 });
  const p = sim.addPlayer('p0', 'Tester');
  const z = { id: 99, cls: 0, speed: 0, hp: 1e6, maxHp: 1e6, x: p.x, y: p.y, z: p.z - 5, yaw: 0, state: ZS.CHASE, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0 };
  sim.zombies.set(z.id, z);
  sim.time = 10;
  p.lastFire = 0;
  p.tokens = 0;
  const shoot = (w, hits = [[99, 1]]) => sim.handle('p0', { t: 'fire', w, o: [p.x, 1.6, p.z], d: [0, 0, -1], h: hits });
  return { sim, p, z, shoot };
}

test('shots over the fire rate are ignored', () => {
  const { sim, z, shoot } = range();
  const before = z.hp;
  for (let i = 0; i < 10; i++) shoot('m1911');            // ten shots at one instant
  const landed = (before - z.hp) / WEAPONS.m1911.damage;
  assert.ok(landed <= 3, `a burst is capped at 3 stored shots (landed ${landed})`);
  sim.time += shotInterval('m1911') * 1.01;
  const mid = z.hp;
  shoot('m1911');
  assert.ok(z.hp < mid, 'the next shot after the interval lands');
});

test('shots from weapons you do not own, out of range, or with too many pellets are refused', () => {
  const { sim, p, z, shoot } = range();
  sim.time += 5;
  const hp0 = z.hp;
  shoot('mg42');
  assert.equal(z.hp, hp0, 'a weapon the player does not own does nothing');
  z.z = p.z - (WEAPONS.m1911.range + 10);
  shoot('m1911');
  assert.equal(z.hp, hp0, 'a hit claimed beyond range does nothing');
  z.z = p.z - 5;
  sim.time += 5;
  shoot('m1911', Array.from({ length: 6 }, () => [99, 1]));
  assert.equal(hp0 - z.hp, WEAPONS.m1911.damage, 'a single-pellet gun counts one hit per shot');
});

// A row of zombies 2 m apart in front of the player, plus one far off.
function lightningRange() {
  const sim = new GameSim({ seed: 7 });
  const p = sim.addPlayer('p0', 'Tester');
  p.weapons = ['m1911', 'leyden'];
  p.cur = 'leyden';
  const add = (id, x, z, cls = ZC.WALKER) => {
    const zb = { id, cls, speed: 0, hp: 5000, maxHp: 5000, x, y: p.y, z, yaw: 0, state: ZS.CHASE, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0 };
    sim.zombies.set(id, zb);
    return zb;
  };
  for (let i = 0; i < 4; i++) add(10 + i, p.x + i * 2, p.z - 4);
  const far = add(50, p.x + 30, p.z - 4);
  sim.time = 10;
  p.lastFire = 0;
  p.tokens = 0;
  const fire = (hits) => sim.handle('p0', { t: 'fire', w: 'leyden', o: [p.x, 1.6, p.z], d: [0, 0, -1], h: hits });
  return { sim, p, add, far, fire };
}

test('the Leyden Rifle chains from the enemy it hit to the ones in reach, hop by hop', () => {
  const { sim, far, fire } = lightningRange();
  sim.events.length = 0;
  fire([[10, 1]]);
  const chain = sim.events.find((e) => e[0] === 'chain');
  assert.ok(chain, 'a chain event goes out');
  assert.deepEqual(chain[3], [10, 11, 12, 13], 'it leaps down the row, nearest first, and never to the far one');
  assert.equal(chain[4].length, 3 * 5, 'the path starts at the shooter and has a point per enemy');
  assert.deepEqual(chain[5], [0, 1, 2, 3], 'each bolt leaves from the enemy before it');
  for (let i = 0; i < 20; i++) sim.step();
  const kills = sim.events.filter((e) => e[0] === 'kill');
  assert.deepEqual(kills.map((e) => e[1]), [10, 11, 12, 13], 'each hop kills in order');
  assert.ok(kills.every((e) => e[3] === KILL.SHOCK), 'as shock deaths');
  assert.ok(sim.zombies.has(far.id), 'out of reach is out of reach');
});

test('the chain forks: a hop can leave from any enemy already struck', () => {
  const { sim, p, add, fire } = lightningRange();
  sim.zombies.clear();
  add(20, p.x, p.z - 4);
  add(21, p.x - 3.9, p.z - 4);
  add(22, p.x + 4, p.z - 4);   // 7.9 m from 21: only reachable back from 20
  sim.events.length = 0;
  fire([[20, 1]]);
  const chain = sim.events.find((e) => e[0] === 'chain');
  assert.deepEqual(chain[3], [20, 21, 22]);
  assert.deepEqual(chain[5], [0, 1, 1], 'the third bolt forks from the first enemy');
});

test('a Leyden Rifle bolt that hits nothing still reports where it went, and bosses only take a share', () => {
  const { sim, p, add, fire } = lightningRange();
  sim.events.length = 0;
  fire([]);
  const miss = sim.events.find((e) => e[0] === 'chain');
  assert.deepEqual(miss[3], []);
  assert.equal(miss[4].length, 6, 'from the shooter to the wall');
  const boss = add(70, p.x, p.z - 3, ZC.KINTSUGI);
  boss.hp = boss.maxHp = 20000;
  sim.time += 5;
  fire([[70, 1]]);
  for (let i = 0; i < 20; i++) sim.step();
  assert.equal(20000 - boss.hp, WEAPONS.leyden.chain.bossDamage);
});

test('a wall buy with no price is refused, not free', () => {
  const sim = new GameSim({ seed: 3 });
  const p = sim.addPlayer('p0', 'Tester');
  assert.equal(sim.spend(p, undefined), false);
  assert.equal(p.points, 500);
});
