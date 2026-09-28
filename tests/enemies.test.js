// The enemy registry (src/shared/enemies.js) is complete for every class the
// protocol knows, and the client has a look for each.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ZC } from '../src/shared/protocol.js';
import { ENEMIES, enemy } from '../src/shared/enemies.js';
import { enemyHitTest, zombieHitTest } from '../src/shared/world.js';
import { LOOKS } from '../src/client/enemy-looks.js';

const REQUIRED = ['key', 'name', 'ai', 'look', 'hit', 'scale', 'mid', 'aimY', 'body', 'turn', 'directDist', 'melee', 'speed', 'killPoints', 'corpseLife'];

test('every enemy class has a complete entry', () => {
  for (const [name, cls] of Object.entries(ZC)) {
    const e = ENEMIES[cls];
    assert.ok(e, `${name} has an entry`);
    for (const k of REQUIRED) assert.ok(e[k] !== undefined, `${name}.${k}`);
    for (const k of ['start', 'windup', 'reach', 'dmg', 'cool']) assert.ok(Number.isFinite(e.melee[k]), `${name}.melee.${k}`);
    assert.equal(e.body.length, 3, `${name}.body is [radius, bottom, top]`);
    assert.ok(LOOKS[e.look], `${name} has a client look "${e.look}"`);
    assert.ok(['window', 'warp', 'boss'].includes(e.ai), `${name} has a known AI`);
    if (e.ai === 'window') for (const k of ['windowSpeed', 'tearTime', 'climbTime', 'windowSwipe']) assert.ok(e[k] !== undefined, `${name}.${k}`);
  }
});

test('hit volumes are well formed and cover a head, a body and limbs', () => {
  for (const [name, cls] of Object.entries(ZC)) {
    const parts = new Set();
    for (const v of enemy(cls).hit) {
      assert.ok([0, 1, 2].includes(v[0]), `${name}: part id`);
      assert.ok(v[1] === 'sphere' ? v.length === 5 : v[1] === 'capsule' && v.length === 6, `${name}: ${JSON.stringify(v)}`);
      assert.ok(v.slice(2).every(Number.isFinite), `${name}: numbers`);
      parts.add(v[0]);
    }
    assert.deepEqual([...parts].sort(), [0, 1, 2], `${name} has head, body and limb volumes`);
  }
});

test('the humanoid hit test gives the same answers as before the registry', () => {
  // Head sphere at 1.63 m, radius 0.17; torso capsule 0.95-1.35 m, radius 0.24; legs below.
  const head = zombieHitTest(0, 1.63, 5, 0, 0, -1, 0, 0, 0, 50);
  assert.equal(head.part, 0);
  assert.ok(Math.abs(head.t - (5 - 0.17)) < 1e-9);
  const torso = zombieHitTest(0, 1.1, 5, 0, 0, -1, 0, 0, 0, 50);
  assert.equal(torso.part, 1);
  assert.ok(Math.abs(torso.t - (5 - 0.24)) < 1e-9);
  assert.equal(zombieHitTest(0, 0.5, 5, 0, 0, -1, 0, 0, 0, 50).part, 2);
  assert.equal(zombieHitTest(0.5, 1.1, 5, 0, 0, -1, 0, 0, 0, 50), null, 'a miss beside the torso');
  // Humanoids are round: yaw does not change their volumes.
  assert.deepEqual(enemyHitTest(ZC.KINTSUGI, 0, 1.63, 5, 0, 0, -1, 0, 0, 0, 1.2, 50), enemyHitTest(ZC.KINTSUGI, 0, 1.63, 5, 0, 0, -1, 0, 0, 0, 0, 50));
});
