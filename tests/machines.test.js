// The palace's machines (encounters/machines.js): the breaker, perks, the Forge,
// the Magic Lantern teleporter and the Spark Gates, plus the box that moves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSim } from '../src/shared/sim.js';
import { MAPS } from '../src/shared/map.js';
import { PS, ZS, ZC } from '../src/shared/protocol.js';
import { PERKS, PERK_IDS, maxHp } from '../src/shared/perks.js';
import { WEAPONS, FORGE_COST, upgradedId, shotInterval } from '../src/shared/weapons.js';
import { FORGE_WORK } from '../src/shared/encounters/machines.js';

const P = MAPS.palace;

// A palace game with every door open, a rich player, standing in the break before round 1.
function palace({ players = 1, seed = 4 } = {}) {
  const sim = new GameSim({ seed, map: P });
  const list = [];
  for (let i = 0; i < players; i++) list.push(sim.addPlayer(`p${i}`, `P${i}`));
  for (const d of P.DOORS) if (d.cost) sim.openDoor(d.id);
  sim.phase = 'break'; sim.phaseT = 1e9;
  for (const p of list) p.points = 1e6;
  sim.drainEvents();
  return { sim, p: list[0], list };
}
const at = (p, pos) => Object.assign(p, { x: pos[0], y: pos[1], z: pos[2] });
const buy = (sim, p, k, id) => sim.handle(p.id, { t: 'buy', k, id });
const events = (sim, type) => sim.drainEvents().filter((e) => e[0] === type);
const front = (m) => m.use;
const run = (sim, seconds) => { for (let i = 0; i < seconds * 20; i++) sim.step(); };

test('nothing works until the Main Breaker is thrown, backstage', () => {
  const { sim, p } = palace();
  const m = P.PERKS.find((q) => q.perk === 'ironclad');
  at(p, front(m));
  buy(sim, p, 'perk', 'ironclad');
  assert.deepEqual(p.perks, [], 'no perks without power');
  at(p, [0, 0, 12]);
  buy(sim, p, 'power');
  assert.equal(sim.power, false, 'the breaker is backstage');
  at(p, P.POWER.use);
  buy(sim, p, 'power');
  assert.equal(sim.power, true);
  assert.equal(events(sim, 'power').length, 1);
  assert.equal(sim.welcome(p.id).power, true, 'late joiners hear it too');
});

test('perks: each machine sells its perk once, at its price, and its effects apply', () => {
  const { sim, p } = palace({ players: 2 });
  sim.power = true;
  for (const m of P.PERKS) {
    at(p, front(m));
    const before = p.points;
    buy(sim, p, 'perk', m.perk);
    assert.ok(p.perks.includes(m.perk), `${m.perk} bought`);
    assert.equal(before - p.points, PERKS[m.perk].cost, `${m.perk} costs ${PERKS[m.perk].cost}`);
    buy(sim, p, 'perk', m.perk);
    assert.equal(p.perks.filter((x) => x === m.perk).length, 1, 'only once');
  }
  assert.equal(p.hp, PERKS.ironclad.hp, 'Ironclad raises health at once');
  assert.equal(maxHp(p.perks), 250);
  // Hair Trigger: the server accepts shots a third faster.
  assert.ok(Math.abs(shotInterval('m1911') / 1.33 - shotInterval('m1911') / PERKS.hairtrigger.rateMult) < 1e-9);
  const row = sim.snapshot().p.find((r) => r[0] === p.id);
  assert.equal(row[19], (1 << PERK_IDS.length) - 1, 'the snapshot carries every perk');
  // Going down loses them all.
  p.hp = 1;
  sim.hurtPlayer(p, 50, { x: p.x + 1, z: p.z });
  assert.equal(p.state, PS.DOWN);
  assert.deepEqual(p.perks, []);
});

test('Lazarus Draught: faster revives in a team; alone it gets you back up, three times', () => {
  const team = palace({ players: 2 });
  team.sim.power = true;
  const [a, b] = team.list;
  const laz = P.PERKS.find((q) => q.perk === 'lazarus');
  at(a, front(laz));
  buy(team.sim, a, 'perk', 'lazarus');
  assert.equal(team.p.points, 1e6 - PERKS.lazarus.cost, 'full price with company');
  // b goes down next to a; a holds use.
  at(b, [0, 0, 12]); b.hp = 1; team.sim.hurtPlayer(b, 50, { x: 1, z: 12 });
  at(a, [0.8, 0, 12]);
  let t = 0;
  while (b.state === PS.DOWN && t < 5) { team.sim.handle(a.id, { t: 'in', x: 0.8, y: 0, z: 12, yaw: 0, pitch: 0, f: 1 }); team.sim.step(); t += 0.05; }
  assert.equal(b.state, PS.ALIVE);
  assert.ok(t < 2, `revived in ${t.toFixed(2)} s (half of 3)`);

  const solo = palace();
  solo.sim.power = true;
  const p = solo.p;
  for (let use = 0; use < 3; use++) {
    at(p, front(laz));
    const before = p.points;
    buy(solo.sim, p, 'perk', 'lazarus');
    assert.equal(before - p.points, PERKS.lazarus.solo.cost, 'cheap alone');
    p.hp = 1;
    solo.sim.hurtPlayer(p, 50, { x: p.x + 1, z: p.z });
    assert.equal(p.state, PS.DOWN);
    assert.notEqual(solo.sim.phase, 'over', 'not game over');
    run(solo.sim, 4.2);
    assert.equal(p.state, PS.ALIVE, `back up (use ${use + 1})`);
  }
  at(p, front(laz));
  buy(solo.sim, p, 'perk', 'lazarus');
  assert.ok(!p.perks.includes('lazarus'), 'the machine is spent after three');
  p.hp = 1;
  solo.sim.hurtPlayer(p, 50, { x: p.x + 1, z: p.z });
  assert.equal(solo.sim.phase, 'over', 'and then it is over');
});

test('the Forge: hidden until the first teleport, takes a gun and gives it back upgraded', () => {
  const { sim, p } = palace();
  sim.power = true;
  p.weapons = ['m1911', 'm14']; p.cur = 'm14';
  at(p, P.FORGE.use);
  buy(sim, p, 'forge');
  assert.equal(sim.forge.state, 'idle', 'behind the curtain until the teleporter is used');
  sim.openDoor('curtain');
  // Only gun in hand: refused.
  p.weapons = ['m14'];
  buy(sim, p, 'forge');
  assert.equal(sim.forge.state, 'idle', 'you need a spare gun while it works');
  p.weapons = ['m1911', 'm14'];
  const before = p.points;
  buy(sim, p, 'forge');
  assert.equal(before - p.points, FORGE_COST);
  assert.equal(sim.forge.state, 'working');
  assert.deepEqual(p.weapons, ['m1911'], 'the gun is in the furnace');
  run(sim, FORGE_WORK + 0.1);
  assert.equal(sim.forge.state, 'ready');
  buy(sim, p, 'forgeTake');
  assert.ok(p.weapons.includes('m14_up'), 'the upgraded M14 comes out');
  assert.equal(WEAPONS.m14_up.damage, WEAPONS.m14.damage * 2);
  assert.equal(upgradedId('m14_up'), null, 'and cannot go through again');
  // A wall buy now sells upgraded ammo.
  const wb = P.WALL_BUYS.find((w) => w.weapon === 'm14');
  at(p, [wb.pos[0] + wb.face[0] * 0.9, 0, wb.pos[2] + wb.face[1] * 0.9]);
  sim.drainEvents();
  sim.handle(p.id, { t: 'buy', k: 'wall', id: wb.id });
  const ammo = events(sim, 'ammo');
  assert.equal(ammo[0]?.[2], 'm14_up');
});

test('the Magic Lantern: lever, link at the lantern, ride to the booth and back; the curtain opens', () => {
  const { sim, list } = palace({ players: 2 });
  const [a, b] = list;
  const TP = P.TELEPORT, pad = TP.pads[1];
  sim.power = true;
  at(a, pad.pos);
  buy(sim, a, 'tele', pad.id);
  assert.equal(a.points, 1e6, 'an unlinked pad does nothing');
  at(a, pad.use);
  buy(sim, a, 'link', pad.id);
  assert.ok(sim.tele.pads[1].waiting > 0, 'lever pulled');
  at(a, TP.core.use);
  buy(sim, a, 'link', 'core');
  assert.equal(sim.tele.pads[1].linked, true, 'linked at the lantern');
  at(a, pad.pos); at(b, [pad.pos[0] + 0.6, pad.pos[1], pad.pos[2]]);
  sim.drainEvents();
  buy(sim, a, 'tele', pad.id);
  assert.equal(a.points, 1e6 - TP.cost);
  const warps = events(sim, 'warp');
  assert.equal(warps.length, 2, 'everyone on the pad rides');
  assert.ok(a.y > 6 && a.away && b.away, 'in the booth');
  assert.ok(sim.openDoors.has('curtain'), 'the first ride opens the curtain');
  assert.ok(sim.zones.has('forge'));
  // Zombies ignore riders, and client positions from before the warp are ignored.
  sim.handle(a.id, { t: 'in', x: pad.pos[0], y: 0, z: pad.pos[2], yaw: 0, pitch: 0, f: 0 });
  assert.ok(a.y > 6, 'a stale position cannot pull a rider out of the booth');
  const [target] = sim.nearestAlive(0, 0, 0);
  assert.equal(target, null, 'nobody to chase while both are away');
  run(sim, TP.boothTime + 0.2);
  assert.ok(!a.away && Math.abs(a.y - P.STAGE_Y) < 0.01 && a.z < -15, `back on the stage (${a.x}, ${a.y}, ${a.z})`);
  assert.equal(sim.tele.pads[1].linked, false, 'it has to be linked again');
});

test('Spark Gates: fry zombies that walk through, burn players, then cool down', () => {
  const { sim, p } = palace();
  sim.power = true;
  const T = P.TRAPS[1], a = T.area;
  at(p, T.switch.use);
  buy(sim, p, 'trap', T.id);
  assert.equal(sim.traps[1].state, 'active');
  const mid = [(a[0] + a[3]) / 2, 0, (a[2] + a[5]) / 2];
  const z = { id: 700, cls: ZC.WALKER, speed: 0, hp: 5000, maxHp: 5000, x: mid[0], y: 0, z: mid[2], yaw: 0, state: ZS.CHASE, t: 0, win: null, lv: 0, atk: 0, cell: -1, stuck: 0 };
  sim.zombies.set(z.id, z);
  sim.drainEvents();
  sim.step();
  const kills = events(sim, 'kill');
  assert.ok(kills.some((e) => e[1] === 700), 'the zombie fried');
  at(p, mid); p.hp = 100;
  sim.step();
  assert.ok(p.hp < 100, 'a player in the gate gets burned');
  at(p, T.switch.use);
  run(sim, T.time + 0.2);
  assert.equal(sim.traps[1].state, 'cooldown');
  buy(sim, p, 'trap', T.id);
  assert.equal(sim.traps[1].state, 'cooldown', 'not while cooling');
  run(sim, T.cooldown + 0.2);
  assert.equal(sim.traps[1].state, 'ready');
});

test('the box moves: sooner or later a roll shows a toy, refunds, and it lands elsewhere', () => {
  const { sim, p } = palace({ seed: 12 });
  const first = sim.box.spot;
  let left = false;
  for (let i = 0; i < 40 && !left; i++) {
    const B = sim.boxSpot();
    at(p, [B.pos[0] - Math.sin(B.yaw) * 1.1, B.pos[1], B.pos[2] - Math.cos(B.yaw) * 1.1]);
    const before = p.points;
    buy(sim, p, 'box');
    if (sim.box.state === 'leaving') {
      left = true;
      run(sim, 4.4);
      assert.equal(p.points, before, 'the roll was refunded');
      assert.equal(sim.box.state, 'moving');
      run(sim, 6.2);
      assert.equal(sim.box.state, 'idle');
      assert.notEqual(sim.box.spot, first, 'somewhere else now');
    } else {
      run(sim, 4.4);
      buy(sim, p, 'boxTake');
    }
  }
  assert.ok(left, 'the box left within 40 rolls');
  // The bunker's single box never moves.
  const b = new GameSim({ seed: 1 });
  assert.equal(b.map.BOX_SPOTS.length, 1);
});
