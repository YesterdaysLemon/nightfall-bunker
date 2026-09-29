// Every registered map (map.js MAPS) has what the rules need, builds a collision
// world and a navigation grid, and everything players use can be reached once the
// doors are open. A new map is checked the moment it is added to MAPS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, DEFAULT_MAP, mapById } from '../src/shared/map.js';
import { GameSim } from '../src/shared/sim.js';
import { World } from '../src/shared/world.js';
import { NavGrid } from '../src/shared/nav.js';
import { WEAPONS, WALL_PRICES } from '../src/shared/weapons.js';
import { PERKS } from '../src/shared/perks.js';

const DATA = ['WINDOWS', 'DOORS', 'WALL_BUYS', 'BOX_SPOTS', 'PLAYER_SPAWNS', 'SPAWNS', 'STAIRS', 'ZONES', 'LIGHTS', 'NAV_LEVELS', 'NAV_REGIONS'];
const FUNCTIONS = ['buildStaticBoxes', 'windowBlockers', 'zoneAt', 'openZones', 'stairHeightAt', 'walkable'];

test('the default map is registered, and unknown ids fall back to it', () => {
  assert.ok(MAPS[DEFAULT_MAP]);
  assert.equal(mapById('nowhere'), MAPS[DEFAULT_MAP]);
  assert.equal(mapById('palace'), MAPS.palace);
});

// Everything a player walks up to, as [label, [x, y, z]].
function usePoints(map) {
  const out = [];
  for (const w of map.WALL_BUYS) out.push([`wall buy ${w.id}`, [w.pos[0] + w.face[0] * 0.9, w.pos[1] - 1.55, w.pos[2] + w.face[1] * 0.9]]);
  map.BOX_SPOTS.forEach((b, i) => {
    const f = [-Math.sin(b.yaw), -Math.cos(b.yaw)];   // a box opens from its local -Z
    out.push([`box spot ${b.id ?? i}`, [b.pos[0] + f[0] * 1.1, b.pos[1], b.pos[2] + f[1] * 1.1]]);
  });
  for (const m of map.PERKS || []) out.push([`perk ${m.perk}`, m.use]);
  if (map.POWER) out.push(['power', map.POWER.use]);
  if (map.FORGE) out.push(['forge', map.FORGE.use]);
  if (map.TELEPORT) {
    out.push(['lantern', map.TELEPORT.core.use], ['lantern pad', map.TELEPORT.core.pad]);
    for (const p of map.TELEPORT.pads) out.push([`pad ${p.id}`, p.pos], [`pad ${p.id} lever`, p.use]);
  }
  for (const t of map.TRAPS || []) out.push([`trap ${t.id}`, t.switch.use]);
  return out;
}

for (const [id, map] of Object.entries(MAPS)) {
  test(`map "${id}" has everything the rules need`, () => {
    assert.equal(map.id, id);
    assert.ok(map.name, `${id}.name`);
    for (const k of DATA) assert.ok(Array.isArray(map[k]) || typeof map[k] === 'object', `${id}.${k}`);
    for (const k of FUNCTIONS) assert.equal(typeof map[k], 'function', `${id}.${k}()`);
    assert.ok(Number.isFinite(map.MAX_BOARDS));
    assert.equal(map.NAV_REGIONS.length, map.NAV_LEVELS.length, 'a list of walkable rectangles per level');
    const [x0, z0, x1, z1] = map.worldBounds;
    const [n0, m0, n1, m1] = map.navBounds;
    assert.ok(x0 <= n0 && z0 <= m0 && x1 >= n1 && z1 >= m1, 'the collision grid covers the navigation grid');
    assert.ok(map.ZONES.includes('start'), 'players start in a zone called start');
    for (const s of map.SPAWNS) assert.ok(map.WINDOWS[s.window], 'every spawn names a window');
    for (const wb of map.WALL_BUYS) {
      assert.ok(map.ZONES.includes(wb.zone), `wall buy ${wb.id} is in a known zone`);
      assert.ok(Number.isFinite(WALL_PRICES[wb.weapon]), `wall buy ${wb.id} (${wb.weapon}) has a price`);
    }
    for (const b of map.BOX_SPOTS) assert.ok(map.ZONES.includes(b.zone), `box spot ${b.id} is in a known zone`);
    for (const w of Object.keys(map.BOX_POOL || {})) assert.ok(WEAPONS[w], `box pool gun ${w} exists`);
    for (const m of map.PERKS || []) assert.ok(PERKS[m.perk], `perk machine ${m.perk} is a perk`);
    for (const d of map.DOORS) for (const z of d.opens) assert.ok(map.ZONES.includes(z), `door ${d.id} opens a known zone`);
  });

  test(`map "${id}": every window, and everything players use, is reachable once the doors are open`, () => {
    const nav = new NavGrid(map);
    for (const d of map.DOORS) nav.setDoorOpen(d.id);
    const sp = map.PLAYER_SPAWNS[0];
    nav.computeFlow([[sp[0], sp[1], sp[2]]]);
    for (const w of map.WINDOWS) {
      const i = nav.locate(w.inside[0], w.inside[1], w.inside[2]);
      assert.ok(i >= 0, `window ${w.id} has a cell inside`);
      assert.ok(Number.isFinite(nav.dist[i]), `window ${w.id} reaches the player spawn`);
    }
    for (const [label, p] of usePoints(map)) {
      const i = nav.locate(p[0], p[1], p[2]);
      assert.ok(i >= 0 && Number.isFinite(nav.dist[i]), `${label} at ${p.map((v) => v.toFixed(1))} can be walked to`);
      assert.ok(Math.abs(nav.height[i] - p[1]) < 0.6, `${label} stands on its floor (${nav.height[i]} vs ${p[1]})`);
    }
  });

  test(`map "${id}": closed doors keep each zone shut`, () => {
    const nav = new NavGrid(map);
    const sp = map.PLAYER_SPAWNS[0];
    nav.computeFlow([[sp[0], sp[1], sp[2]]]);
    for (const w of map.WINDOWS) {
      const i = nav.locate(w.inside[0], w.inside[1], w.inside[2]);
      const open = w.zone === 'start';
      assert.equal(Number.isFinite(nav.dist[i]), open, `window ${w.id} (${w.zone}) ${open ? 'is' : 'is not'} reachable from the start with every door shut`);
    }
  });

  test(`map "${id}" runs a round of the rules`, () => {
    const world = new World(map);
    assert.ok(world.solid.length > 0);
    const sim = new GameSim({ seed: 3, map });
    sim.addPlayer('p0', 'Tester');
    for (let i = 0; i < 20 * 20; i++) sim.step();   // twenty seconds
    assert.equal(sim.round, 1);
    assert.ok(sim.zombies.size > 0, 'zombies came');
    assert.equal(sim.welcome('p0').map, id, 'clients are told the map');
  });
}

// Walk a character (the client's own physics) toward a point; where did it end up?
function walk(world, from, to, seconds = 8) {
  const s = { x: from[0], y: from[1], z: from[2], vx: 0, vy: 0, vz: 0, onGround: true, height: 1.75 };
  for (let t = 0; t < seconds; t += 1 / 60) {
    const dx = to[0] - s.x, dz = to[2] - s.z, d = Math.hypot(dx, dz);
    if (d < 0.2) break;
    s.vx = (dx / d) * 4.2; s.vz = (dz / d) * 4.2;
    world.moveCharacter(s, 1 / 60);
  }
  return s;
}

test('palace: players can climb every flight of stairs', () => {
  const map = MAPS.palace;
  const world = new World(map);
  for (const d of map.DOORS) world.setDoorOpen(d.id);
  // Stair hall up to the landing.
  let s = walk(world, [-16.5, 0, 19.2], [-16.5, 0, 9.5]);
  assert.ok(s.y > map.UP_Y - 0.05, `stair hall: ended at y=${s.y.toFixed(2)} z=${s.z.toFixed(2)}`);
  // Stage steps from the auditorium floor.
  s = walk(world, [8.75, 0, -10.5], [8.75, 0, -15.5]);
  assert.ok(Math.abs(s.y - map.STAGE_Y) < 0.05, `stage steps: y=${s.y.toFixed(2)}`);
  // Down the wing stair from the dressing rooms to the stage.
  s = walk(world, [-16.8, map.UP_Y, -18.85], [-10, 0, -18.85]);
  assert.ok(Math.abs(s.y - map.STAGE_Y) < 0.05 && s.x > -11, `wing stair: ended at x=${s.x.toFixed(2)} y=${s.y.toFixed(2)}`);
});

test('palace: the projection booth is sealed; only the teleporter reaches it', () => {
  const map = MAPS.palace;
  const nav = new NavGrid(map);
  for (const d of map.DOORS) nav.setDoorOpen(d.id);
  const sp = map.PLAYER_SPAWNS[0];
  nav.computeFlow([[sp[0], sp[1], sp[2]]]);
  for (const b of map.TELEPORT.booth) {
    const i = nav.locate(b[0], b[1], b[2]);
    assert.ok(i >= 0, 'booth spots are floor');
    assert.equal(nav.dist[i], Infinity, 'but no path leads there');
  }
});
