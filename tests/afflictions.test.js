// What a blast leaves behind: crawlers (legs taken by explosives), the Arc Pistol's
// stun, and the paced hound packs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim, houndCap } from '../src/shared/sim.js';
import { ZS, ZC, ZF } from '../src/shared/protocol.js';
import { enemyHitTest } from '../src/shared/world.js';
import { WEAPONS, GRENADE } from '../src/shared/weapons.js';

// A sim with one player and `n` tough zombies standing in a ring 2 m around (0, 0, -3).
function ring(n, { cls = ZC.WALKER, hp = 1e5, seed = 3 } = {}) {
  const sim = new GameSim({ seed });
  const p = sim.addPlayer('p', 'P');
  Object.assign(p, { x: 0, y: 0, z: 2 });
  sim.phase = 'round';
  const list = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const z = { id: 100 + i, cls, speed: 2.4, hp, maxHp: hp, x: Math.cos(a) * 2, y: 0, z: -3 + Math.sin(a) * 2, yaw: 0, state: ZS.CHASE, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0 };
    sim.zombies.set(z.id, z);
    list.push(z);
  }
  return { sim, p, list };
}

test('an explosion that does not kill can take a zombie\'s legs', () => {
  const { sim, list } = ring(60);
  sim.explode(0, 1, -3, GRENADE.radius, GRENADE.damage, sim.players.get('p'), 'nade', 1);
  const crawlers = list.filter((z) => z.crawl);
  const share = crawlers.length / list.length;
  assert.ok(share > 0.12 && share < 0.5, `about ${GRENADE.cripple * 100}% crawl (${crawlers.length}/${list.length})`);
  const events = sim.drainEvents().filter((e) => e[0] === 'crip');
  assert.equal(events.length, crawlers.length, 'one crip event per crawler');
  for (const z of crawlers) assert.ok(z.speed <= 0.8, 'crawlers are slow');
  // The snapshot carries the condition, and only for those who have one.
  const rows = sim.snapshot().z;
  const flagged = rows.filter((r) => r.length > 7);
  assert.equal(flagged.length, crawlers.length);
  assert.ok(flagged.every((r) => r[7] & ZF.CRAWL));
});

test('a kill never leaves a crawler, and bullets never cripple', () => {
  const { sim, list } = ring(30, { hp: 10 });
  sim.explode(0, 1, -3, GRENADE.radius, GRENADE.damage, sim.players.get('p'), 'nade', 1);
  assert.equal(sim.zombies.size, 0, 'all killed');
  assert.ok(!sim.drainEvents().some((e) => e[0] === 'crip'));
  const r = ring(20, { seed: 4 });
  for (const z of r.list) r.sim.damageZombie(z, 50, r.p, 'body', [0, 0, -1]);
  assert.ok(r.list.every((z) => !z.crawl));
});

test('a crawler is a low target: a shot at head height passes over it', () => {
  const at = (flags, y) => enemyHitTest(ZC.WALKER, 0, y, 5, 0, 0, -1, 0, 0, 0, 0, 50, flags);
  assert.ok(at(0, 1.63), 'a standing zombie is hit at head height');
  assert.equal(at(ZF.CRAWL, 1.63), null, 'a crawler is not');
  // Facing the shooter (+z), its raised head is about 0.7 m out and 0.36 m up.
  const head = enemyHitTest(ZC.WALKER, 0, 0.36, 5, 0, 0, -1, 0, 0, 0, 0, 50, ZF.CRAWL);
  assert.equal(head.part, 0, 'aim low for the head');
  assert.ok(Math.abs(5 - head.t - 0.7) < 0.25, 'head sits ahead of its hips');
});

test('crawlers still drag themselves to a player and bite', () => {
  const { sim, p, list } = ring(1, { seed: 8 });
  const z = list[0];
  z.x = 0; z.z = -1; z.crawl = true; z.speed = 0.7;
  Object.assign(p, { x: 0, y: 0, z: 1 });
  let hurt = false;
  for (let i = 0; i < 400 && !hurt; i++) {
    sim.handle('p', { t: 'in', x: 0, y: 0, z: 1, yaw: 0, pitch: 0, f: 0 });
    sim.step();
    hurt = sim.drainEvents().some((e) => e[0] === 'hurt');
  }
  assert.ok(hurt, 'the crawler reached the player and bit');
});

test('the Arc Pistol\'s blast slows what it does not kill, for a few seconds', () => {
  const W = WEAPONS.arcpistol;
  const { sim, list } = ring(6, { seed: 5 });
  sim.explode(0, 1, -3, W.projectile.radius + 2, W.damage, sim.players.get('p'), 'arcpistol', 1);
  const hit = list.filter((z) => z.slowT > 0);
  assert.equal(hit.length, list.length, 'every survivor is stunned');
  const z = hit[0];
  assert.ok(Math.abs(sim.pace(z) - z.speed * 0.35) < 1e-9, 'moves at about a third of its speed');
  const row = sim.snapshot().z.find((r) => r[0] === z.id);
  assert.ok(row[7] & ZF.STUN, 'clients see the stun');
  for (let i = 0; i < 20 * (W.projectile.stun + 0.2); i++) sim.step();
  assert.ok(!(z.slowT > 0), 'it wears off');
  assert.equal(sim.pace(z), z.speed);
});

test('the Arc Pistol cripples more often than a grenade; hounds and the boss never crawl', () => {
  const { sim, list } = ring(60, { seed: 6 });
  sim.explode(0, 1, -3, 5, WEAPONS.arcpistol.damage, sim.players.get('p'), 'arcpistol', 1);
  const share = list.filter((z) => z.crawl).length / list.length;
  assert.ok(share > 0.3, `arc blast crippled ${Math.round(share * 100)}%`);
  const h = ring(20, { cls: ZC.HOUND, seed: 7 });
  h.sim.explode(0, 1, -3, 5, 400, h.p, 'arcpistol', 1);
  assert.ok(h.list.every((z) => !z.crawl), 'hounds keep their legs');
  assert.ok(h.list.every((z) => z.slowT > 0), 'but they are slowed');
  const b = ring(1, { cls: ZC.KINTSUGI, seed: 9 });
  b.sim.explode(b.list[0].x, 1, b.list[0].z, 5, 400, b.p, 'arcpistol', 1);
  assert.ok(!b.list[0].crawl && !(b.list[0].slowT > 0), 'the boss shrugs it off');
});

test('hound packs come a few at a time, growing with later hound rounds and players', () => {
  assert.equal(houndCap(0, 1), 2, 'two at once on the first hound round');
  assert.equal(houndCap(1, 1), 3);
  assert.equal(houndCap(9, 1), 6, 'capped at six alone');
  assert.equal(houndCap(0, 4), 5, 'one more per extra player');
  const sim = new GameSim({ seed: 11, firstHoundRound: 1 });
  const p = sim.addPlayer('p', 'P');
  let most = 0, spawns = [];
  for (let i = 0; i < 20 * 40; i++) {
    p.hp = 100;   // an immortal target: we only watch the pacing
    sim.step();
    for (const e of sim.drainEvents()) if (e[0] === 'zspawn') spawns.push(sim.time);
    most = Math.max(most, [...sim.zombies.values()].filter((z) => z.cls === ZC.HOUND).length);
    // Kill one every 6 s so the pack keeps coming.
    if (i % 120 === 119) {
      const h = [...sim.zombies.values()].find((z) => z.state !== ZS.WARP);
      if (h) sim.killZombie(h, 'p', 'head', [0, 0, 1]);
    }
  }
  assert.ok(spawns.length >= 4, `${spawns.length} hounds came`);
  assert.equal(most, 2, 'never more than two loose at once');
  const gaps = spawns.slice(1).map((t, i) => t - spawns[i]);
  assert.ok(Math.min(...gaps) >= 2.4, `at least a couple of seconds apart (${gaps.map((g) => g.toFixed(1)).join(', ')})`);
});

test('the Gale Cannon flings everything in its cone, and nothing behind or around a wall', () => {
  const { sim, p, list } = ring(12, { seed: 13 });
  Object.assign(p, { x: 0, y: 0, z: 2 });
  p.weapons = ['m1911', 'galecannon']; p.cur = 'galecannon';
  sim.time = 10; p.lastFire = 0; p.tokens = 3;
  sim.drainEvents();
  sim.handle('p', { t: 'fire', w: 'galecannon', o: [0, 1.6, 2], d: [0, -0.1, -1] });
  const kills = sim.drainEvents().filter((e) => e[0] === 'kill');
  const inCone = list.filter((z) => {
    const vx = z.x, vz = z.z - 2, d = Math.hypot(vx, vz);
    return d < 1.2 || (-vz / d > Math.cos(0.5) && d < 11);
  });
  assert.ok(inCone.length >= 3, 'the test ring has zombies in front');
  assert.equal(kills.length, inCone.length, 'exactly the ones in front die');
  assert.ok(kills.every((e) => e[3] === 5), 'as gust kills (flung)');
});
