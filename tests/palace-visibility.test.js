// The palace's portal culling (render/maps/palace/zones.js) never hides anything a
// camera could see: a brute-force check over random camera poses, triangle by triangle
// (scripts/palace-visibility.mjs; run it with more POSES after changing the dressing).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('palace culling hides nothing a camera can see', () => {
  const r = spawnSync(process.execPath, ['scripts/palace-visibility.mjs'], { env: { ...process.env, POSES: '120', SEED: '7' }, encoding: 'utf8', timeout: 120000 });
  assert.match(r.stdout, /VIOLATIONS: 0\b/, `${r.stdout}\n${r.stderr}`);
  assert.equal(r.status, 0);
});
