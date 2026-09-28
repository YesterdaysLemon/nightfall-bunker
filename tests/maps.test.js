// Every registered map (map.js MAPS) has what the rules need, builds a collision
// world and a navigation grid, and every window zombies climb through leads to
// the players once all doors are open. A new map is checked the moment it is
// added to MAPS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, DEFAULT_MAP } from '../src/shared/map.js';
import { GameSim } from '../src/shared/sim.js';
import { World } from '../src/shared/world.js';
import { NavGrid } from '../src/shared/nav.js';

const DATA = ['WINDOWS', 'DOORS', 'WALL_BUYS', 'MYSTERY_BOX', 'PLAYER_SPAWNS', 'SPAWNS', 'STAIRS', 'ZONES'];
const NUMBERS = ['LOFT_Y', 'MAX_BOARDS', 'BX0', 'BX1', 'BZ0', 'BZ1', 'IX0', 'IX1', 'IZ0', 'IZ1'];
const FUNCTIONS = ['buildStaticBoxes', 'windowBlockers', 'zoneAt', 'openZones', 'stairHeightAt', 'stairFootprint'];

test('the default map is registered', () => {
  assert.ok(MAPS[DEFAULT_MAP]);
});

for (const [id, map] of Object.entries(MAPS)) {
  test(`map "${id}" has everything the rules need`, () => {
    assert.equal(map.id, id);
    for (const k of DATA) assert.ok(Array.isArray(map[k]) || typeof map[k] === 'object', `${id}.${k}`);
    for (const k of NUMBERS) assert.ok(Number.isFinite(map[k]), `${id}.${k}`);
    for (const k of FUNCTIONS) assert.equal(typeof map[k], 'function', `${id}.${k}()`);
    const [x0, z0, x1, z1] = map.worldBounds;
    assert.ok(x0 <= map.BX0 && z0 <= map.BZ0 && x1 >= map.BX1 && z1 >= map.BZ1, 'the collision grid covers the building');
    assert.ok(map.ZONES.includes('start'), 'players start in a zone called start');
    for (const s of map.SPAWNS) assert.ok(map.WINDOWS[s.window], 'every spawn names a window');
    for (const wb of map.WALL_BUYS) assert.ok(map.ZONES.includes(wb.zone), `wall buy ${wb.id} is in a known zone`);
  });

  test(`map "${id}": every window leads to the players once the doors are open`, () => {
    const nav = new NavGrid(map);
    for (const d of map.DOORS) nav.setDoorOpen(d.id);
    const sp = map.PLAYER_SPAWNS[0];
    nav.computeFlow([[sp[0], sp[1], sp[2]]]);
    for (const w of map.WINDOWS) {
      const i = nav.locate(w.inside[0], w.inside[1], w.inside[2]);
      assert.ok(i >= 0, `window ${w.id} has a cell inside`);
      assert.ok(Number.isFinite(nav.dist[i]), `window ${w.id} reaches the player spawn`);
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
  });
}
